import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { cardCache } from '../../src/cache'
import { scryfallIdIndex } from '../../src/cache/scryfall-id-index'
import {
  accountRequiredText,
  handleCollectionSyncRun,
  handleCollectionSyncStatus,
  loginRequiredText,
  type CollectionSyncRunResponse,
  type CollectionSyncStatusResponse,
} from '../../src/admin/api/collection-sync'
import { dispatchRoute } from '../../src/admin/server'
import { compareData } from '../../src/i18n/collate'
import type { RouteProgress, RouteProgressSink } from '../../src/util/progress'
import type { ArchidektToken } from '../../src/auth/interfaces'
import type { CollectionSyncEvent } from '../../src/collection-sync/engine'
import type { ArchidektCollectionRecord } from '../../src/importers/archidekt-collection'
import { collectionPage, record } from '../fixtures/archidekt'
import {
  BOLT,
  COLLECTION_URL,
  seedCollectionCardCache,
  SEARCH_URL,
  signIn as storeLogin,
  SOL_RING,
  stubArchidekt,
  TEST_ACCOUNT,
  UPLOAD_URL,
  uploadedCsvRows,
  type StubbedFetch,
  seededScryfallId,
} from './helpers/archidekt'
import { bindWorkspace, writeCollectionFile, type BoundWorkspace } from '../helpers/workspace'
import { expectMonotonicProgress } from '../test-utils'

/**
 * End-to-end coverage for the admin collection-sync endpoints: what the status
 * reports, how a run refuses to start without a usable Archidekt session, and
 * one real pull driven through both the JSON and SSE surfaces. The diff and
 * planning semantics are unit-tested against the engine, and the request
 * validation against the parsers, so what is pinned here is the wiring —
 * routes, the account lookup, the files a run writes, and the state it records.
 *
 * Nothing here touches the network: every Archidekt endpoint is served by a
 * stubbed `fetch` that rejects any URL a test did not route, and the card cache
 * is seeded in-process so no Scryfall lookup is attempted either.
 */

/** The account the login records, and whose collection a run fetches. */
const ACCOUNT: ArchidektToken['user'] = { ...TEST_ACCOUNT }

let ws: BoundWorkspace
let dir: string
let restoreFetch: () => void

/** Store an Archidekt login in this test's workspace; no user writes an older, account-less one. */
async function signIn(user?: ArchidektToken['user']): Promise<void> {
  await storeLogin(dir, user)
}

/** Serve a collection holding `records` — the only endpoint a pull needs. */
function stubCollection(...records: ArchidektCollectionRecord[]): StubbedFetch {
  return stubArchidekt({ [COLLECTION_URL]: () => Response.json(collectionPage(records)) })
}

async function getStatus(): Promise<CollectionSyncStatusResponse> {
  const resp = await handleCollectionSyncStatus()
  return (await resp.json()) as CollectionSyncStatusResponse
}

type RunResult = { status: number; body: CollectionSyncRunResponse }

