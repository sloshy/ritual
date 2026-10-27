/**
 * The MCP Tasks extension (`io.modelcontextprotocol/tasks`, SEP-2663) on
 * Ritual's server: which calls become tasks, how a task's work runs, and the
 * `tasks/get` / `tasks/update` / `tasks/cancel` handlers.
 *
 * **When a call becomes a task.** Only for a tool enabled here (the four long
 * ones — `build_site`, `sync_decks`, `sync_collection`, `refresh_cache`), only
 * when the request's own client capabilities declare the extension (the spec
 * forbids a task to anyone else), and only when the call will start: its
 * arguments pass the tool's schema and its preflight claims what it needs (the
 * one-build slot, for `build_site`). Anything else is served exactly as
 * before, synchronously.
 *
 * **How the work runs.** The task re-enters the very `tools/call` handler the
 * SDK's `McpServer` installed, with a context of its own: the task's abort
 * signal instead of the request's (which ends with the response), no progress
 * token (progress notifications are forbidden for a task — progress becomes the
 * task's status line instead), nothing that reaches the wire, and the answers
 * a `tasks/update` delivered in place of a retry's `inputResponses`. So a
 * task's result is byte for byte what the call would have returned
 * synchronously — same input and output schema validation, same structured
 * errors — and the tools themselves only get their options through
 * `toolCallOptions`.
 *
 * **Why the interception.** The SDK has no server-side task runtime, and its
 * `McpServer` validates every tool result against the tool's `outputSchema`, so
 * a tool callback cannot itself return a `CreateTaskResult`. The decision is
 * therefore made one level up: the `tools/call` handler `McpServer` installed
 * is replaced by one that decides, and that calls the original for the work.
 * Reading that handler back needs the SDK's protected `_getRequestHandler`;
 * when it is not there, and when the startup probe (`probe.ts`) finds the SDK
 * no longer carries a task result through, task support switches itself off —
 * the extension is not advertised and every call is served synchronously,
 * which the spec allows.
 */

import { z } from 'zod'
import {
  CLIENT_CAPABILITIES_META_KEY,
  MissingRequiredClientCapabilityError,
  ProtocolError,
  ProtocolErrorCode,
  isCallToolResult,
  isInputRequiredResult,
  type CallToolRequest,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type MissingRequiredClientCapabilityErrorData,
  type RegisteredTool,
  type ServerContext,
} from '@modelcontextprotocol/server'
import type { BuildClaim } from '../../admin/api/build-site'
import { t } from '../../i18n/t'
import { isRecord } from '../../util/json'
import type { RouteProgress } from '../../util/progress'
import { bindTaskRun } from './run-context'
import { taskProgressStatus, type TaskToolName } from './status'
import {
  TaskStore,
  type CancelOutcome,
  type TaskError,
  type TaskRecord,
  type TaskStoreOptions,
} from './store'
import {
  TASKS_EXTENSION_ID,
  createTaskResult,
  getTaskResult,
  type CreateTaskResult,
  type GetTaskResult,
} from './wire'

/**
 * The SDK's low-level server, named through `McpServer` because its class is
 * marked deprecated for direct use (the high-level `McpServer` is meant to be
 * enough). Registering custom-schema request handlers is exactly the advanced
 * case it is kept for.
 */
type LowLevelServer = McpServer['server']

/** The `tools/call` handler `McpServer` installs, as the task runtime calls it. */
type ToolsCallHandler = (
  request: CallToolRequest,
  ctx: ServerContext,
) => Promise<CallToolResult | InputRequiredResult>

/** The protected handler lookup `Protocol` keeps for its subclasses. */
type HandlerLookup = {
  _getRequestHandler(
    method: string,
  ): ((request: CallToolRequest, ctx: ServerContext) => Promise<unknown>) | undefined
}

/** Resumes a task waiting for input with the answers a `tasks/update` completed. */
type Resume = (responses: Record<string, unknown>) => void

