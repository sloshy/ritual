import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  handleDeckSyncRun,
  handleDeckSyncStatus,
  LOGIN_REQUIRED_MESSAGE,
  type DeckSyncRunResponse,
  type DeckSyncStatusResponse,
} from '../../src/admin/api/deck-sync'
import { dispatchRoute } from '../../src/admin/server'
import type { DeckSyncEvent, DeckSyncReport } from '../../src/deck-sync/engine'
import type {
  ArchidektDeckResponse,
  ArchidektRawCardEntry,
  ArchidektRawDeckResponse,
} from '../../src/importers/archidekt-types'
import { signIn as storeLogin } from './helpers/archidekt'
import type { RouteProgress, RouteProgressSink } from '../../src/progress'
import { stubFetch } from './helpers/stub-fetch'
import { bindWorkspace, writeDeckFile, type BoundWorkspace } from './helpers/workspace'
import { expectMonotonicProgress } from '../test-utils'

/**
 * End-to-end coverage for the admin deck-sync endpoints: which decks they list,
 * how they refuse to run without an Archidekt login, and one real pull driven
 * against a stubbed Archidekt — through both the JSON and SSE surfaces. The
 * diffing itself is unit-tested against the engine.
 */

const SOURCE_ID = '12345'
const SOURCE_URL = `https://archidekt.com/decks/${SOURCE_ID}`
const LAST_SYNCED = '2026-07-01T00:00:00.000Z'

/** An Archidekt deck holding one more Sol Ring than the local file does. */
const REMOTE_DECK: ArchidektDeckResponse = {
  name: 'Linked Deck',
  deckFormat: 3,
  categories: [{ id: 1, name: 'Main' }],
  cards: [
    { quantity: 1, card: { name: 'Sol Ring', oracleCard: { name: 'Sol Ring' } }, categories: [1] },
    {
      quantity: 1,
      card: { name: 'Lightning Bolt', oracleCard: { name: 'Lightning Bolt' } },
      categories: [1],
    },
  ],
}

let ws: BoundWorkspace
let tmpDir: string
let originalFetch: typeof globalThis.fetch

/** Store an Archidekt login the same way `ritual login archidekt` does. */
async function signIn(): Promise<void> {
  await storeLogin(tmpDir, { id: 1, username: 'testuser' })
}

/** Serve the one Archidekt endpoint a pull needs. */
function stubArchidekt(): void {
  stubFetch({ [`https://archidekt.com/api/decks/${SOURCE_ID}/`]: () => Response.json(REMOTE_DECK) })
}

/** One Archidekt card entry in the raw (push-side) deck shape. */
function rawEntry(name: string, id: number): ArchidektRawCardEntry {
  return {
    id,
    quantity: 1,
    modifier: 'Normal',
    categories: ['Main'],
    companion: false,
    flippedDefault: false,
    label: ',#656565',
    customCmc: null,
    card: {
      id: id * 10,
      uid: `uid-${id}`,
      collectorNumber: `${id}`,
      options: ['Normal'],
      oracleCard: { id, name, defaultCategory: 'Main' },
      edition: { editioncode: 'lea' },
    },
  }
}

const RAW_DECK: ArchidektRawDeckResponse = {
  id: Number(SOURCE_ID),
  name: 'Linked Deck',
  owner: { id: 1, username: 'testuser' },
  categories: [{ id: 1, name: 'Main' }],
  cards: [rawEntry('Sol Ring', 1), rawEntry('Lightning Bolt', 2)],
  updatedAt: '2026-07-01T00:00:00.000Z',
}

/**
 * Serve the push path: the owned-deck list, the raw and parsed deck, and the
 * batch card edit. `pushed` collects what the run sent to Archidekt.
 */
function stubArchidektPush(pushed: unknown[], ownDeckIds: number[] = [Number(SOURCE_ID)]): void {
  stubFetch({
    'https://archidekt.com/api/decks/curated/self/': () =>
      Response.json({ results: ownDeckIds.map((id) => ({ id, name: 'Linked Deck' })), count: 1 }),
    [`https://archidekt.com/api/decks/${SOURCE_ID}/`]: () => Response.json(RAW_DECK),
    [`https://archidekt.com/api/decks/${SOURCE_ID}/modifyCards/v2/`]: () => {
      pushed.push('modifyCards')
      return Response.json({ ok: true })
    },
  })
}

