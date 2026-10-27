/**
 * The task runtime's own decisions, against a stand-in tool so each one can be
 * steered: which calls stay synchronous, how progress becomes the status line,
 * how a task ends when its work answers, asks, throws, is cancelled, is shut
 * down, or runs too long. Served in-process through `createMcpHandler` (the
 * 2026-07-28 leg has no in-memory serving entry) with a fresh `TaskRuntime`
 * per test, so no socket, no network, and nothing shared between tests; the
 * HTTP listener, auth and a real sync are the integration suite's
 * (test/integration/mcp-tasks.test.ts).
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import {
  createMcpHandler,
  inputRequired,
  McpServer,
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server'
import { tryClaimBuild } from '../../../src/admin/api/build-site'
import { t } from '../../../src/i18n/t'
import { callApi } from '../../../src/mcp/dispatch'
import { CANCELLED_ERROR_CODE } from '../../../src/mcp/error-codes'
import { toolCallOptions } from '../../../src/mcp/progress'
import { bindTaskRun } from '../../../src/mcp/tasks/run-context'
import { structuredError, structuredResult } from '../../../src/mcp/result'
import { buildMcpServer } from '../../../src/mcp/server'
import {
  createTaskTools,
  taskError,
  TaskRuntime,
  type TaskPreflight,
  type TaskTools,
} from '../../../src/mcp/tasks/runtime'
import { probeTaskSupport } from '../../../src/mcp/tasks/probe'
import { TASK_TOOL_NAMES } from '../../../src/mcp/tasks/status'
import type { TaskStoreOptions } from '../../../src/mcp/tasks/store'
import {
  ackOf,
  createdTask,
  inProcessRpc,
  isTerminal,
  pollTask,
  rpcResult,
  waitUntil,
  type RpcSend,
} from '../../helpers/mcp-rpc'
import { captureConsole } from '../../helpers/capture'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

/** What the stand-in answers once its gate opens (or its signal aborts). */
type Answer = 'result' | 'ask' | 'state-only'

/** How the stand-in tool behaves; tests flip fields as they go. */
type StandIn = {
  answer: Answer
  /** Resolves when the test lets the work finish. */
  gate: Promise<void>
  /** Runs started, and the progress token each one saw. */
  tokens: unknown[]
  /**
   * Hold a cancelled run after its late progress step until this resolves, so
   * a test can read the status line between the step and the task's end.
   */
  holdAfterCancel?: Promise<void>
  /** The cancelled run reported its late step. */
  lateReported: boolean
}

/** One handler serving the stand-in, and the hands that steer it. */
type Harness = {
  standIn: StandIn
  runtime: TaskRuntime
  release: () => void
  tasks: RpcSend
  close: () => Promise<void>
}

let harness: Harness | undefined

afterEach(async () => {
  harness?.release()
  harness?.runtime.abortAll()
  await harness?.close()
  harness = undefined
})

/** What the stand-in returns for `answer`. */
function answerWith(answer: Answer): CallToolResult | InputRequiredResult {
  const form = inputRequired.elicit({
    message: 'Which list?',
    requestedSchema: { type: 'object', properties: {} },
  })
  switch (answer) {
    case 'result':
      return structuredResult({ built: true })
    case 'ask':
      return inputRequired({ inputRequests: { q: form } })
    case 'state-only':
      return inputRequired({ requestState: 'opaque' })
  }
}

/**
 * A server with one task tool, registered under `build_site` (the runtime only
 * enables task tool names): it reports one step of progress, waits for the
 * gate or its signal, and answers a cancellation the way `build_site` and
 * `refresh_cache` do — a tool error coded `cancelled`.
 */
function standInServer(
  runtime: TaskRuntime,
  standIn: StandIn,
  preflight?: TaskPreflight,
): McpServer {
  const server = new McpServer(
    { name: 'stand-in', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )
  const tools: TaskTools = createTaskTools()
  const tool = server.registerTool(
    'build_site',
    { inputSchema: z.object({}) },
    async (_args, ctx: ServerContext) => {
      standIn.tokens.push(ctx.mcpReq._meta?.progressToken)
      const { onProgress, signal } = toolCallOptions(ctx)
      onProgress?.({ progress: 1, total: 3 })
      if (signal?.aborted !== true) {
        await Promise.race([
          standIn.gate,
          new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())),
        ])
      }
      // A step reported after the cancel, as a sync between items would.
      onProgress?.({ progress: 2, total: 3 })
      if (signal?.aborted === true) {
        standIn.lateReported = true
        await standIn.holdAfterCancel
      }
      if (signal?.aborted === true && standIn.answer === 'result') {
        return structuredError({ error: true, code: 'cancelled', message: 'cancelled' })
      }
      return answerWith(standIn.answer)
    },
  )
  tools.enable('build_site', tool, preflight)
  runtime.install(server, tools)
  return server
}