/** The empty acknowledgement `tasks/update` and `tasks/cancel` answer with. */
type TaskAck = Record<string, never>

/** What a preflight claimed for a task about to start, and how to give it back. */
export type TaskStart = {
  /** The build slot, for `build_site`; handed to the route the task calls. */
  buildClaim?: BuildClaim
  /**
   * Give back whatever was claimed. The runtime calls it at most once per task:
   * when the task's work settles, or when the task is cancelled or evicted
   * while waiting for input. It is not called for a task failed as overdue
   * while its work is still in flight — the work's own end releases it.
   */
  release: () => void
}

/**
 * Claims what a task needs to start, or answers `undefined` when the start
 * would be refused outright — that refusal is then served synchronously, as an
 * ordinary error result, rather than as a task.
 */
export type TaskPreflight = () => TaskStart | undefined

/** A tool the runtime may run as a task. */
type TaskTool = {
  readonly name: TaskToolName
  readonly tool: RegisteredTool
  readonly preflight?: TaskPreflight
}

/** Where the tool registrations mark the tools that may run as tasks. */
export interface TaskSupport {
  /** Let `name` run as a task for a client that declares the extension. */
  enable(name: TaskToolName, tool: RegisteredTool, preflight?: TaskPreflight): void
}

/** The task tools of one server, collected while its tools register. */
export type TaskTools = TaskSupport & {
  readonly entries: ReadonlyMap<string, TaskTool>
}

/** A fresh collector for one server's task tools. */
export function createTaskTools(): TaskTools {
  const entries = new Map<string, TaskTool>()
  return {
    entries,
    enable: (name, tool, preflight) => {
      entries.set(name, { name, tool, preflight })
    },
  }
}

const TASK_ID_PARAMS = z.object({ taskId: z.string() })

/** The method whose handler the runtime wraps. */
const TOOLS_CALL = 'tools/call'

/** Nothing was claimed: nothing to give back. */
const NOTHING_CLAIMED: TaskStart = { release: () => {} }

/** The capability a non-declaring client is told it lacks. */
const REQUIRED_CAPABILITIES = {
  extensions: { [TASKS_EXTENSION_ID]: {} },
} satisfies MissingRequiredClientCapabilityErrorData['requiredCapabilities']

/**
 * Whether the request's own client capabilities declare the extension. On the
 * 2026-07-28 revision a client declares per request, in the `_meta` envelope.
 * A 2025-era request carries no envelope, so it never declares it — which is
 * what keeps every 2025-era client on synchronous results.
 */
export function declaresTasks(ctx: ServerContext): boolean {
  const envelope: unknown = ctx.mcpReq.envelope
  if (!isRecord(envelope)) return false
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY]
  return (
    isRecord(capabilities) &&
    isRecord(capabilities.extensions) &&
    isRecord(capabilities.extensions[TASKS_EXTENSION_ID])
  )
}

/** The `-32021` a non-declaring client gets from every `tasks/*` method. */
function requireDeclared(ctx: ServerContext): void {
  if (declaresTasks(ctx)) return
  throw new MissingRequiredClientCapabilityError(
    { requiredCapabilities: REQUIRED_CAPABILITIES },
    // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
    `The ${TASKS_EXTENSION_ID} extension must be declared in this request's client capabilities.`,
  )
}

/** The `-32602` for a task id that names no live task. */
function unknownTask(taskId: string): ProtocolError {
  return new ProtocolError(
    ProtocolErrorCode.InvalidParams,
    // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
    `Unknown or expired taskId: ${taskId}`,
  )
}

/** An internal error a failed task carries, worded for the agent. */
function internalError(message: string): ProtocolError {
  return new ProtocolError(ProtocolErrorCode.InternalError, message)
}

/** Whether `args` pass the tool's input schema — a call that does not is never a task. */
async function argumentsValid(tool: RegisteredTool, args: unknown): Promise<boolean> {
  if (tool.inputSchema === undefined) return true
  const outcome = await tool.inputSchema['~standard'].validate(args ?? {})
  return outcome.issues === undefined
}

