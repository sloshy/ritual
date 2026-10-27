/**
 * Raw 2026-07-28 JSON-RPC against Ritual's MCP Streamable HTTP handler.
 *
 * The SDK client refuses a `tools/call` answered with `resultType: "task"` (it
 * knows only complete and input-required results), and it has no `tasks/*`
 * methods for this revision — so the Tasks-extension suites speak the wire
 * themselves: the per-request `_meta` envelope, and the standard request
 * headers (`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) the HTTP leg
 * validates on every modern request.
 *
 * The protocol version and the extension id are spelled out here rather than
 * imported from `src/`, so they check the server's wire values independently.
 */

import { isRecord } from '../../src/util/json'

const PROTOCOL_VERSION = '2026-07-28'

/** The bearer token the MCP HTTP suites start their servers with. */
export const TEST_BEARER_TOKEN = 'integration-secret'
const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks'

/** A JSON-RPC error object as it arrives. */
export type RpcWireError = { code: number; message: string; data?: unknown }

/** One JSON-RPC answer: a result or an error, plus the HTTP status it came with. */
export type RpcAnswer = {
  status: number
  result?: Record<string, unknown>
  error?: RpcWireError
}

/**
 * How a request reaches the server: global `fetch`, or a handler's own
 * in-process `fetch`. URL plus init rather than a `Request`, so a stubbed
 * global `fetch` passing loopback traffic through can still read the body.
 */
export type RpcTransport = (url: URL, init: RequestInit) => Promise<Response>

/** Who is asking: whether the request declares the Tasks extension (and elicitation), and its token. */
export type RpcClientOptions = {
  declareTasks: boolean
  /** Declare form elicitation too. Defaults to true. */
  declareElicitation?: boolean
  token?: string
}

/** Sends one request and returns its answer. */
export type RpcSend = (method: string, params?: Record<string, unknown>) => Promise<RpcAnswer>

/** The body field `Mcp-Name` mirrors, per method (SEP-2243 plus SEP-2663's binding). */
const MCP_NAME_FIELD: Record<string, string> = {
  'tools/call': 'name',
  'tasks/get': 'taskId',
  'tasks/update': 'taskId',
  'tasks/cancel': 'taskId',
}

function isRpcWireError(value: unknown): value is RpcWireError {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string'
}

/**
 * Read the JSON-RPC message out of a JSON or SSE response body. The SSE reader
 * assumes one `data:` line per event, which is how the SDK frames them.
 */
function parseBody(contentType: string, text: string): unknown {
  if (!contentType.includes('text/event-stream')) return JSON.parse(text)
  const messages = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice('data:'.length)) as unknown)
  return messages.findLast(
    (message) => isRecord(message) && ('result' in message || 'error' in message),
  )
}

/** A sender for one modern-era client against `endpoint`. */
export function modernRpc(
  endpoint: URL,
  options: RpcClientOptions,
  transport: RpcTransport = (url, init) => fetch(url, init),
): RpcSend {
  let nextId = 1
  return async (method, params = {}) => {
    const clientCapabilities: Record<string, unknown> = {}
    if (options.declareElicitation !== false) clientCapabilities.elicitation = { form: {} }
    if (options.declareTasks) clientCapabilities.extensions = { [TASKS_EXTENSION_ID]: {} }
    const body = {
      jsonrpc: '2.0',
      id: nextId++,
      method,
      params: {
        ...params,
        _meta: {
          // A caller's own `_meta` (a progress token) rides beside the envelope.
          ...(isRecord(params._meta) ? params._meta : {}),
          'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'test-tasks', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': clientCapabilities,
        },
      },
    }
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': PROTOCOL_VERSION,
      'mcp-method': method,
    }
    const nameField = MCP_NAME_FIELD[method]
    const name = nameField === undefined ? undefined : params[nameField]
    if (typeof name === 'string') headers['mcp-name'] = name
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`

    const response = await transport(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const message = parseBody(response.headers.get('content-type') ?? '', await response.text())
    if (!isRecord(message)) throw new Error(`No JSON-RPC answer to ${method}`)
    const answer: RpcAnswer = { status: response.status }
    if (isRecord(message.result)) answer.result = message.result
    if (isRpcWireError(message.error)) answer.error = message.error
    return answer
  }
}

/** A sender speaking to an MCP handler's own in-process `fetch` — no socket. */
export function inProcessRpc(handler: InProcessHandler, options: RpcClientOptions): RpcSend {
  return modernRpc(new URL('http://ritual.test/mcp'), options, (url, init) =>
    handler.fetch(new Request(url, init)),
  )
}

/** Anything that serves a `Request` the way `createMcpHandler`'s handler does. */
export type InProcessHandler = { fetch: (request: Request) => Promise<Response> }

/** The result of an answer that must have succeeded. */
export function rpcResult(answer: RpcAnswer): Record<string, unknown> {
  if (answer.result === undefined) {
    throw new Error(
      `Expected a result, got ${JSON.stringify(answer.error)} (HTTP ${answer.status})`,
    )
  }
  return answer.result
}

/** A `CreateTaskResult`, as far as the suites read it. */
export type CreatedTask = { taskId: string; status: unknown; resultType: unknown } & Record<
  string,
  unknown
>

/** The `CreateTaskResult` a `tools/call` must have answered with. */
export function createdTask(answer: RpcAnswer): CreatedTask {
  const result = rpcResult(answer)
  if (result.resultType !== 'task' || typeof result.taskId !== 'string') {
    throw new Error(`Expected a task, got ${JSON.stringify(result)}`)
  }
  return { ...result, taskId: result.taskId, status: result.status, resultType: 'task' }
}

/** A task as `tasks/get` returns it. */
export type PolledTask = Record<string, unknown>

/** How long a poll waits, well inside the test runner's 5 s per-test timeout. */
export const POLL_BUDGET_MS = 3_000

/**
 * Poll `tasks/get` until `done(task)`, returning that task. Gives up after
 * {@link POLL_BUDGET_MS}, so a stuck task fails with its status rather than as
 * a bare time-out.
 */
export async function pollTask(
  send: RpcSend,
  taskId: string,
  done: (task: PolledTask) => boolean,
): Promise<PolledTask> {
  const deadline = Date.now() + POLL_BUDGET_MS
  for (;;) {
    const task = rpcResult(await send('tasks/get', { taskId }))
    if (done(task)) return task
    if (Date.now() > deadline) {
      throw new Error(
        `Task ${taskId} stuck at ${String(task.status)} (${String(task.statusMessage)})`,
      )
    }
    await Bun.sleep(25)
  }
}

/** Whether a task reached a status it never leaves. */
export function isTerminal(task: PolledTask): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
}

/** The empty acknowledgement `tasks/update` and `tasks/cancel` answer with. */
export function ackOf(answer: RpcAnswer): Record<string, unknown> {
  // `_meta` is the SDK's server-identity stamp on every 2026-era result.
  const { _meta: _stamp, ...ack } = rpcResult(answer)
  return ack
}

/** Wait (at most 1 s) until `ready()` holds — a run reaching the point a test holds it at. */
export async function waitUntil(ready: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(10)
  }
}
