/**
 * `sync_collection`'s elicitation: the one tool that asks the user a question
 * mid-call, through the 2026-07-28 multi-round-trip flow (and the SDK's legacy
 * shim for a 2025-era client). Driven end to end — a real client answering a
 * real `elicitation/create`, the retried call reaching the engine with the
 * answer — because the round trip is exactly what no lower layer can pin: the
 * route's assignment handling is covered in collection-sync-api.test.ts, and the
 * answer-to-assignment mapping in unit tests, so what is asserted here is the
 * wiring: the question goes out, the answer comes back, the list changes.
 *
 * Nothing reaches the network: Archidekt is a stubbed `fetch` (with passthrough
 * for the HTTP leg's own loopback traffic), and the card cache is seeded.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
  type ElicitRequest,
  type ElicitResult,
} from '@modelcontextprotocol/client'
import { cardCache } from '../../src/cache'
import { scryfallIdIndex } from '../../src/cache/scryfall-id-index'
import { buildMcpServer } from '../../src/mcp/server'
import { runHttpServer, type McpHttpServer } from '../../src/mcp/run'
import type { CollectionSyncReport } from '../../src/collection-sync/engine'
import { toolData } from '../mcp-test-utils'
import { bindWorkspace, writeCollectionFile, type BoundWorkspace } from '../helpers/workspace'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { collectionPage, record } from '../fixtures/archidekt'
import {
  COLLECTION_URL,
  seedCollectionCardCache,
  signIn,
  SOL_RING,
  TEST_ACCOUNT,
} from './helpers/archidekt'

/** `sync_collection`'s result, as far as these tests read it. */
type SyncResult = { report: CollectionSyncReport }

/** The bits of an elicited form's JSON Schema these tests read. */
type ElicitedFormField = { type: string; maximum?: number }
type ElicitedFormSchema = { properties: Record<string, ElicitedFormField> }

let ws: BoundWorkspace
let stubbed: StubbedFetch

/**
 * Two binders each holding one Sol Ring, and an Archidekt collection holding
 * one: a pull must remove one copy, and nothing says from which binder.
 */
async function seedAmbiguousPull(passthrough = false): Promise<void> {
  await signIn(ws.dir, { ...TEST_ACCOUNT })
  const entries = [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }]
  await writeCollectionFile(ws.dir, 'binder', { title: 'Binder', entries })
  await writeCollectionFile(ws.dir, 'longbox', { title: 'Long Box', entries })
  await seedCollectionCardCache()
  stubbed = stubFetch(
    { [COLLECTION_URL]: () => Response.json(collectionPage([record(SOL_RING)])) },
    { passthrough },
  )
}

async function listHoldsSolRing(slug: string): Promise<boolean> {
  const text = await fs.readFile(path.join(ws.dir, 'collections', `${slug}.md`), 'utf-8')
  return text.includes('Sol Ring')
}

/** The answer a client gives every form: the long box gives its copy up. */
function answerLongBox(asked: ElicitRequest['params'][]): (request: ElicitRequest) => ElicitResult {
  return (request) => {
    asked.push(request.params)
    return { action: 'accept', content: { longbox: 1, binder: 0 } }
  }
}

type ClientOptions = ConstructorParameters<typeof Client>[1]

/** A client declaring form elicitation, so the server may ask it. */
const ELICITING: ClientOptions = { capabilities: { elicitation: {} } }

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
})

afterEach(async () => {
  stubbed.restore()
  cardCache.invalidate()
  scryfallIdIndex.reset()
  await ws.dispose()
})