async function writeDecks(): Promise<void> {
  await writeDeckFile(tmpDir, 'linked', {
    frontMatter: {
      name: 'Linked Deck',
      format: 'commander',
      sourceId: SOURCE_ID,
      sourceUrl: SOURCE_URL,
      lastSynced: LAST_SYNCED,
    },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  // Linked but unsyncable: an Archidekt URL with no id to fetch by.
  await writeDeckFile(tmpDir, 'no-source-id', {
    frontMatter: { name: 'No Source Id', sourceUrl: SOURCE_URL },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
  await writeDeckFile(tmpDir, 'local-only', {
    frontMatter: { name: 'Local Only' },
    cards: [{ quantity: 1, name: 'Sol Ring', cardId: 1 }],
  })
}

async function getStatus(): Promise<DeckSyncStatusResponse> {
  const resp = await handleDeckSyncStatus()
  return (await resp.json()) as DeckSyncStatusResponse
}

async function postRun(
  body: unknown,
  onProgress?: RouteProgressSink,
): Promise<{ status: number; body: DeckSyncRunResponse }> {
  const req = new Request('http://localhost/api/deck-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const resp = await handleDeckSyncRun(req, onProgress)
  return { status: resp.status, body: (await resp.json()) as DeckSyncRunResponse }
}

/**
 * Every log line a run emits, driven through the SSE stream because that is the
 * only surface the engine's own progress reaches (the JSON endpoint keeps just
 * the report).
 */
async function runEvents(body: Record<string, unknown>): Promise<string[]> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) for (const item of value) params.append('deck', String(item))
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      params.set(key, String(value))
  }
  params.delete('decks')
  const frames = await readStream(params.toString())
  return frames.flatMap((frame) => {
    const event = frame.data as { kind?: string; message?: string }
    return frame.event === 'progress' && event.kind === 'log' ? [event.message ?? ''] : []
  })
}

/** The report of a run that was expected to complete. */
async function runReport(body: unknown): Promise<DeckSyncReport> {
  const { body: response } = await postRun(body)
  if (!response.success) throw new Error(`Run refused: ${response.message}`)
  return response.report
}

type StreamFrame = { event: string; data: Record<string, unknown> }

/**
 * Collect every SSE frame a stream request emits. Dispatched through the admin
 * route table rather than the handler directly, so the route registration
 * (method + path) is covered too.
 */
async function readStream(query: string): Promise<StreamFrame[]> {
  const dispatched = await dispatchRoute(
    new Request(`http://localhost/api/deck-sync/stream?${query}`),
    { clientIp: 'test', sessionToken: null },
  )
  if (!dispatched.matched) throw new Error('No admin route for GET /api/deck-sync/stream')
  const text = await dispatched.response.text()
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [eventLine = '', dataLine = ''] = chunk.split('\n')
      return {
        event: eventLine.replace('event: ', ''),
        data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>,
      }
    })
}

beforeEach(async () => {
  ws = await bindWorkspace({ config: false })
  tmpDir = ws.dir
  originalFetch = globalThis.fetch
  // No test may reach the network: a stub that forgot a URL — or a token-refresh
  // attempt — must fail loudly rather than call Archidekt for real.
  stubFetch({})
  await writeDecks()
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await ws.dispose()
})

