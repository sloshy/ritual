/**
 * The MCP Tasks extension (`io.modelcontextprotocol/tasks`) end to end over the
 * real HTTP listener, with the bearer token on.
 *
 * Wiring only, per the MCP layering rule: which calls become tasks, the task
 * lifecycle a client walks through (`tasks/get` / `tasks/update` /
 * `tasks/cancel`), and the protocol errors. The runtime's own decisions are
 * pinned in test/unit/mcp/task-runtime.test.ts and the sync engine elsewhere;
 * `sync_collection` is the tool driven here because its Archidekt side stubs
 * cheaply and it is the one task tool that can ask for input. The HTTP leg
 * builds a fresh server per request, so every poll below also proves the task
 * store outlives the server that created the task. (That the token guards
 * `tasks/*` too is the auth suite's: the check is method-blind.)
 *
 * Nothing reaches the network: Archidekt is a stubbed `fetch` (with passthrough
 * for the loopback traffic to the server under test), and the card cache is
 * seeded.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fromJsonSchema } from '@modelcontextprotocol/server'
import { cardCache } from '../../src/cache'
import { scryfallIdIndex } from '../../src/cache/scryfall-id-index'
import type { CollectionSyncReport } from '../../src/collection-sync/engine'
import { runHttpServer, type McpHttpServer } from '../../src/mcp/run'
import { TOOL_OUTPUT_SCHEMAS } from '../../src/mcp/schema-json'
import { bindWorkspace, writeCollectionFile, type BoundWorkspace } from '../helpers/workspace'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import {
  ackOf,
  createdTask,
  isTerminal,
  modernRpc,
  pollTask,
  rpcResult,
  TEST_BEARER_TOKEN,
  waitUntil,
  type CreatedTask,
  type PolledTask,
  type RpcSend,
} from '../helpers/mcp-rpc'
import {
  BOLT,
  COLLECTION_URL,
  collectionHolds,
  seedCollectionCardCache,
  signIn,
  SOL_RING,
  SOL_RING_ENTRY,
  stubArchidektCollection,
  TEST_ACCOUNT,
  writeTwoSolRingBinders,
  type CollectionStubOptions,
  type FixtureCard,
} from './helpers/archidekt'

/** `sync_collection`'s structured result, as far as these tests read it. */
type SyncResult = { report: CollectionSyncReport }

/** A `tools/call` result carried inline by a completed task. */
type InlinedToolResult = {
  resultType: string
  structuredContent: SyncResult & { code?: string }
  isError?: boolean
}

const TASK_METHODS = ['tasks/get', 'tasks/update', 'tasks/cancel']

let ws: BoundWorkspace
let server: McpHttpServer
let stubbed: StubbedFetch | undefined
/** Opens a gated stub; `afterEach` calls it too, so a failed test never leaves a run blocked. */
let release: () => void = () => {}
let endpoint: URL
let tasksClient: RpcSend
let plainClient: RpcSend
/** Every task a test started, settled before the workspace goes away. */
let started: string[] = []

function stubCollection(cards: readonly FixtureCard[], options: CollectionStubOptions = {}): void {
  const stub = stubArchidektCollection(cards, { ...options, passthrough: true })
  stubbed = stub.stubbed
  release = stub.release
}

/** How many times the run fetched the Archidekt collection. */
function collectionFetches(): number {
  return stubbed?.sent.filter((request) => request.url.startsWith(COLLECTION_URL)).length ?? 0
}

/** Start `sync_collection` as a task. */
async function startSync(args: Record<string, unknown>): Promise<CreatedTask> {
  const created = createdTask(
    await tasksClient('tools/call', { name: 'sync_collection', arguments: args }),
  )
  started.push(created.taskId)
  return created
}

/** The tool result a completed task inlines. */
function inlined(task: PolledTask): InlinedToolResult {
  expect(task.status).toBe('completed')
  return task.result as InlinedToolResult
}

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  await signIn(ws.dir, { ...TEST_ACCOUNT })
  await seedCollectionCardCache()
  server = await runHttpServer({
    port: 0,
    host: '127.0.0.1',
    auth: { kind: 'bearer', token: TEST_BEARER_TOKEN },
  })
  endpoint = new URL(`http://127.0.0.1:${server.port}/mcp`)
  tasksClient = modernRpc(endpoint, { declareTasks: true, token: TEST_BEARER_TOKEN })
  plainClient = modernRpc(endpoint, { declareTasks: false, token: TEST_BEARER_TOKEN })
})

