/**
 * The task state machine behind the MCP Tasks extension
 * (`io.modelcontextprotocol/tasks`, SEP-2663) — pure state, no SDK runtime.
 *
 * A task is born `working`; it may go to `input_required` and back to `working`
 * any number of times; it ends `completed`, `failed`, or `cancelled`, and a
 * terminal task never moves again. Everything a client reads back through
 * `tasks/get` lives on the {@link TaskRecord}; the runtime that drives the
 * transitions (`runtime.ts`) owns the work itself.
 *
 * The store is process-wide on purpose. The stateless HTTP leg builds a fresh
 * `McpServer` per request, so the request that created a task and the one that
 * polls it never share a server instance — only this store.
 *
 * Status text is passed in by the caller: the store neither knows nor cares
 * which language a status line is worded in.
 */

import { randomUUID } from 'node:crypto'
import type { CallToolResult, InputRequests } from '@modelcontextprotocol/server'

/** The JSON-RPC error a `failed` task carries. */
export type TaskError = {
  code: number
  message: string
  data?: unknown
}

/** A completed task's result: the tool's own result, stamped as a complete one. */
export type TaskResult = CallToolResult & { resultType: 'complete' }

/** The status-specific half of a task's state. */
export type TaskState =
  | { status: 'working' }
  | {
      status: 'input_required'
      /** The outstanding requests, under their task-unique keys. */
      inputRequests: InputRequests
      /** Answers received so far, under the same keys. */
      answers: Record<string, unknown>
      /** This round's key prefix, stripped again when the answers are handed back. */
      prefix: string
    }
  | { status: 'completed'; result: TaskResult }
  | { status: 'failed'; error: TaskError }
  | { status: 'cancelled' }

/** Where a task is in its life. */
export type TaskStatus = TaskState['status']

/** One task, as the store keeps it. */
export interface TaskRecord {
  readonly taskId: string
  /** Epoch milliseconds. */
  readonly createdAt: number
  /** Epoch milliseconds; moves with every status or status-message change. */
  lastUpdatedAt: number
  statusMessage?: string
  state: TaskState
  /**
   * How long after `createdAt` the task is kept, or `null` while it is working
   * (a running task is never discarded). Set whenever the task stops running.
   */
  ttlMs: number | null
  /** When the task last went `working` (created, or resumed with answers). */
  runningSince: number
  /** A `tasks/cancel` arrived; the work may or may not honour it. */
  cancelRequested: boolean
  /** Rounds of input asked so far — what keeps input keys unique per task. */
  inputRounds: number
  /** Aborted by `tasks/cancel`; the work's own cancellation signal. */
  readonly controller: AbortController
}

/** What delivering answers to a task amounted to. */
export type AnswerOutcome =
  /** Nothing outstanding matched: the task is not waiting, or the keys are stale. */
  | { kind: 'ignored' }
  /** Some answers arrived; the task still waits for the rest. */
  | { kind: 'pending' }
  /** Every request is answered: the task is working again, with these answers. */
  | { kind: 'complete'; responses: Record<string, unknown> }

/** What a `tasks/cancel` amounted to. */
export type CancelOutcome =
  /** No such task (or it expired). */
  | 'unknown'
  /** A working task: its signal is aborted, and it ends when the work notices. */
  | 'signalled'
  /** A task waiting for input: nothing was running, so it is cancelled now. */
  | 'cancelled'
  /** Already finished: nothing to do. */
  | 'finished'

/** The status lines a cancel may leave a task with. */
export type CancelMessages = {
  /** A working task, asked to stop and not yet stopped. */
  cancelling: string
  /** A task cancelled on the spot. */
  cancelled: string
}

/** How a store is configured; every field has a production default. */
export interface TaskStoreOptions {
  /** The clock, in epoch milliseconds. */
  now?: () => number
  /** Mints a task id. Must be unguessable: a task id is all `tasks/get` asks for. */
  newId?: () => string
  /** How long a task is kept once it stops running. */
  retentionMs?: number
  /** Told the id of every task the sweep discards. */
  onEvict?: (taskId: string) => void
  /** How long a task may stay `working` before {@link TaskStore.overdue} reports it. */
  maxWorkingMs?: number
}