function startHarness(
  options: { preflight?: TaskPreflight; store?: TaskStoreOptions } = {},
): Harness {
  let release = (): void => {}
  const standIn: StandIn = {
    answer: 'result',
    gate: new Promise<void>((resolve) => (release = resolve)),
    tokens: [],
    lateReported: false,
  }
  const runtime = new TaskRuntime(options.store)
  const handler = createMcpHandler(() => standInServer(runtime, standIn, options.preflight), {
    legacy: 'stateless',
  })
  harness = {
    standIn,
    runtime,
    release,
    tasks: inProcessRpc(handler, { declareTasks: true }),
    close: () => handler.close(),
  }
  return harness
}

/** Call the stand-in with a progress token, as a client asking for progress would. */
function callStandIn(send: RpcSend, extra: Record<string, unknown> = {}): ReturnType<RpcSend> {
  return send('tools/call', {
    name: 'build_site',
    arguments: {},
    _meta: { progressToken: 'p1' },
    ...extra,
  })
}

/** Start the stand-in as a task and wait until its work is running. */
async function startTask(h: Harness): Promise<string> {
  const { taskId } = createdTask(await callStandIn(h.tasks))
  await waitUntil(() => h.standIn.tokens.length === 1, 'the stand-in to start')
  return taskId
}