describe('deck-sync API', () => {
  test('lists only Archidekt decks that carry a source id', async () => {
    const body = await getStatus()
    expect(body.decks).toEqual([
      {
        slug: 'linked',
        name: 'Linked Deck',
        sourceId: SOURCE_ID,
        sourceUrl: SOURCE_URL,
        lastSynced: LAST_SYNCED,
      },
    ])
  })

  test('reports that a login is required when no Archidekt token is stored', async () => {
    const body = await getStatus()
    expect(body.archidekt.loggedIn).toBe(false)
    expect(body.archidekt.loginRequired).toBe(true)
  })

  test('reports the signed-in Archidekt account', async () => {
    await signIn()
    const body = await getStatus()
    expect(body.archidekt).toMatchObject({
      loggedIn: true,
      username: 'testuser',
      loginRequired: false,
    })
  })

  test('rejects an unknown direction without touching Archidekt', async () => {
    const { status, body } = await postRun({ direction: 'sideways' })
    expect(status).toBe(400)
    expect(body.message).toContain("Invalid direction 'sideways'")
  })

  test('refuses to run without an Archidekt login', async () => {
    const { status, body } = await postRun({ direction: 'pull' })
    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      message: LOGIN_REQUIRED_MESSAGE,
      loginRequired: true,
    })
  })

  test('rejects a body that is not JSON', async () => {
    const req = new Request('http://localhost/api/deck-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    const resp = await handleDeckSyncRun(req)
    expect(resp.status).toBe(400)
    expect(((await resp.json()) as DeckSyncRunResponse).message).toBe('Request body must be JSON.')
  })

  test('pulls remote changes into the deck file and its changelog', async () => {
    await signIn()
    stubArchidekt()

    const { status, body } = await postRun({ direction: 'pull', decks: ['linked'] })
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.success && body.report).toMatchObject({
      direction: 'pull',
      failedCount: 0,
      decks: [{ name: 'Linked Deck', status: 'synced' }],
    })

    const deck = await fs.readFile(path.join(tmpDir, 'decks', 'linked.md'), 'utf-8')
    expect(deck).toContain('Lightning Bolt')
    // The sync stamps a fresh lastSynced rather than keeping the old one.
    expect(deck).not.toContain(LAST_SYNCED)

    const changelog = await fs.readFile(path.join(tmpDir, 'decks', 'linked.changes.md'), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt"')
  })

  test('reports progress to an in-process caller, ending on the terminal report', async () => {
    // The MCP adapter's channel: `handleDeckSyncRun`'s sink, not the SSE stream.
    await signIn()
    stubArchidekt()

    const reports: RouteProgress[] = []
    const { status } = await postRun({ direction: 'pull', decks: ['linked'] }, (r) =>
      reports.push(r),
    )
    expect(status).toBe(200)

    // One report per deck start (0-based), then the terminal n/n — on the
    // engine's own scale, which is what `total` says throughout.
    expectMonotonicProgress(reports, 1)
    expect(reports.map((r) => r.progress)).toEqual([0, 1])
    expect(reports[0]?.message).toBe('Syncing Linked Deck (1/1)')
    expect(reports.at(-1)?.message).toBe('Pulled 1 deck.')
  })

  test('a pull with --only additions adds the remote card and keeps the local-only one', async () => {
    // The filter itself is unit-tested; what is pinned here is that the engine
    // actually applies `only` on the pull path.
    await writeDeckFile(tmpDir, 'linked', {
      frontMatter: {
        name: 'Linked Deck',
        format: 'commander',
        sourceId: SOURCE_ID,
        sourceUrl: SOURCE_URL,
        lastSynced: LAST_SYNCED,
      },
      cards: [
        { quantity: 1, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Counterspell', cardId: 2 },
      ],
    })
    await signIn()
    stubArchidekt()

    const events = await runEvents({ direction: 'pull', decks: ['linked'], only: 'additions' })

    const deck = await fs.readFile(path.join(tmpDir, 'decks', 'linked.md'), 'utf-8')
    expect(deck).toContain('Lightning Bolt')
    // The remote does not hold Counterspell, but removals were filtered out.
    expect(deck).toContain('Counterspell')
    expect(events).toContain('Skipped 1 removal (applying additions only).')
  })

  test('a push with --only removals sends the removal and not the addition', async () => {
    await writeDeckFile(tmpDir, 'linked', {
      frontMatter: {
        name: 'Linked Deck',
        format: 'commander',
        sourceId: SOURCE_ID,
        sourceUrl: SOURCE_URL,
        lastSynced: LAST_SYNCED,
      },
      cards: [
        { quantity: 1, name: 'Sol Ring', cardId: 1 },
        { quantity: 1, name: 'Counterspell', cardId: 2 },
      ],
    })
    await signIn()
    const bodies: unknown[] = []
    stubFetch({
      'https://archidekt.com/api/decks/curated/self/': () =>
        Response.json({ results: [{ id: Number(SOURCE_ID), name: 'Linked Deck' }], count: 1 }),
      [`https://archidekt.com/api/decks/${SOURCE_ID}/`]: () => Response.json(RAW_DECK),
      [`https://archidekt.com/api/decks/${SOURCE_ID}/modifyCards/v2/`]: () => Response.json({}),
    })
    const withBody = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH' && typeof init.body === 'string') {
        bodies.push(JSON.parse(init.body))
      }
      return withBody(input, init)
    }) as typeof globalThis.fetch

    const events = await runEvents({ direction: 'push', decks: ['linked'], only: 'removals' })

    // Lightning Bolt is remote-only, Counterspell local-only: only the former
    // survives a removals-only push, and no card search is needed for it.
    expect(bodies).toEqual([{ cards: [expect.objectContaining({ action: 'remove', cardid: 20 })] }])
    expect(events).toContain('Skipped 1 addition (applying removals only).')
  })

  test('a dry run reports the diff without writing anything', async () => {
    await signIn()
    stubArchidekt()
    const before = await fs.readFile(path.join(tmpDir, 'decks', 'linked.md'), 'utf-8')

    const { body } = await postRun({ direction: 'pull', decks: ['linked'], dryRun: true })
    expect(body.message).toContain('Previewed')
    expect(body.success && body.report.decks[0]?.reason).toContain('dry-run: +1 added')

    expect(await fs.readFile(path.join(tmpDir, 'decks', 'linked.md'), 'utf-8')).toBe(before)
    const changelogWritten = await fs.access(path.join(tmpDir, 'decks', 'linked.changes.md')).then(
      () => true,
      () => false,
    )
    expect(changelogWritten).toBe(false)
  })

  test('reports a deck that is not linked to Archidekt as failed', async () => {
    await signIn()
    const report = await runReport({ direction: 'pull', decks: ['local-only'] })
    expect(report.failedCount).toBe(1)
    expect(report.decks[0]).toEqual({
      name: 'local-only',
      status: 'failed',
      reason: 'not sourced from Archidekt',
    })
  })

  test('an all-decks run skips a linked deck that has no source id', async () => {
    await signIn()
    stubArchidekt()

    const report = await runReport({ direction: 'pull' })
    // Both linked decks are accounted for: one synced, one skipped for lacking an
    // id to fetch by. The unlinked deck is not part of the run at all.
    expect(report.decks).toEqual([
      {
        name: 'No Source Id',
        status: 'skipped',
        reason: 'has Archidekt sourceUrl but no sourceId',
      },
      { name: 'Linked Deck', status: 'synced' },
    ])
    expect(report.failedCount).toBe(0)
  })

  test('pushes local changes and stamps lastSynced', async () => {
    await signIn()
    const pushed: unknown[] = []
    stubArchidektPush(pushed)

    const report = await runReport({ direction: 'push', decks: ['linked'] })
    expect(report.decks).toEqual([{ name: 'Linked Deck', status: 'synced' }])
    // The local deck lacks the remote's Lightning Bolt, so the push removes it.
    expect(pushed).toEqual(['modifyCards'])

    const deck = await fs.readFile(path.join(tmpDir, 'decks', 'linked.md'), 'utf-8')
    expect(deck).not.toContain(LAST_SYNCED)
    // A push sends local state; it must not pull the remote card in.
    expect(deck).not.toContain('Lightning Bolt')
  })

  test('skips pushing a deck the account does not own', async () => {
    await signIn()
    const pushed: unknown[] = []
    stubArchidektPush(pushed, [999])

    const report = await runReport({ direction: 'push', decks: ['linked'] })
    expect(report.decks).toEqual([
      {
        name: 'Linked Deck',
        status: 'skipped',
        reason: `you do not own Archidekt deck ${SOURCE_ID}`,
      },
    ])
    expect(pushed).toEqual([])
  })

  test('refuses to sync a deck whose file has lines the parser cannot read', async () => {
    await signIn()
    stubArchidekt()
    const deckPath = path.join(tmpDir, 'decks', 'linked.md')
    const before = await fs.readFile(deckPath, 'utf-8')
    await fs.writeFile(deckPath, `${before}\nthis line is not a card\n`)

    const report = await runReport({ direction: 'pull', decks: ['linked'] })
    expect(report.decks).toEqual([
      {
        name: 'Linked Deck',
        status: 'failed',
        reason: '1 unreadable line would be dropped by a sync',
      },
    ])
    // Refusing means the file is untouched — the unreadable line survives.
    expect(await fs.readFile(deckPath, 'utf-8')).toContain('this line is not a card')
  })

  test('syncs a deck with unreadable lines once the caller accepts the loss', async () => {
    await signIn()
    stubArchidekt()
    const deckPath = path.join(tmpDir, 'decks', 'linked.md')
    await fs.writeFile(
      deckPath,
      `${await fs.readFile(deckPath, 'utf-8')}\nthis line is not a card\n`,
    )

    const report = await runReport({
      direction: 'pull',
      decks: ['linked'],
      ignoreUnreadableLines: true,
    })
    expect(report.decks).toEqual([{ name: 'Linked Deck', status: 'synced' }])

    const after = await fs.readFile(deckPath, 'utf-8')
    expect(after).toContain('Lightning Bolt')
    // The accepted cost: the line the parser could not read is gone.
    expect(after).not.toContain('this line is not a card')
  })

  test('streams the unreadable lines so a caller can decide', async () => {
    await signIn()
    stubArchidekt()
    const deckPath = path.join(tmpDir, 'decks', 'linked.md')
    await fs.writeFile(
      deckPath,
      `${await fs.readFile(deckPath, 'utf-8')}\nthis line is not a card\n`,
    )

    const frames = await readStream('direction=pull&deck=linked')
    const unreadable = frames
      .map((frame) => frame.data as unknown as DeckSyncEvent)
      .find((event) => event.kind === 'unreadable-lines')

    expect(unreadable).toEqual({
      kind: 'unreadable-lines',
      decks: [
        {
          name: 'Linked Deck',
          file: 'linked.md',
          warnings: ['Skipped malformed line: this line is not a card'],
        },
      ],
    })
  })

  test('streams per-deck progress and a final report', async () => {
    await signIn()
    stubArchidekt()

    const frames = await readStream('direction=pull&deck=linked')
    const progress = frames
      .filter((frame) => frame.event === 'progress')
      .map((frame) => frame.data as unknown as DeckSyncEvent)

    expect(progress[0]).toEqual({ kind: 'deck-start', deck: 'Linked Deck', index: 0, total: 1 })
    expect(progress).toContainEqual({
      kind: 'log',
      level: 'info',
      deck: 'Linked Deck',
      message: 'Changes: +1 added, -0 removed, ~0 quantity changed',
    })
    expect(progress.at(-1)).toEqual({
      kind: 'deck-result',
      result: { name: 'Linked Deck', status: 'synced' },
    })

    const done = frames.at(-1)
    expect(done?.event).toBe('done')
    expect(done?.data.message).toBe('Pulled 1 deck.')
  })

  test('streams an error frame instead of a report when no login is stored', async () => {
    const frames = await readStream('direction=pull')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.event).toBe('error')
    expect(frames[0]?.data.loginRequired).toBe(true)
  })

  test('streams an error frame for an invalid direction', async () => {
    const frames = await readStream('direction=sideways')
    expect(frames[0]?.event).toBe('error')
    expect(frames[0]?.data.message).toContain("Invalid direction 'sideways'")
    expect(frames[0]?.data.loginRequired).toBe(false)
  })
})