afterEach(async () => {
  try {
    // Let every run finish — cancelled if it has not — before its workspace
    // and stubs are torn down under it. A task that will not settle is the
    // test's failure, already reported; teardown carries on regardless.
    release()
    for (const taskId of started) {
      await tasksClient('tasks/cancel', { taskId }).catch(() => undefined)
      await pollTask(tasksClient, taskId, isTerminal).catch(() => undefined)
    }
  } finally {
    started = []
    release = () => {}
    stubbed?.restore()
    stubbed = undefined
    await server.stop(true)
    cardCache.invalidate()
    scryfallIdIndex.reset()
    await ws.dispose()
  }
})

describe('MCP tasks over HTTP', () => {
  test('advertises the extension in server/discover', async () => {
    const discovered = rpcResult(await plainClient('server/discover'))
    expect(discovered.capabilities).toMatchObject({
      extensions: { 'io.modelcontextprotocol/tasks': {} },
    })
  })

  test('a declaring client gets a task, and its inlined result is the tool’s own', async () => {
    // Archidekt holds a Lightning Bolt no list does: the pull adds it.
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [SOL_RING_ENTRY] })
    stubCollection([SOL_RING, BOLT])

    const created = await startSync({ direction: 'pull', into: 'binder' })
    expect(created).toMatchObject({ status: 'working', ttlMs: null, pollIntervalMs: 2000 })

    // Every poll is a fresh request — and so a fresh server instance.
    const task = await pollTask(tasksClient, created.taskId, isTerminal)
    expect(task.resultType).toBe('complete')
    expect(task.ttlMs).toBeGreaterThan(0)
    const result = inlined(task)
    expect(result.resultType).toBe('complete')
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.report.totals.added).toBe(1)
    expect(await collectionHolds(ws.dir, 'binder', BOLT.name)).toBe(true)

    const outputSchema = fromJsonSchema<SyncResult>(TOOL_OUTPUT_SCHEMAS.sync_collection)
    const validated = await outputSchema['~standard'].validate(result.structuredContent)
    expect(validated.issues).toBeUndefined()
  })

  test('a client without the extension gets the synchronous result', async () => {
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [SOL_RING_ENTRY] })
    stubCollection([SOL_RING])
    const plain = rpcResult(
      await plainClient('tools/call', {
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      }),
    )
    expect(plain.resultType).toBe('complete')
    expect((plain.structuredContent as SyncResult).report.totals).toBeDefined()
  })

  test.each(TASK_METHODS)('%s answers -32021 to a client without the extension', async (method) => {
    const answer = await plainClient(method, { taskId: 'anything' })
    expect({ method, code: answer.error?.code }).toEqual({ method, code: -32021 })
  })

  test.each(TASK_METHODS)('%s answers -32602 for an unknown taskId', async (method) => {
    const answer = await tasksClient(method, { taskId: 'no-such-task' })
    expect({ method, code: answer.error?.code }).toEqual({ method, code: -32602 })
  })

  test('a tool that is not long never becomes a task', async () => {
    const listed = rpcResult(await tasksClient('tools/call', { name: 'list_lists', arguments: {} }))
    expect(listed.resultType).toBe('complete')
  })

  test('a call its schema refuses is answered synchronously, not as a task', async () => {
    const refused = rpcResult(
      await tasksClient('tools/call', { name: 'sync_collection', arguments: { direction: 'up' } }),
    )
    expect(refused.resultType).toBe('complete')
    expect(refused.isError).toBe(true)
    expect(JSON.stringify(refused.content)).toContain('direction')
  })

  test('a tool error still completes the task, carrying the error result', async () => {
    await fs.rm(path.join(ws.dir, '.logins'), { recursive: true })
    // Signed out, the run must not reach Archidekt at all; a stray request fails loudly.
    stubbed = stubFetch(
      {
        'https://archidekt.com': (request) => {
          throw new Error(`Unexpected Archidekt request: ${request.url}`)
        },
      },
      { passthrough: true },
    )
    const { taskId } = await startSync({ direction: 'pull' })
    const result = inlined(await pollTask(tasksClient, taskId, isTerminal))
    expect(result.isError).toBe(true)
    // The sign-in refusal, not some other failure of the run.
    expect(result.structuredContent).toMatchObject({ code: 'internal' })
    expect((result.structuredContent as { message?: string }).message).toContain('Archidekt')
  })

  test('tasks/cancel stops a running sync, which completes with its cancelled report', async () => {
    await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries: [SOL_RING_ENTRY] })
    stubCollection([SOL_RING], { gated: true })

    const { taskId } = await startSync({ direction: 'pull' })
    await waitUntil(() => collectionFetches() === 1, 'the collection fetch')
    expect(rpcResult(await tasksClient('tasks/get', { taskId })).status).toBe('working')

    expect(ackOf(await tasksClient('tasks/cancel', { taskId }))).toEqual({ resultType: 'complete' })
    // Cooperative: still running until the work notices. (Deterministic here
    // because the stub's held body ignores the abort, as the engine's
    // between-items check does; the runtime's cancel paths are unit-pinned.)
    expect(rpcResult(await tasksClient('tasks/get', { taskId })).status).toBe('working')

    release()
    const task = await pollTask(tasksClient, taskId, isTerminal)
    expect(inlined(task).structuredContent.report.cancelled).toBe(true)
  })

  test('an ambiguous removal parks the task on input_required until tasks/update answers it', async () => {
    await writeTwoSolRingBinders(ws.dir)
    stubCollection([SOL_RING])

    const { taskId } = await startSync({ direction: 'pull' })
    const waiting = await pollTask(tasksClient, taskId, (task) => task.status !== 'working')
    expect(waiting.status).toBe('input_required')
    const requests = waiting.inputRequests as Record<string, { method: string }>
    const [key, ...others] = Object.keys(requests)
    expect(others).toEqual([])
    expect(requests[key!]!.method).toBe('elicitation/create')

    const answers = { [key!]: { action: 'accept', content: { longbox: 1, binder: 0 } } }
    expect(ackOf(await tasksClient('tasks/update', { taskId, inputResponses: answers }))).toEqual({
      resultType: 'complete',
    })

    const task = await pollTask(tasksClient, taskId, isTerminal)
    const { report } = inlined(task).structuredContent
    expect(report.unresolvedAmbiguity).toBe(false)
    expect(report.totals.removed).toBe(1)
    expect(await collectionHolds(ws.dir, 'longbox', SOL_RING.name)).toBe(false)
    expect(await collectionHolds(ws.dir, 'binder', SOL_RING.name)).toBe(true)
  })

  test('a task cancelled while it waits for input never resumes, even when answered', async () => {
    await writeTwoSolRingBinders(ws.dir)
    stubCollection([SOL_RING])

    const { taskId } = await startSync({ direction: 'pull' })
    const waiting = await pollTask(tasksClient, taskId, (task) => task.status === 'input_required')
    const [key] = Object.keys(waiting.inputRequests as Record<string, unknown>)
    expect(ackOf(await tasksClient('tasks/cancel', { taskId }))).toEqual({ resultType: 'complete' })
    // The answer that would have rerun the sync arrives too late.
    const answers = { [key!]: { action: 'accept', content: { longbox: 1, binder: 0 } } }
    expect(ackOf(await tasksClient('tasks/update', { taskId, inputResponses: answers }))).toEqual({
      resultType: 'complete',
    })
    // The status is the pin (a cancelled task ignores answers); a resumed run
    // would also have fetched the collection a second time.
    await Bun.sleep(100)
    expect(collectionFetches()).toBe(1)

    const task = rpcResult(await tasksClient('tasks/get', { taskId }))
    expect(task.status).toBe('cancelled')
    expect(task.result).toBeUndefined()
    expect(await collectionHolds(ws.dir, 'longbox', SOL_RING.name)).toBe(true)
  })
})