describe('TaskRuntime', () => {
  test('puts exactly the task’s keys on the wire, plus the SDK’s content: [] on creation', async () => {
    const h = startHarness()
    const created = rpcResult(await callStandIn(h.tasks))
    // `content: []` is the SDK's tools/call result wrapper's; `_meta` its server identity.
    expect(Object.keys(created).sort()).toEqual(
      [
        '_meta',
        'content',
        'createdAt',
        'lastUpdatedAt',
        'pollIntervalMs',
        'resultType',
        'status',
        'statusMessage',
        'taskId',
        'ttlMs',
      ].sort(),
    )
    expect(created.content).toEqual([])
    h.release()
    const done = await pollTask(h.tasks, created.taskId as string, isTerminal)
    expect(Object.keys(done).sort()).toEqual(
      [
        '_meta',
        'createdAt',
        'lastUpdatedAt',
        'pollIntervalMs',
        'result',
        'resultType',
        'status',
        'statusMessage',
        'taskId',
        'ttlMs',
      ].sort(),
    )
  })

  test('the startup probe finds this SDK carries a task through', async () => {
    expect(await probeTaskSupport()).toBe(true)
  })

  test('a runtime switched off says so once, installs nothing and advertises nothing', async () => {
    const runtime = new TaskRuntime()
    const { lines } = await captureConsole(['error'], () => {
      runtime.setSupported(false)
      runtime.setSupported(false)
    })
    expect(lines.error).toEqual([t('cli.mcp.tasks.unavailable')])
    const server = new McpServer({ name: 'off', version: '0' }, { capabilities: { tools: {} } })
    expect(runtime.install(server, createTaskTools())).toBe(false)
    expect(server.server.getCapabilities().extensions).toBeUndefined()
  })

  test('progress becomes the status line, and the work never sees a progress token', async () => {
    const h = startHarness()
    const { taskId } = createdTask(await callStandIn(h.tasks))
    const building = t('cli.mcp.task.buildSite.building')
    await pollTask(h.tasks, taskId, (task) => task.statusMessage === building)
    expect(h.standIn.tokens).toEqual([undefined])

    h.release()
    const done = await pollTask(h.tasks, taskId, isTerminal)
    expect(done).toMatchObject({
      status: 'completed',
      statusMessage: t('cli.mcp.task.status.completed'),
    })
  })

  test('a step reported after a cancel does not replace the "Cancelling…" line', async () => {
    const h = startHarness()
    let finish = (): void => {}
    h.standIn.holdAfterCancel = new Promise<void>((resolve) => (finish = resolve))
    const taskId = await startTask(h)
    ackOf(await h.tasks('tasks/cancel', { taskId }))
    await waitUntil(() => h.standIn.lateReported, 'the late progress step')
    expect(rpcResult(await h.tasks('tasks/get', { taskId })).statusMessage).toBe(
      t('cli.mcp.task.status.cancelling'),
    )
    finish()
    await pollTask(h.tasks, taskId, isTerminal)
  })

  test('a tool’s cancellation error ends the task cancelled, with no result', async () => {
    const h = startHarness()
    const taskId = await startTask(h)
    expect(ackOf(await h.tasks('tasks/cancel', { taskId }))).toEqual({ resultType: 'complete' })
    const task = await pollTask(h.tasks, taskId, isTerminal)
    expect(task).toMatchObject({
      status: 'cancelled',
      statusMessage: t('cli.mcp.task.status.cancelled'),
    })
    expect(task.result).toBeUndefined()

    // Cancelling a finished task is acknowledged and changes nothing.
    expect(ackOf(await h.tasks('tasks/cancel', { taskId }))).toEqual({ resultType: 'complete' })
    const after = rpcResult(await h.tasks('tasks/get', { taskId }))
    expect(after.status).toBe('cancelled')
    expect(after.result).toBeUndefined()
  })

  test('a question asked after a cancel ends the task cancelled', async () => {
    const h = startHarness()
    h.standIn.answer = 'ask'
    const taskId = await startTask(h)
    ackOf(await h.tasks('tasks/cancel', { taskId }))
    expect((await pollTask(h.tasks, taskId, isTerminal)).status).toBe('cancelled')
  })

  test('a question carrying no input requests fails the task rather than hang it', async () => {
    const h = startHarness()
    h.standIn.answer = 'state-only'
    const { taskId } = createdTask(await callStandIn(h.tasks))
    h.release()
    const task = await pollTask(h.tasks, taskId, isTerminal)
    expect(task.status).toBe('failed')
    expect(task.error).toMatchObject({ code: ProtocolErrorCode.InternalError })
  })

  test('a call whose preflight refuses is served synchronously', async () => {
    const h = startHarness({ preflight: () => undefined })
    h.release()
    const answer = rpcResult(await callStandIn(h.tasks))
    expect(answer.resultType).toBe('complete')
    expect(answer.structuredContent).toEqual({ built: true })
  })

  test('what a preflight claimed is released once, when the task ends', async () => {
    let released = 0
    const h = startHarness({ preflight: () => ({ release: () => released++ }) })
    const { taskId } = createdTask(await callStandIn(h.tasks))
    expect(released).toBe(0)
    h.release()
    await pollTask(h.tasks, taskId, isTerminal)
    await waitUntil(() => released === 1, 'the claim to be released')
    await Bun.sleep(20)
    expect(released).toBe(1)
  })

  test('a claim is held while the task waits for input, and released when it is cancelled', async () => {
    let released = 0
    const h = startHarness({ preflight: () => ({ release: () => released++ }) })
    h.standIn.answer = 'ask'
    const { taskId } = createdTask(await callStandIn(h.tasks))
    h.release()
    await pollTask(h.tasks, taskId, (task) => task.status === 'input_required')
    expect(released).toBe(0)
    ackOf(await h.tasks('tasks/cancel', { taskId }))
    expect(released).toBe(1)
  })

  test('a multi-round-trip retry is served synchronously', async () => {
    const h = startHarness()
    h.release()
    const answer = rpcResult(await callStandIn(h.tasks, { inputResponses: {} }))
    expect(answer.resultType).toBe('complete')
  })

  test('tasks/update with only wrapped responses is refused, not silently acknowledged', async () => {
    const h = startHarness()
    h.standIn.answer = 'ask'
    const { taskId } = createdTask(await callStandIn(h.tasks))
    h.release()
    const waiting = await pollTask(h.tasks, taskId, (task) => task.status === 'input_required')
    const [key] = Object.keys(waiting.inputRequests as Record<string, unknown>)
    const wrapped = { [key!]: { method: 'elicitation/create', result: { action: 'accept' } } }
    const answer = await h.tasks('tasks/update', { taskId, inputResponses: wrapped })
    expect(answer.error?.code).toBe(-32602)
    expect(rpcResult(await h.tasks('tasks/get', { taskId })).status).toBe('input_required')
  })

  test('abortAll — the shutdown path — cancels a running task', async () => {
    const h = startHarness()
    const taskId = await startTask(h)
    h.runtime.abortAll()
    expect((await pollTask(h.tasks, taskId, isTerminal)).status).toBe('cancelled')
  })

  test('a task working past the cap is aborted and failed', async () => {
    const h = startHarness({ store: { maxWorkingMs: 50 } })
    const taskId = await startTask(h)
    await Bun.sleep(60)
    const task = rpcResult(await h.tasks('tasks/get', { taskId }))
    expect(task).toMatchObject({
      status: 'failed',
      error: { code: ProtocolErrorCode.InternalError },
    })
  })
})