async function postRun(body: unknown, onProgress?: RouteProgressSink): Promise<RunResult> {
  const req = new Request('http://localhost/api/collection-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const resp = await handleCollectionSyncRun(req, onProgress)
  return { status: resp.status, body: (await resp.json()) as CollectionSyncRunResponse }
}

type StreamFrame = { event: string; data: Record<string, unknown> }

/**
 * Collect every SSE frame a stream request emits. Dispatched through the admin
 * route table rather than the handler directly, so the route registration
 * (method + path) is covered too.
 */
async function readStream(query: string): Promise<StreamFrame[]> {
  const dispatched = await dispatchRoute(
    new Request(`http://localhost/api/collection-sync/stream?${query}`),
    { clientIp: 'test', sessionToken: null },
  )
  if (!dispatched.matched) throw new Error('No admin route for GET /api/collection-sync/stream')
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

function listPath(name: string): string {
  return path.join(dir, 'collections', `${name}.md`)
}

beforeEach(async () => {
  ws = await bindWorkspace({ init: true })
  dir = ws.dir
  // No test may reach the network: a route a test forgot — or a token refresh
  // attempt — must fail loudly rather than call Archidekt for real.
  restoreFetch = stubArchidekt({}).restore
  await seedCollectionCardCache()
  await writeCollectionFile(dir, 'binder', {
    title: 'Blue Binder',
    entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
  })
})

afterEach(async () => {
  restoreFetch()
  cardCache.invalidate()
  scryfallIdIndex.reset()
  await ws.dispose()
})

describe('collection-sync API', () => {
  test('reports the collection lists, the pull target, and that a login is required', async () => {
    const body = await getStatus()

    expect(body.lists).toEqual([{ slug: 'binder', name: 'Blue Binder' }])
    // Nothing has synced yet, and there is no Archidekt session to sync with.
    expect(body.lastSynced).toBeNull()
    expect(body.pullTarget).toBe('Inbox')
    expect(body.archidekt.loggedIn).toBe(false)
    expect(body.archidekt.loginRequired).toBe(true)
  })

  test('refuses to run without an Archidekt login', async () => {
    const { status, body } = await postRun({ direction: 'pull' })

    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      message: loginRequiredText(),
      // The refusal carries its catalog key beside the English, so the admin UI
      // relabels it on a language switch while MCP still reads the same prose.
      messageKey: 'admin.api.collectionSync.loginRequired',
      loginRequired: true,
    })
  })

  test('refuses to run when the stored login does not name an account', async () => {
    // A collection is fetched by numeric user id, so a token alone is not enough.
    await signIn()

    const { status, body } = await postRun({ direction: 'pull' })

    expect(status).toBe(401)
    expect(body).toEqual({
      success: false,
      message: accountRequiredText(),
      messageKey: 'admin.api.collectionSync.accountRequired',
      loginRequired: true,
    })
  })

  test('rejects an unknown direction without touching Archidekt', async () => {
    const { status, body } = await postRun({ direction: 'sideways' })

    expect(status).toBe(400)
    expect(body.message).toContain("Invalid direction 'sideways'")
  })

  test('pulls a remote-only card into the requested list and records the sync', async () => {
    await signIn(ACCOUNT)
    stubCollection(record(SOL_RING), record(BOLT))

    const { status, body } = await postRun({
      direction: 'pull',
      lists: ['binder'],
      into: 'binder',
    })

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.success && body.message).toBe('Pulled +1 added, -0 removed into "binder".')
    expect(body.success && body.report).toMatchObject({
      direction: 'pull',
      into: 'binder',
      dryRun: false,
      failedCount: 0,
      errors: [],
      totals: { added: 1, removed: 0, skipped: 0 },
    })

    // Set codes are uppercase in markdown, and the pulled line keeps the
    // Scryfall spelling resolved from the cache.
    const list = await fs.readFile(listPath('binder'), 'utf-8')
    expect(list).toContain('- Lightning Bolt (LEA:161)')
    expect(list).toContain('- Sol Ring (C21:240)')

    const changelog = await fs.readFile(path.join(dir, 'collections', 'binder.changes.md'), 'utf-8')
    expect(changelog).toContain('Added "Lightning Bolt"')

    // The account-level timestamp the status endpoint reads comes from the run.
    const status2 = await getStatus()
    expect(status2.lastSynced).not.toBeNull()
  })

  test('reports progress to an in-process caller, ending on the terminal report', async () => {
    // The MCP adapter's channel: `handleCollectionSyncRun`'s sink, not the SSE stream.
    await signIn(ACCOUNT)
    stubCollection(record(SOL_RING), record(BOLT))

    const reports: RouteProgress[] = []
    const { status } = await postRun(
      { direction: 'pull', lists: ['binder'], into: 'binder' },
      (r) => reports.push(r),
    )
    expect(status).toBe(200)

    // The exact sequence, like the deck sibling: one report per list start
    // (0-based), then the terminal n/n on the engine's own scale. Asserting only
    // "monotonic, ends with the summary" let the item-start mapping be deleted
    // entirely and still pass, since the terminal report alone satisfies both.
    expectMonotonicProgress(reports, 1)
    expect(reports.map((r) => r.progress)).toEqual([0, 1])
    expect(reports[0]?.message).toBe('Syncing binder (1/1)')
    expect(reports.at(-1)?.message).toBe('Pulled +1 added, -0 removed into "binder".')
  })

  test('refuses an ambiguous removal it was given no priority for, and writes nothing', async () => {
    await signIn(ACCOUNT)
    // The same printing in two binders, one copy of which is gone remotely:
    // nothing says which binder lost it, and an HTTP caller cannot be asked.
    await writeCollectionFile(dir, 'longbox', {
      title: 'Long Box',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    stubCollection(record(SOL_RING))

    const { status, body } = await postRun({ direction: 'pull' })

    // The run itself completed — it is the *sync* that refused, which the report
    // carries rather than the HTTP status.
    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.success && body.message).toBe(
      'Pulled +0 added, -0 removed, 1 ambiguous removal, 1 error.',
    )
    expect(body.success && body.report.errors).toEqual([
      'Could not place 1 × Sol Ring (C21:240): the removals are ambiguous and were not resolved. Nothing was written.',
    ])
    const [ambiguous] = body.success ? body.report.ambiguous : []
    expect(ambiguous).toMatchObject({
      key: 'c21|240|nonfoil|NM|en',
      parts: { set: 'c21', collectorNumber: '240', finish: 'nonfoil', condition: 'NM' },
      name: 'Sol Ring',
      quantity: 1,
    })
    // Sorted, because which binder the run happened to read first says nothing
    // about the ambiguity — the per-list counts are what a caller needs.
    expect([...(ambiguous?.lists ?? [])].sort((a, b) => compareData(a.list, b.list))).toEqual([
      { list: 'binder', copies: 1 },
      { list: 'longbox', copies: 1 },
    ])
    expect(body.success && body.report.totals).toEqual({
      added: 0,
      removed: 0,
      skipped: 0,
      pending: 0,
    })

    // Fail-and-write-nothing: both binders still hold their copy.
    expect(await fs.readFile(listPath('binder'), 'utf-8')).toContain('Sol Ring (C21:240)')
    expect(await fs.readFile(listPath('longbox'), 'utf-8')).toContain('Sol Ring (C21:240)')
  })

  test('a removal priority decides which list loses the copy', async () => {
    await signIn(ACCOUNT)
    await writeCollectionFile(dir, 'longbox', {
      title: 'Long Box',
      entries: [{ name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 }],
    })
    stubCollection(record(SOL_RING))

    // Repeated params, in priority order — the stream's only way to carry one.
    const frames = await readStream('direction=pull&removalPriority=longbox&removalPriority=binder')

    const logs = frames
      .filter((frame) => frame.event === 'progress')
      .map((frame) => frame.data as unknown as CollectionSyncEvent)
      .filter((event) => event.kind === 'log')
      .map((event) => event.message)
    expect(logs).toContain('Removing 1 × Sol Ring (C21:240) from "longbox" (removal priority).')

    const done = frames.at(-1)
    expect(done?.event).toBe('done')
    expect(done?.data.message).toBe('Pulled +0 added, -1 removed, 1 ambiguous removal.')

    // The first list named gave the copy up; the second kept its own.
    expect(await fs.readFile(listPath('longbox'), 'utf-8')).not.toContain('Sol Ring')
    expect(await fs.readFile(listPath('binder'), 'utf-8')).toContain('Sol Ring (C21:240)')
  })

  test('streams per-list progress and a final report', async () => {
    await signIn(ACCOUNT)
    stubCollection(record(SOL_RING), record(BOLT))

    const frames = await readStream('direction=pull&list=binder&into=binder')
    const progress = frames
      .filter((frame) => frame.event === 'progress')
      .map((frame) => frame.data as unknown as CollectionSyncEvent)

    expect(progress).toContainEqual({ kind: 'item-start', item: 'binder', index: 0, total: 1 })
    expect(progress.at(-1)).toEqual({
      kind: 'item-result',
      result: { name: 'binder', status: 'synced', added: 1, removed: 0, pending: 0 },
    })

    const done = frames.at(-1)
    expect(done?.event).toBe('done')
    expect(done?.data.message).toBe('Pulled +1 added, -0 removed into "binder".')
    expect(await fs.readFile(listPath('binder'), 'utf-8')).toContain('Lightning Bolt')
  })

  /**
   * A push resolves every new printing with its own Archidekt search, so a large
   * first push is hundreds of paced requests. The CLI asks how the additions
   * should get there; an HTTP caller cannot be asked, so the request either says
   * `csv: true` up front or the run refuses to guess.
   */
  describe('CSV additions', () => {
    /** Two cached printings the account does not hold — both can ride a CSV. */
    async function twoAdditions(): Promise<void> {
      await writeCollectionFile(dir, 'binder', {
        title: 'Blue Binder',
        entries: [
          { name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
          {
            name: 'Lightning Bolt',
            set: 'lea',
            collectorNumber: '161',
            condition: 'DMG',
            cardId: 2,
          },
        ],
      })
    }

    test('csv: true uploads the additions and reports what the import did', async () => {
      await signIn(ACCOUNT)
      await twoAdditions()
      const { sent } = stubArchidekt({
        [COLLECTION_URL]: () => Response.json(collectionPage([])),
        // One result per row, in row order: the second card is one Archidekt
        // could not match, which is how a per-row failure reaches the report.
        [UPLOAD_URL]: () =>
          Response.json({
            data: [
              { ambiguous: false, notFound: false, errors: [] },
              { ambiguous: false, notFound: true, errors: [] },
            ],
          }),
      })

      const { status, body } = await postRun({ direction: 'push', csv: true })

      expect(status).toBe(200)
      // The rows are built from the local cache, so the only requests are the
      // collection read and the upload itself — no printing searches at all.
      expect(sent.some((request) => request.url.startsWith(SEARCH_URL))).toBe(false)
      expect(await uploadedCsvRows(sent)).toEqual([
        // Uids come from the seeded cache; Damaged is `D` in an Archidekt CSV.
        `${seededScryfallId(SOL_RING)},1,Normal,NM,EN`,
        `${seededScryfallId(BOLT)},1,Normal,D,EN`,
      ])

      // The outcome round-trips whole, which is what the admin page renders.
      expect(body.success && body.report.csv).toEqual({
        status: 'uploaded',
        cards: 2,
        rows: 2,
        uncached: 0,
        chunks: 1,
        unconfirmedChunks: 0,
        failures: [
          {
            row: 1,
            card: 'Lightning Bolt (LEA:161) [DMG]',
            ambiguous: false,
            notFound: true,
            errors: [],
          },
        ],
      })
      // Only the row Archidekt imported counts as added, and the list holding the
      // one it dropped is reported as failed.
      expect(body.success && body.report.totals).toEqual({
        added: 1,
        removed: 0,
        skipped: 0,
        pending: 0,
      })
      expect(body.success && body.message).toBe('Pushed +1 added, -0 removed, 1 list failed.')
    })

    test('a push over the threshold without csv: true refuses and pushes nothing', async () => {
      await signIn(ACCOUNT)
      // 26 new printings — one more than the engine will add one at a time.
      // Explicit finishes, so no cache lookup is needed to canonicalize them.
      await writeCollectionFile(dir, 'binder', {
        title: 'Blue Binder',
        entries: Array.from({ length: 26 }, (_, index) => ({
          name: `Card ${index + 1}`,
          set: 'ltc',
          collectorNumber: String(index + 1),
          finish: 'foil' as const,
          cardId: index + 1,
        })),
      })
      const { sent } = stubCollection()

      const { status, body } = await postRun({ direction: 'push' })

      // The run itself completed — it is the *push* that refused, which the
      // report carries rather than the HTTP status.
      expect(status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.success && body.report.errors).toHaveLength(1)
      expect(body.success && body.report.errors[0]).toContain(
        '26 cards would be added — more than 25',
      )
      expect(body.success && body.report.errors[0]).toContain('Nothing was pushed.')
      expect(body.success && body.report.csv).toBeNull()
      expect(body.success && body.report.totals).toEqual({
        added: 0,
        removed: 0,
        skipped: 0,
        pending: 0,
      })
      // Nothing reached Archidekt but the collection read.
      expect(sent.map((request) => request.method)).toEqual(['GET'])
    })
  })

  test('streams an error frame instead of a report when no login is stored', async () => {
    const frames = await readStream('direction=pull')

    expect(frames).toHaveLength(1)
    expect(frames[0]?.event).toBe('error')
    expect(frames[0]?.data.loginRequired).toBe(true)
  })
})
