/**
 * The startup self-check for task support.
 *
 * A task's `CreateTaskResult` reaches the wire through the SDK's own
 * `tools/call` result wrapper, which validates it as a `CallToolResult`. It
 * passes today only because the 2026-07-28 `resultType` is an open string and
 * that result schema is loose (the wrapper also adds `content: []`). A future
 * SDK that narrows either would reject every task — so before a transport
 * serves, one task is driven end to end in-process: created through a probe
 * server set up exactly like Ritual's, read back with `tasks/get`. If anything
 * on the way is refused or reshaped, task support is switched off (the
 * extension is not advertised; every call answers synchronously, which the
 * spec allows) and the operator is told once.
 */

import { z } from 'zod'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { isRecord } from '../../util/json'
import { createTaskTools, TaskRuntime } from './runtime'
import type { TaskToolName } from './status'
import { TASKS_EXTENSION_ID } from './wire'

const PROBE_ENDPOINT = 'http://ritual-task-probe/mcp'
const PROTOCOL_VERSION = '2026-07-28'
const PROBE_TOOL = 'build_site' satisfies TaskToolName

/** A JSON-RPC request as the probe sends it. */
type ProbeRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

/**
 * Every key a `CreateTaskResult` may carry on the wire: the task's fields, the
 * result discriminator, the SDK's server-identity `_meta`, and the `content: []`
 * its `tools/call` wrapper adds to every result.
 */
const CREATE_TASK_RESULT_KEYS = new Set([
  'resultType',
  'taskId',
  'status',
  'statusMessage',
  'createdAt',
  'lastUpdatedAt',
  'ttlMs',
  'pollIntervalMs',
  'content',
  '_meta',
])

/** A probe server: one task tool, installed the way `buildMcpServer` installs. */
function probeServer(runtime: TaskRuntime): McpServer {
  const server = new McpServer(
    { name: 'ritual-task-probe', version: '0' },
    { capabilities: { tools: {} } },
  )
  const tools = createTaskTools()
  tools.enable(
    PROBE_TOOL,
    server.registerTool(PROBE_TOOL, { inputSchema: z.object({}) }, () => ({ content: [] })),
  )
  runtime.install(server, tools)
  return server
}

/** Send one 2026-07-28 request declaring the extension, and return its `result`. */
async function send(
  handler: ReturnType<typeof createMcpHandler>,
  method: string,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const body: ProbeRequest = {
    jsonrpc: '2.0',
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': { name: 'ritual-task-probe', version: '0' },
        'io.modelcontextprotocol/clientCapabilities': { extensions: { [TASKS_EXTENSION_ID]: {} } },
      },
    },
  }
  const response = await handler.fetch(
    new Request(PROBE_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': PROTOCOL_VERSION,
        'mcp-method': method,
        'mcp-name': name,
      },
      body: JSON.stringify(body),
    }),
  )
  if (!(response.headers.get('content-type') ?? '').includes('application/json')) return undefined
  const message: unknown = await response.json()
  return isRecord(message) && isRecord(message.result) ? message.result : undefined
}

/** Whether the SDK in use still carries a task from creation to `tasks/get`. */
export async function probeTaskSupport(): Promise<boolean> {
  const runtime = new TaskRuntime({ silent: true })
  let handler: ReturnType<typeof createMcpHandler> | undefined
  try {
    handler = createMcpHandler(() => probeServer(runtime), {
      legacy: 'stateless',
      onerror: () => {},
    })
    const created = await send(handler, 'tools/call', PROBE_TOOL, {
      name: PROBE_TOOL,
      arguments: {},
    })
    if (
      created === undefined ||
      created.resultType !== 'task' ||
      typeof created.taskId !== 'string' ||
      Object.keys(created).some((key) => !CREATE_TASK_RESULT_KEYS.has(key))
    ) {
      return false
    }
    // `Mcp-Name` carries the task id on tasks/get: SEP-2663's HTTP binding.
    const read = await send(handler, 'tasks/get', created.taskId, { taskId: created.taskId })
    return read?.taskId === created.taskId
  } catch {
    return false
  } finally {
    runtime.abortAll()
    await handler?.close().catch(() => {})
  }
}

/** One probe per runtime, however many transports start. */
const verified = new WeakMap<TaskRuntime, Promise<void>>()

/**
 * Probe once and record the outcome on `runtime`. The transports await this
 * before serving, so no client ever sees the extension advertised by a server
 * that would then not honour it.
 */
export function verifyTaskSupport(runtime: TaskRuntime): Promise<void> {
  let pending = verified.get(runtime)
  if (pending === undefined) {
    // A probe that breaks in a way it did not catch still only switches tasks
    // off: it must never keep a server from starting.
    pending = probeTaskSupport()
      .catch(() => false)
      .then((supported) => runtime.setSupported(supported))
    verified.set(runtime, pending)
  }
  return pending
}
