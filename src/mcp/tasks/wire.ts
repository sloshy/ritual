/**
 * The wire shapes of the MCP Tasks extension (SEP-2663, protocol revision
 * 2026-07-28), and the projection of a {@link TaskRecord} onto them.
 *
 * Both results are flat: `CreateTaskResult` is `Result & Task` and
 * `GetTaskResult` is `Result & DetailedTask` — the task's fields sit on the
 * result itself, not under a `task` key. The SDK ships no types for this
 * revision of the extension (its `Task` types are the 2025-11-25 ones), so they
 * are declared here.
 */

import type { InputRequests } from '@modelcontextprotocol/server'
import type { TaskError, TaskRecord, TaskResult, TaskStatus } from './store'

/** The extension's identifier, as declared under `capabilities.extensions`. */
export const TASKS_EXTENSION_ID = 'io.modelcontextprotocol/tasks'

/**
 * How often a client is asked to poll `tasks/get`. Claude Code honours it
 * (clamped to 250 ms – 30 s); the four task tools run for seconds to minutes and
 * report coarse steps, so two seconds loses nothing a person would notice while
 * keeping an idle poller cheap.
 */
export const TASK_POLL_INTERVAL_MS = 2_000

/**
 * The `Task` fields every task result carries. A type alias, not an interface:
 * the SDK's handler result is an index-signature record, which only an alias
 * is implicitly assignable to.
 */
export type WireTask = {
  taskId: string
  status: TaskStatus
  statusMessage?: string
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601. */
  lastUpdatedAt: string
  /** Kept this long after `createdAt`; `null` while it is still running. */
  ttlMs: number | null
  pollIntervalMs: number
}

/** `tools/call`'s answer when the server chose to run the call as a task. */
export type CreateTaskResult = WireTask & { resultType: 'task' }

/** `tasks/get`'s answer: the task, plus what its status makes available. */
export type GetTaskResult = WireTask & {
  /** On `completed`: the result the call would have returned synchronously. */
  result?: TaskResult
  /** On `failed`: the JSON-RPC error the call would have raised. */
  error?: TaskError
  /** On `input_required`: the requests awaiting a `tasks/update`. */
  inputRequests?: InputRequests
}

/** The `Task` fields of a record. */
export function wireTask(record: TaskRecord): WireTask {
  const task: WireTask = {
    taskId: record.taskId,
    status: record.state.status,
    createdAt: new Date(record.createdAt).toISOString(),
    lastUpdatedAt: new Date(record.lastUpdatedAt).toISOString(),
    ttlMs: record.ttlMs,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  }
  if (record.statusMessage !== undefined) task.statusMessage = record.statusMessage
  return task
}

/** The `CreateTaskResult` announcing a task just created. */
export function createTaskResult(record: TaskRecord): CreateTaskResult {
  return { resultType: 'task', ...wireTask(record) }
}

/** The `GetTaskResult` for a record, with the payload its status carries inlined. */
export function getTaskResult(record: TaskRecord): GetTaskResult {
  const task: GetTaskResult = wireTask(record)
  const { state } = record
  switch (state.status) {
    case 'completed':
      task.result = state.result
      break
    case 'failed':
      task.error = state.error
      break
    case 'input_required': {
      // Only what is still unanswered: a client that answered some forms with
      // a partial update must not be shown them again.
      const outstanding: InputRequests = {}
      for (const [key, request] of Object.entries(state.inputRequests)) {
        if (!Object.hasOwn(state.answers, key)) outstanding[key] = request
      }
      task.inputRequests = outstanding
      break
    }
    case 'working':
    case 'cancelled':
      break
  }
  return task
}