/**
 * A tool callback's own throw never reaches the runtime — `McpServer` turns it
 * into an `isError` result — so the thrown-error path is pinned on its mapping.
 */
describe('taskError', () => {
  test('keeps a protocol error’s code and data; anything else is an internal error', () => {
    const invalid = new ProtocolError(ProtocolErrorCode.InvalidParams, 'bad', { field: 'x' })
    expect(taskError(invalid)).toEqual({
      code: ProtocolErrorCode.InvalidParams,
      message: 'bad',
      data: { field: 'x' },
    })
    const httpish = Object.assign(new Error('not found'), { code: 404 })
    expect(taskError(httpish)).toEqual({
      code: ProtocolErrorCode.InternalError,
      message: 'not found',
    })
  })
})

describe('the build slot a build_site task claimed', () => {
  let env: RitualTestEnv | undefined

  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  test('reaches the tool through its task run', () => {
    const claim = tryClaimBuild()
    try {
      expect(claim).toBeDefined()
      const ctx = { mcpReq: { signal: new AbortController().signal } } as unknown as ServerContext
      bindTaskRun(ctx, { onProgress: () => {}, buildClaim: claim })
      expect(toolCallOptions(ctx).buildClaim).toBe(claim)
    } finally {
      claim?.release()
    }
  })

  test('is what the build route runs on, from the dispatcher down', async () => {
    env = await setupRitualTestEnv()
    const claim = tryClaimBuild()
    expect(claim).toBeDefined()
    // A dropped claim would make the route claim for itself, find the slot
    // taken by this very claim, and refuse: "busy". Carried through, the build
    // runs on it — and, cancelled before it starts, answers "cancelled".
    const call = callApi('POST', '/api/build-site', undefined, {
      buildClaim: claim,
      signal: AbortSignal.abort(),
    })
    expect(await call.catch((error: unknown) => taskError(error).code)).toBe(CANCELLED_ERROR_CODE)
    expect(claim?.held()).toBe(false)
  })
})

describe('buildMcpServer', () => {
  let env: RitualTestEnv | undefined

  afterEach(async () => {
    await env?.cleanup()
    env = undefined
  })

  test('enables exactly the task tools', () => {
    let enabled: string[] = []
    class RecordingRuntime extends TaskRuntime {
      override install(server: McpServer, tools: TaskTools): boolean {
        enabled = [...tools.entries.keys()]
        return super.install(server, tools)
      }
    }
    buildMcpServer({ taskRuntime: new RecordingRuntime() })
    expect(enabled.sort()).toEqual([...TASK_TOOL_NAMES].sort())
  })

  test('a build_site the one-build slot refuses is answered synchronously, not as a task', async () => {
    env = await setupRitualTestEnv()
    const runtime = new TaskRuntime()
    const handler = createMcpHandler(() => buildMcpServer({ taskRuntime: runtime }), {
      legacy: 'stateless',
    })
    const tasks = inProcessRpc(handler, { declareTasks: true })
    const held = tryClaimBuild()
    try {
      expect(held).toBeDefined()
      const answer = rpcResult(await tasks('tools/call', { name: 'build_site', arguments: {} }))
      expect(answer.resultType).toBe('complete')
      expect(answer.isError).toBe(true)
      expect(runtime.store.unfinished()).toEqual([])
    } finally {
      held?.release()
      runtime.abortAll()
      await handler.close()
    }
  })
})