/**
 * Whether a finished result is the work's cancellation: a tool error coded
 * `cancelled` (`build_site`, `refresh_cache` — they stop with nothing to
 * report). A sync that stops between items is deliberately *not* one: its
 * answer to a cancel is the ordinary report flagged `report.cancelled`, whose
 * finished items are real, so the task completes and carries that report — a
 * `cancelled` task could carry no result at all. (The sync routes answer even a
 * signal aborted before they start with that report, never with a 499.)
 */
function isCancellation(result: CallToolResult): boolean {
  const content = result.structuredContent
  return result.isError === true && isRecord(content) && content.code === 'cancelled'
}

/**
 * A thrown error as the JSON-RPC error a failed task carries. Only a protocol
 * error's code is a JSON-RPC code; anything else (a library error with an
 * HTTP-style `code`) is an internal error.
 */
export function taskError(error: unknown): TaskError {
  const message = error instanceof Error ? error.message : String(error)
  if (!ProtocolError.isInstance(error)) return { code: ProtocolErrorCode.InternalError, message }
  const failure: TaskError = { code: error.code, message }
  if (error.data !== undefined) failure.data = error.data
  return failure
}

/** The request's `_meta` without its progress token: a task reports through its status. */
function withoutProgressToken(
  meta: ServerContext['mcpReq']['_meta'],
): ServerContext['mcpReq']['_meta'] {
  if (meta === undefined) return undefined
  const { progressToken: _progressToken, ...rest } = meta
  return rest
}

/**
 * What a task run's server-to-client request APIs answer. A task has no
 * request in flight to carry one (and on the stateless HTTP leg, no server
 * either), so they refuse rather than reach for a torn-down transport.
 */
function refuseServerRequest(): Promise<never> {
  return Promise.reject(
    // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
    internalError('A task run cannot send requests to the client.'),
  )
}

/**
 * The context a task run hands the tool: the creating request's, with the
 * task's own signal, no progress token, the answers of a `tasks/update`, and
 * nothing that reaches the wire — the spec forbids `notifications/progress`
 * and `notifications/message` on a task, and asks for input only through the
 * task itself.
 */
function runContext(
  ctx: ServerContext,
  signal: AbortSignal,
  inputResponses: Record<string, unknown> | undefined,
): ServerContext {
  return {
    ...ctx,
    mcpReq: {
      ...ctx.mcpReq,
      _meta: withoutProgressToken(ctx.mcpReq._meta),
      signal,
      inputResponses,
      droppedInputResponseKeys: undefined,
      notify: () => Promise.resolve(),
      log: () => Promise.resolve(),
      send: refuseServerRequest,
      elicitInput: refuseServerRequest,
      requestSampling: refuseServerRequest,
    },
  }
}

/** Whether this runtime may serve tasks, as far as it has found out. */
type Support = 'unverified' | 'supported' | 'unsupported'

/** How a runtime is configured. */
export type TaskRuntimeOptions = TaskStoreOptions & {
  /**
   * Switch off without telling the operator — for the startup probe's own
   * throwaway runtime, whose finding the shared runtime reports instead.
   */
  silent?: boolean
}

/**
 * The process-wide half of the runtime: the task store, the resumptions of
 * tasks waiting for input, and what each running task claimed. Shared by every
 * `McpServer` the process builds — the HTTP leg builds one per request — so a
 * task created on one request is found, answered, and cancelled from any later
 * one.
 */
export class TaskRuntime {
  readonly store: TaskStore
  /**
   * How each task waiting for input resumes. Dropped when the task is
   * answered or cancelled, and — through the store's eviction hook — when it
   * expires unanswered, so a closure (which holds its request's server) never
   * outlives its task.
   */
  readonly #resumes = new Map<string, Resume>()
  /** What each running task claimed, given back when it stops. */
  readonly #starts = new Map<string, TaskStart>()
  #support: Support = 'unverified'
  readonly #silent: boolean