describe('sync_collection elicitation (in-memory, 2025-era client via the legacy shim)', () => {
  async function connect(options?: ClientOptions): Promise<Client> {
    const client = new Client({ name: 'it-elicit', version: '0.0.0' }, options)
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([buildMcpServer().connect(serverTransport), client.connect(clientTransport)])
    return client
  }

  test('asks which list loses the copy, then syncs with the answer', async () => {
    await seedAmbiguousPull()
    const client = await connect(ELICITING)
    const asked: ElicitRequest['params'][] = []
    client.setRequestHandler('elicitation/create', answerLongBox(asked))
    try {
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      })

      // One form per ambiguous removal, one bounded integer field per list.
      expect(asked).toHaveLength(1)
      const form = asked[0]!
      expect(form.message).toContain('Sol Ring (C21:240)')
      // A form, not a URL elicitation: the answer is typed in, not fetched.
      if (!('requestedSchema' in form)) throw new Error('Expected a form elicitation')
      const schema = form.requestedSchema as ElicitedFormSchema
      expect(Object.keys(schema.properties).sort()).toEqual(['binder', 'longbox'])
      expect(schema.properties.longbox).toMatchObject({ type: 'integer', maximum: 1 })

      // The retried call carried the answer through to the engine.
      const { report } = toolData<SyncResult>(result)
      expect(report.unresolvedAmbiguity).toBe(false)
      expect(report.totals.removed).toBe(1)
      expect(await listHoldsSolRing('longbox')).toBe(false)
      expect(await listHoldsSolRing('binder')).toBe(true)
    } finally {
      await client.close()
    }
  })

  test('a client that cannot be asked gets the unresolved report, nothing written', async () => {
    await seedAmbiguousPull()
    const client = await connect()
    try {
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      })
      const { report } = toolData<SyncResult>(result)
      expect(report.unresolvedAmbiguity).toBe(true)
      expect(report.ambiguous).toHaveLength(1)
      expect(await listHoldsSolRing('longbox')).toBe(true)
      expect(await listHoldsSolRing('binder')).toBe(true)
    } finally {
      await client.close()
    }
  })

  test('a declined form leaves the ambiguity unresolved rather than asking again', async () => {
    await seedAmbiguousPull()
    const client = await connect(ELICITING)
    let rounds = 0
    client.setRequestHandler('elicitation/create', () => {
      rounds++
      return { action: 'decline' }
    })
    try {
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      })
      expect(rounds).toBe(1)
      const { report } = toolData<SyncResult>(result)
      expect(report.unresolvedAmbiguity).toBe(true)
      expect(await listHoldsSolRing('longbox')).toBe(true)
      expect(await listHoldsSolRing('binder')).toBe(true)
    } finally {
      await client.close()
    }
  })

  test('answers the engine refuses are reported, never asked about again', async () => {
    await seedAmbiguousPull()
    const client = await connect(ELICITING)
    let rounds = 0
    client.setRequestHandler('elicitation/create', () => {
      rounds++
      // One copy is going; two from one binder does not add up.
      return { action: 'accept', content: { longbox: 2, binder: 0 } }
    })
    try {
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      })
      expect(rounds).toBe(1)
      const { report } = toolData<SyncResult>(result)
      expect(report.unresolvedAmbiguity).toBe(true)
      expect(await listHoldsSolRing('longbox')).toBe(true)
      expect(await listHoldsSolRing('binder')).toBe(true)
    } finally {
      await client.close()
    }
  })

  test('a caller that already decided is never asked', async () => {
    await seedAmbiguousPull()
    const client = await connect(ELICITING)
    const asked: ElicitRequest['params'][] = []
    client.setRequestHandler('elicitation/create', answerLongBox(asked))
    try {
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: {
          direction: 'pull',
          removalAssignments: [
            { key: 'c21|240|nonfoil|NM|en', choices: [{ list: 'binder', copies: 1 }] },
          ],
        },
      })
      expect(asked).toEqual([])
      expect(toolData<SyncResult>(result).report.totals.removed).toBe(1)
      expect(await listHoldsSolRing('binder')).toBe(false)
      expect(await listHoldsSolRing('longbox')).toBe(true)
    } finally {
      await client.close()
    }
  })
})

describe('sync_collection elicitation (HTTP, 2026-07-28 input_required)', () => {
  const TOKEN = 'integration-secret'
  let server: McpHttpServer

  beforeEach(async () => {
    server = await runHttpServer({
      port: 0,
      host: '127.0.0.1',
      auth: { kind: 'bearer', token: TOKEN },
    })
  })
  afterEach(async () => {
    await server.stop(true)
  })

  test('the modern client fulfils the input_required round trip on its own', async () => {
    // Passthrough: the SDK client reaches the loopback server over the same
    // global `fetch` the Archidekt stub sits on.
    await seedAmbiguousPull(true)
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } },
    )
    const client = new Client(
      { name: 'it-elicit-http', version: '0.0.0' },
      { ...ELICITING, versionNegotiation: { mode: 'auto' } },
    )
    const asked: ElicitRequest['params'][] = []
    client.setRequestHandler('elicitation/create', answerLongBox(asked))
    await client.connect(transport)
    try {
      expect(client.getProtocolEra()).toBe('modern')
      const result = await client.callTool({
        name: 'sync_collection',
        arguments: { direction: 'pull' },
      })
      expect(asked).toHaveLength(1)
      const { report } = toolData<SyncResult>(result)
      expect(report.unresolvedAmbiguity).toBe(false)
      expect(report.totals.removed).toBe(1)
      expect(await listHoldsSolRing('longbox')).toBe(false)
    } finally {
      await client.close()
    }
  })
})