/** An hour: long enough to read a result after a coffee, short enough not to pile up. */
export const DEFAULT_TASK_RETENTION_MS = 60 * 60 * 1000

/**
 * Six hours. The longest realistic run is a large collection push or deck sync
 * paced to Archidekt's 80 requests a minute — a few thousand paced writes is
 * about three hours (a push of many *new* printings is refused without
 * `csv: true`, which uploads them in one request) — and twice that leaves room
 * for a slow link. A task still `working` past it is taken to be hung.
 */
export const DEFAULT_MAX_WORKING_MS = 6 * 60 * 60 * 1000

/**
 * The task store.
 *
 * Expired tasks are swept lazily, on every create and lookup, so there is no
 * timer to keep a process alive or to stop; a task nobody asks about again is
 * collected by the next task request.
 */
export class TaskStore {
  readonly #tasks = new Map<string, TaskRecord>()
  readonly #now: () => number
  readonly #newId: () => string
  readonly #retentionMs: number
  readonly #onEvict: ((taskId: string) => void) | undefined
  readonly #maxWorkingMs: number

  constructor(options: TaskStoreOptions = {}) {
    this.#now = options.now ?? Date.now
    this.#newId = options.newId ?? randomUUID
    this.#retentionMs = options.retentionMs ?? DEFAULT_TASK_RETENTION_MS
    this.#onEvict = options.onEvict
    this.#maxWorkingMs = options.maxWorkingMs ?? DEFAULT_MAX_WORKING_MS
  }

  /** Start a task: `working`, with nothing yet to report. */
  create(statusMessage?: string): TaskRecord {
    this.#sweep()
    const now = this.#now()
    const record: TaskRecord = {
      taskId: this.#newId(),
      createdAt: now,
      lastUpdatedAt: now,
      statusMessage,
      state: { status: 'working' },
      ttlMs: null,
      runningSince: now,
      cancelRequested: false,
      inputRounds: 0,
      controller: new AbortController(),
    }
    this.#tasks.set(record.taskId, record)
    return record
  }

  /** A live task, or `undefined` when there is none (never was, or expired). */
  get(taskId: string): TaskRecord | undefined {
    this.#sweep()
    return this.#tasks.get(taskId)
  }

  /** Tasks still in play — working or waiting for input. */
  unfinished(): TaskRecord[] {
    this.#sweep()
    return [...this.#tasks.values()].filter(
      (record) => record.state.status === 'working' || record.state.status === 'input_required',
    )
  }

  /** Working tasks that have run past the store's `maxWorkingMs` without settling. */
  overdue(): TaskRecord[] {
    const now = this.#now()
    return this.unfinished().filter(
      (record) =>
        record.state.status === 'working' && now - record.runningSince >= this.#maxWorkingMs,
    )
  }

  /**
   * Replace a working task's status line. A line equal to the current one is
   * not an update, so a chatty progress source does not churn `lastUpdatedAt`.
   */
  setStatusMessage(taskId: string, message: string): void {
    const record = this.#tasks.get(taskId)
    if (record?.state.status !== 'working' || record.statusMessage === message) return
    record.statusMessage = message
    record.lastUpdatedAt = this.#now()
  }

  /**
   * Park a working task on questions for the client. The keys are prefixed
   * with the round number, so a key is never reused over the task's lifetime
   * even when the work asks the same thing twice.
   */
  requireInput(taskId: string, requests: InputRequests, statusMessage: string): void {
    const record = this.#tasks.get(taskId)
    if (record?.state.status !== 'working') return
    record.inputRounds += 1
    const prefix = `${record.inputRounds}/`
    const inputRequests: InputRequests = {}
    for (const [key, request] of Object.entries(requests))
      inputRequests[`${prefix}${key}`] = request
    record.state = { status: 'input_required', inputRequests, answers: {}, prefix }
    this.#stop(record, statusMessage)
  }