  constructor(options: TaskRuntimeOptions = {}) {
    const { silent, ...storeOptions } = options
    this.#silent = silent === true
    this.store = new TaskStore({
      ...storeOptions,
      onEvict: (taskId) => {
        // A task evicted while waiting for input never resumes: drop its
        // closure and give back what it claimed.
        this.#resumes.delete(taskId)
        this.#release(taskId)
        storeOptions.onEvict?.(taskId)
      },
    })
  }

  /** Whether task support is (still) on. Unverified counts as on: the probe is the transports'. */
  get supported(): boolean {
    return this.#support !== 'unsupported'
  }

  /** Record what the startup probe found. Switching off is logged once, for the operator. */
  setSupported(supported: boolean): void {
    if (supported) {
      if (this.#support === 'unverified') this.#support = 'supported'
      return
    }
    if (this.#support === 'unsupported') return
    this.#support = 'unsupported'
    if (!this.#silent) console.error(t('cli.mcp.tasks.unavailable'))
  }

  /**
   * Install task support on a server whose tools are all registered: wrap its
   * `tools/call` handler, register the `tasks/*` methods, and advertise the
   * extension. Answers false, changing nothing, when task support is off or
   * the SDK no longer lets the handler be read back.
   */
  install(server: McpServer, tools: TaskTools): boolean {
    if (!this.supported) return false
    const low = server.server
    // `McpServer` installs its `tools/call` handler when it is constructed with
    // the `tools` capability, and the SDK offers no public way to read it back;
    // `_getRequestHandler` is the protected accessor its own subclasses use.
    const lookup = low as unknown as Partial<HandlerLookup>
    const installed =
      typeof lookup._getRequestHandler === 'function'
        ? lookup._getRequestHandler.call(low, TOOLS_CALL)
        : undefined
    if (installed === undefined) {
      this.setSupported(false)
      return false
    }
    // Calling the installed handler from the replacement means a synchronous
    // call is validated twice — once by the SDK's wrapper around this
    // replacement, once around the original. Both are the same idempotent
    // checks, and it is what keeps the work path identical to a plain call.
    const inner: ToolsCallHandler = async (request, ctx) => {
      const result = await installed(request, ctx)
      if (isInputRequiredResult(result) || isCallToolResult(result)) return result
      throw internalError(
        // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
        'The tools/call handler returned an unexpected result.',
      )
    }
    // The SDK types a tools/call result as complete or input-required only;
    // `resultType: 'task'` is the extension's, and the SDK passes it through
    // verbatim on this method (the startup probe checks it still does) — the
    // one cast of the extension's result.
    low.setRequestHandler(TOOLS_CALL, this.#wrapToolsCall(inner, tools.entries) as ToolsCallHandler)
    this.#registerTaskMethods(low)
    low.registerCapabilities({ extensions: { [TASKS_EXTENSION_ID]: {} } })
    return true
  }

  /**
   * Stop every task still in play — the server is shutting down. A working
   * task's signal is aborted (as a plain call's is when its transport closes);
   * a task waiting for input is cancelled on the spot.
   */
  abortAll(): void {
    for (const record of this.store.unfinished()) this.#cancel(record.taskId)
  }

  #wrapToolsCall(
    inner: ToolsCallHandler,
    tools: ReadonlyMap<string, TaskTool>,
  ): (
    request: CallToolRequest,
    ctx: ServerContext,
  ) => Promise<CallToolResult | InputRequiredResult | CreateTaskResult> {
    return async (request, ctx) => {
      // On every call, not only on task requests: a hung task holding the
      // build slot must give it up even when only plain calls arrive.
      this.#expireOverdue()
      const entry = tools.get(request.params.name)
      // A multi-round-trip retry (inputResponses) belongs to a plain call by
      // construction: a declaring client is never sent `input_required`.
      if (
        entry === undefined ||
        !declaresTasks(ctx) ||
        ctx.mcpReq.inputResponses !== undefined ||
        !(await argumentsValid(entry.tool, request.params.arguments))
      ) {
        return inner(request, ctx)
      }
      // Claimed, not checked: what the preflight claims is held for the task,
      // so a racing call cannot take it between this answer and the work.
      const start = entry.preflight === undefined ? NOTHING_CLAIMED : entry.preflight()
      if (start === undefined) return inner(request, ctx)

      let record: TaskRecord | undefined
      try {
        record = this.store.create(t('cli.mcp.task.status.working'))
        this.#starts.set(record.taskId, start)
        this.#runRound(entry.name, record, inner, request, ctx, undefined)
        return createTaskResult(record)
      } catch (error) {
        // Nothing may hold the claim, or leave a record working, past a
        // failure between claiming and starting the work.
        if (record === undefined) {
          start.release()
        } else {
          this.#fail(record.taskId, error)
          this.#release(record.taskId)
        }
        throw error
      }
    }
  }

  /**
   * Run (or, after a `tasks/update`, re-run) the task's work. The task record
   * exists before this is called, so `tasks/get` resolves the id from the
   * moment the `CreateTaskResult` is sent.
   */
  #runRound(
    tool: TaskToolName,
    record: TaskRecord,
    inner: ToolsCallHandler,
    request: CallToolRequest,
    ctx: ServerContext,
    inputResponses: Record<string, unknown> | undefined,
  ): void {
    const { taskId } = record
    const runCtx = runContext(ctx, record.controller.signal, inputResponses)
    bindTaskRun(runCtx, {
      onProgress: (report: RouteProgress) => {
        // A late step must not overwrite "Cancelling…".
        if (record.cancelRequested) return
        const line = taskProgressStatus(tool, report)
        if (line !== undefined) this.store.setStatusMessage(taskId, line)
      },
      buildClaim: this.#starts.get(taskId)?.buildClaim,
    })

    const settle = (result: CallToolResult | InputRequiredResult): void => {
      if (isInputRequiredResult(result)) {
        const requests = result.inputRequests
        if (record.cancelRequested) {
          this.store.markCancelled(taskId, t('cli.mcp.task.status.cancelled'))
        } else if (requests === undefined || Object.keys(requests).length === 0) {
          // A requestState-only round has no question a task could park on.
          // Ritual's tools never return one; report it rather than hang.
          this.#fail(
            taskId,
            // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
            internalError('The tool asked for input without any input requests.'),
          )
        } else {
          this.store.requireInput(taskId, requests, t('cli.mcp.task.status.awaitingInput'))
          // Only a task the store actually parked resumes (it may have been
          // failed as overdue meanwhile).
          if (record.state.status === 'input_required') {
            this.#resumes.set(taskId, (responses) =>
              this.#runRound(tool, record, inner, request, ctx, responses),
            )
          }
        }
        return
      }
      if (record.cancelRequested && isCancellation(result)) {
        this.store.markCancelled(taskId, t('cli.mcp.task.status.cancelled'))
        return
      }
      this.store.complete(
        taskId,
        { ...result, resultType: 'complete' },
        t(
          result.isError === true
            ? 'cli.mcp.task.status.toolError'
            : 'cli.mcp.task.status.completed',
        ),
      )
    }

    // `.catch` after `.then`, so a throw inside `settle` fails the task too
    // rather than leaving it `working` forever. A late failure cannot overwrite
    // a task that already ended: the store only finishes a working task.
    void inner(request, runCtx)
      .then(settle)
      .catch((error: unknown) => {
        // After a cancel, a thrown error is the cancel surfacing (an aborted
        // fetch, a CancelledError) and is recorded as `cancelled`, not `failed`.
        if (record.cancelRequested) {
          this.store.markCancelled(taskId, t('cli.mcp.task.status.cancelled'))
        } else {
          this.#fail(taskId, error)
        }
      })
      .finally(() => {
        if (record.state.status !== 'input_required') this.#release(taskId)
      })
  }

