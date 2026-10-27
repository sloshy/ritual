import { describe, expect, test } from 'bun:test'
import { inputRequired } from '@modelcontextprotocol/server'
import { TaskStore, type CancelMessages, type TaskResult } from '../../../src/mcp/tasks/store'
import { getTaskResult } from '../../../src/mcp/tasks/wire'

const RETENTION_MS = 1_000
const CANCEL_MESSAGES = {
  cancelling: 'cancelling',
  cancelled: 'cancelled',
} satisfies CancelMessages
const RESULT: TaskResult = { content: [], structuredContent: { ok: true }, resultType: 'complete' }

/** A form the work asks; the store never looks inside one. */
const FORM = inputRequired.elicit({
  message: 'Which list?',
  requestedSchema: { type: 'object', properties: {} },
})

/** A store on a hand-driven clock, and the hand that moves it. */
type StoreHarness = { store: TaskStore; advance: (ms: number) => void }

/** A store on a hand-driven clock, minting predictable ids. */
function harness(): StoreHarness {
  let now = 10_000
  let ids = 0
  const store = new TaskStore({
    now: () => now,
    newId: () => `task-${++ids}`,
    retentionMs: RETENTION_MS,
  })
  return { store, advance: (ms) => (now += ms) }
}

describe('TaskStore', () => {
  test('keeps a finished task for an hour by default', () => {
    let now = 0
    const store = new TaskStore({ now: () => now })
    const { taskId } = store.create()
    store.complete(taskId, RESULT, 'done')
    now += 60 * 60 * 1000 - 1
    expect(store.get(taskId)).toBeDefined()
    now += 1
    expect(store.get(taskId)).toBeUndefined()
  })

  test('reports a task working past its cap, counted from when it last resumed', () => {
    let now = 0
    const store = new TaskStore({ now: () => now, maxWorkingMs: 100 })
    const { taskId } = store.create()
    store.requireInput(taskId, { q: FORM }, 'asking')
    now += 500
    // Waiting for input is not working.
    expect(store.overdue()).toEqual([])
    store.answer(taskId, { '1/q': 1 }, 'working')
    now += 99
    expect(store.overdue()).toEqual([])
    now += 1
    expect(store.overdue().map((task) => task.taskId)).toEqual([taskId])
  })

  test('mints random UUIDs by default', () => {
    const store = new TaskStore()
    const ids = new Set([store.create().taskId, store.create().taskId])
    expect(ids.size).toBe(2)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  test('a new task is working, kept indefinitely, and its status line moves lastUpdatedAt', () => {
    const { store, advance } = harness()
    const task = store.create('starting')
    expect(task.state.status).toBe('working')
    expect(task.ttlMs).toBeNull()

    advance(5)
    store.setStatusMessage(task.taskId, 'step 1')
    expect(task.statusMessage).toBe('step 1')
    expect(task.lastUpdatedAt).toBe(task.createdAt + 5)

    // An unchanged line is not an update.
    advance(5)
    store.setStatusMessage(task.taskId, 'step 1')
    expect(task.lastUpdatedAt).toBe(task.createdAt + 5)
  })

  test('completing starts the retention clock, and the task is purged when it runs out', () => {
    const { store, advance } = harness()
    const { taskId } = store.create()
    advance(200)
    store.complete(taskId, RESULT, 'done')
    const task = store.get(taskId)!
    expect(task.state).toEqual({ status: 'completed', result: RESULT })
    // From creation, as the spec defines it: the run time plus the retention.
    expect(task.ttlMs).toBe(200 + RETENTION_MS)

    advance(RETENTION_MS - 1)
    expect(store.get(taskId)).toBeDefined()
    advance(1)
    expect(store.get(taskId)).toBeUndefined()
  })

  test('a terminal task never moves again', () => {
    const { store } = harness()
    const { taskId } = store.create()
    store.fail(taskId, { code: -32603, message: 'boom' }, 'failed')
    store.complete(taskId, RESULT, 'done')
    store.markCancelled(taskId, 'cancelled')
    store.setStatusMessage(taskId, 'later')
    store.requireInput(taskId, { q: FORM }, 'asking')
    expect(store.get(taskId)?.state).toEqual({
      status: 'failed',
      error: { code: -32603, message: 'boom' },
    })
    expect(store.get(taskId)?.statusMessage).toBe('failed')
    expect(store.requestCancel(taskId, CANCEL_MESSAGES)).toBe('finished')
  })

  test('an unknown id is unknown to every operation', () => {
    const { store } = harness()
    expect(store.get('nope')).toBeUndefined()
    expect(store.requestCancel('nope', CANCEL_MESSAGES)).toBe('unknown')
    expect(store.answer('nope', { a: 1 }, 'working')).toEqual({ kind: 'ignored' })
  })

  test('cancelling a working task signals it and leaves the ending to the work', () => {
    const { store, advance } = harness()
    const task = store.create()
    expect(store.requestCancel(task.taskId, CANCEL_MESSAGES)).toBe('signalled')
    expect(task.controller.signal.aborted).toBe(true)
    expect(task.cancelRequested).toBe(true)
    expect(task.state.status).toBe('working')
    expect(task.statusMessage).toBe('cancelling')

    // A repeated cancel is the same request, not a new update.
    const stamped = task.lastUpdatedAt
    advance(5)
    expect(store.requestCancel(task.taskId, CANCEL_MESSAGES)).toBe('signalled')
    expect(task.lastUpdatedAt).toBe(stamped)

    store.markCancelled(task.taskId, 'cancelled')
    expect(task.state.status).toBe('cancelled')
  })

  describe('input', () => {
    test('a round of questions is keyed uniquely for the task’s lifetime', () => {
      const { store } = harness()
      const { taskId } = store.create()
      store.requireInput(taskId, { q: FORM }, 'asking')
      const first = getTaskResult(store.get(taskId)!)
      expect(first.status).toBe('input_required')
      expect(Object.keys(first.inputRequests!)).toEqual(['1/q'])

      expect(store.answer(taskId, { '1/q': { action: 'accept' } }, 'working')).toEqual({
        kind: 'complete',
        responses: { q: { action: 'accept' } },
      })

      // The work asks the same question again: a new key, never the old one.
      store.requireInput(taskId, { q: FORM }, 'asking')
      expect(Object.keys(getTaskResult(store.get(taskId)!).inputRequests!)).toEqual(['2/q'])
      expect(store.answer(taskId, { '1/q': { action: 'accept' } }, 'working')).toEqual({
        kind: 'ignored',
      })
    })

    test('a partial answer keeps the task waiting and stops showing what was answered', () => {
      const { store } = harness()
      const { taskId } = store.create()
      store.requireInput(taskId, { a: FORM, b: FORM }, 'asking')

      expect(store.answer(taskId, { '1/a': 1, stale: 2 }, 'working')).toEqual({ kind: 'pending' })
      const waiting = getTaskResult(store.get(taskId)!)
      expect(waiting.status).toBe('input_required')
      expect(Object.keys(waiting.inputRequests!)).toEqual(['1/b'])

      expect(store.answer(taskId, { '1/b': 3 }, 'working')).toEqual({
        kind: 'complete',
        responses: { a: 1, b: 3 },
      })
      const resumed = store.get(taskId)!
      expect(resumed.state.status).toBe('working')
      expect(resumed.ttlMs).toBeNull()
    })

    test('a task waiting for input is retained like a finished one, and its eviction is told', () => {
      let now = 0
      const evicted: string[] = []
      const store = new TaskStore({
        now: () => now,
        retentionMs: RETENTION_MS,
        onEvict: (id) => evicted.push(id),
      })
      const { taskId } = store.create()
      now += 100
      store.requireInput(taskId, { q: FORM }, 'asking')
      expect(store.get(taskId)?.ttlMs).toBe(100 + RETENTION_MS)
      now += RETENTION_MS
      expect(store.get(taskId)).toBeUndefined()
      expect(evicted).toEqual([taskId])
    })

    test('cancelling a task waiting for input cancels it on the spot', () => {
      const { store } = harness()
      const task = store.create()
      store.requireInput(task.taskId, { q: FORM }, 'asking')
      expect(store.requestCancel(task.taskId, CANCEL_MESSAGES)).toBe('cancelled')
      expect(task.state.status).toBe('cancelled')
      expect(task.controller.signal.aborted).toBe(true)
      expect(task.statusMessage).toBe('cancelled')
      expect(store.answer(task.taskId, { '1/q': 1 }, 'working')).toEqual({ kind: 'ignored' })
    })
  })
})

describe('getTaskResult (wire.ts)', () => {
  test('inlines what the status makes available, and nothing else', () => {
    const { store } = harness()
    const done = store.create()
    store.complete(done.taskId, RESULT, 'done')
    expect(getTaskResult(done)).toMatchObject({ status: 'completed', result: RESULT })
    expect(getTaskResult(done)).not.toHaveProperty('error')

    const broken = store.create()
    store.fail(broken.taskId, { code: -32603, message: 'boom' }, 'failed')
    expect(getTaskResult(broken)).toMatchObject({ error: { code: -32603, message: 'boom' } })
    expect(getTaskResult(broken)).not.toHaveProperty('result')

    const waiting = store.create()
    store.requireInput(waiting.taskId, { q: FORM }, 'asking')
    store.requestCancel(waiting.taskId, CANCEL_MESSAGES)
    expect(getTaskResult(waiting)).not.toHaveProperty('result')
    expect(getTaskResult(waiting)).not.toHaveProperty('inputRequests')

    expect(getTaskResult(store.create())).not.toHaveProperty('statusMessage')

    const running = store.create('working')
    expect(getTaskResult(running)).toEqual({
      taskId: running.taskId,
      status: 'working',
      statusMessage: 'working',
      createdAt: new Date(running.createdAt).toISOString(),
      lastUpdatedAt: new Date(running.lastUpdatedAt).toISOString(),
      ttlMs: null,
      pollIntervalMs: 2000,
    })
  })
})