  /**
   * Deliver answers to a task waiting for input. Keys that are not outstanding
   * are ignored (the spec's SHOULD); the task resumes once every outstanding
   * request has an answer, and the answers come back under the keys the work
   * asked with.
   */
  answer(taskId: string, responses: Record<string, unknown>, statusMessage: string): AnswerOutcome {
    const record = this.#tasks.get(taskId)
    if (record?.state.status !== 'input_required') return { kind: 'ignored' }
    const { inputRequests, answers, prefix } = record.state
    const matched = Object.keys(responses).filter((key) => Object.hasOwn(inputRequests, key))
    if (matched.length === 0) return { kind: 'ignored' }
    for (const key of matched) answers[key] = responses[key]
    record.lastUpdatedAt = this.#now()
    if (Object.keys(inputRequests).some((key) => !Object.hasOwn(answers, key))) {
      return { kind: 'pending' }
    }
    const unprefixed: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(answers)) unprefixed[key.slice(prefix.length)] = value
    record.state = { status: 'working' }
    record.ttlMs = null
    record.runningSince = this.#now()
    record.statusMessage = statusMessage
    return { kind: 'complete', responses: unprefixed }
  }

  /** End a working task with its result. */
  complete(taskId: string, result: TaskResult, statusMessage: string): void {
    this.#finish(taskId, { status: 'completed', result }, statusMessage)
  }

  /** End a working task with the JSON-RPC error its work raised. */
  fail(taskId: string, error: TaskError, statusMessage: string): void {
    this.#finish(taskId, { status: 'failed', error }, statusMessage)
  }

  /** End a working task as cancelled — the work honoured a `tasks/cancel`. */
  markCancelled(taskId: string, statusMessage: string): void {
    this.#finish(taskId, { status: 'cancelled' }, statusMessage)
  }

  /**
   * Handle a `tasks/cancel`. Cancellation is cooperative: a working task's
   * signal is aborted and the task ends whenever (and however) the work
   * responds to it; a task waiting for input has nothing running, so it is
   * cancelled on the spot.
   */
  requestCancel(taskId: string, messages: CancelMessages): CancelOutcome {
    const record = this.get(taskId)
    if (record === undefined) return 'unknown'
    switch (record.state.status) {
      case 'working':
        if (!record.cancelRequested) {
          record.cancelRequested = true
          record.statusMessage = messages.cancelling
          record.lastUpdatedAt = this.#now()
          record.controller.abort()
        }
        return 'signalled'
      case 'input_required':
        record.cancelRequested = true
        // Nothing is running, but a cancelled task's signal is always aborted.
        record.controller.abort()
        record.state = { status: 'cancelled' }
        this.#stop(record, messages.cancelled)
        return 'cancelled'
      case 'completed':
      case 'failed':
      case 'cancelled':
        return 'finished'
    }
  }

  #finish(taskId: string, state: TaskState, statusMessage: string): void {
    const record = this.#tasks.get(taskId)
    if (record?.state.status !== 'working') return
    record.state = state
    this.#stop(record, statusMessage)
  }

  /** The task stopped running: stamp it, and start its retention clock. */
  #stop(record: TaskRecord, statusMessage: string): void {
    const now = this.#now()
    record.statusMessage = statusMessage
    record.lastUpdatedAt = now
    record.ttlMs = now - record.createdAt + this.#retentionMs
    // A long-lived process (stdio) may go quiet after this; collect what has
    // expired now rather than only on the next request.
    this.#sweep()
  }

  #sweep(): void {
    const now = this.#now()
    for (const [taskId, record] of this.#tasks) {
      if (record.ttlMs !== null && now >= record.createdAt + record.ttlMs) {
        this.#tasks.delete(taskId)
        this.#onEvict?.(taskId)
      }
    }
  }
}