  #fail(taskId: string, error: unknown): void {
    const failure = taskError(error)
    this.store.fail(taskId, failure, t('cli.mcp.task.status.failed', { reason: failure.message }))
  }

  /** Give back what the task's preflight claimed, once. */
  #release(taskId: string): void {
    const start = this.#starts.get(taskId)
    this.#starts.delete(taskId)
    start?.release()
  }

  /**
   * Fail every task that has been working past the store's cap: its signal is
   * aborted (which may yet unstick the work), and it ends `failed` so a client
   * polling it stops. Run on every `tools/call` and task request. What the task
   * claimed is *not* released here: work still in flight (a build mid-publish)
   * keeps the slot until it actually ends, so one build at a time holds even
   * for a run that overstays.
   */
  #expireOverdue(): void {
    for (const record of this.store.overdue()) {
      record.controller.abort()
      this.#fail(
        record.taskId,
        // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
        internalError('The task ran past its time limit and was stopped.'),
      )
    }
  }

  /** Cancel a task: see {@link TaskStore.requestCancel}. */
  #cancel(taskId: string): CancelOutcome {
    const outcome = this.store.requestCancel(taskId, {
      cancelling: t('cli.mcp.task.status.cancelling'),
      cancelled: t('cli.mcp.task.status.cancelled'),
    })
    // A task cancelled while waiting for input never resumes: its question is
    // withdrawn, and nothing was written.
    if (outcome === 'cancelled') {
      this.#resumes.delete(taskId)
      this.#release(taskId)
    }
    return outcome
  }

  #registerTaskMethods(low: LowLevelServer): void {
    low.setRequestHandler(
      'tasks/get',
      { params: TASK_ID_PARAMS },
      ({ taskId }, ctx): GetTaskResult => {
        requireDeclared(ctx)
        this.#expireOverdue()
        const record = this.store.get(taskId)
        if (record === undefined) throw unknownTask(taskId)
        return getTaskResult(record)
      },
    )

    // The answers ride in `params.inputResponses`, which the SDK lifts onto
    // `ctx.mcpReq.inputResponses` (as it does for a retried call) before the
    // params reach this schema — dropping any entry that is not a bare
    // response (a wrapped `{ method, result }`).
    low.setRequestHandler(
      'tasks/update',
      { params: TASK_ID_PARAMS },
      ({ taskId }, ctx): TaskAck => {
        requireDeclared(ctx)
        this.#expireOverdue()
        if (this.store.get(taskId) === undefined) throw unknownTask(taskId)
        const responses = ctx.mcpReq.inputResponses ?? {}
        const dropped = ctx.mcpReq.droppedInputResponseKeys ?? []
        if (Object.keys(responses).length === 0 && dropped.length > 0) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
            `inputResponses must hold bare responses (an elicitation's { action, content }), not wrapped requests or results: ${dropped.join(', ')}`,
          )
        }
        const outcome = this.store.answer(taskId, responses, t('cli.mcp.task.status.working'))
        if (outcome.kind === 'complete') {
          const resume = this.#resumes.get(taskId)
          this.#resumes.delete(taskId)
          if (resume === undefined) {
            this.#fail(
              taskId,
              // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
              internalError('The task can no longer resume with these answers.'),
            )
            this.#release(taskId)
          } else {
            resume(outcome.responses)
          }
        }
        return {}
      },
    )

    low.setRequestHandler(
      'tasks/cancel',
      { params: TASK_ID_PARAMS },
      ({ taskId }, ctx): TaskAck => {
        requireDeclared(ctx)
        this.#expireOverdue()
        if (this.#cancel(taskId) === 'unknown') throw unknownTask(taskId)
        return {}
      },
    )
  }
}

/** The runtime every server in this process shares. */
export const sharedTaskRuntime = new TaskRuntime()
