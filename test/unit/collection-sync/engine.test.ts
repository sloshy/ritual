import { describe, expect, test } from 'bun:test'
import type { CardPrintingsLookup } from '../../../src/card-printing'
import { ArchidektClient } from '../../../src/clients/ArchidektClient'
import type { CollectionEntry } from '../../../src/collection-file'
import { CSV_UPLOAD_THRESHOLD, type CsvFileWriter } from '../../../src/collection-sync/csv'
import {
  runCollectionSync,
  type CollectionSyncEvent,
  type CollectionSyncOptions,
  type CollectionSyncRun,
  type CsvUploadQuestion,
} from '../../../src/collection-sync/engine'
import type {
  CollectionListStore,
  CreatedCollectionList,
  LoadedCollectionList,
  ResolveCollectionListResult,
} from '../../../src/collection-sync/store'
import type {
  CollectionSyncState,
  CollectionSyncStateStore,
} from '../../../src/collection-sync/state'
import type { CardMutationChange } from '../../../src/list-mutate'
import type { ArchidektCollectionRecord } from '../../../src/importers/archidekt-collection'
import {
  collectionPage,
  entry,
  noPrintings,
  printing,
  printingId,
  printingsLookup,
  record,
  TEST_ACCOUNT,
} from './fixtures'

/**
 * Engine-level tests: every side effect the run can have — reading and writing
 * list files, talking to Archidekt, recording the sync timestamp — goes through
 * a seam that is stubbed here, so what is pinned is the flow (scope, ordering,
 * dry runs, failure containment), not the semantics already pinned in
 * `diff.test.ts`.
 */

// ── The list store ────────────────────────────────────────────────────

type FakeListInput = {
  name: string
  entries?: CollectionEntry[]
  /** Lines the parser could not read — the trigger for the confirmation gate. */
  warnings?: string[]
}

type FakeStore = CollectionListStore & {
  /** Names passed to `load`, in call order. */
  loaded: string[]
  /** Every applied change set, in call order. */
  applied: { list: string; changes: CardMutationChange[] }[]
  /** Lists the run created. */
  created: string[]
}

function fakeStore(lists: FakeListInput[], failApplyFor?: string): FakeStore {
  const entriesByList = new Map<string, CollectionEntry[]>()
  const warningsByList = new Map<string, string[]>()
  const order: string[] = []
  for (const list of lists) {
    order.push(list.name)
    entriesByList.set(list.name, list.entries ?? [])
    warningsByList.set(list.name, list.warnings ?? [])
  }

  const store: FakeStore = {
    loaded: [],
    applied: [],
    created: [],

    allLists(): Promise<string[]> {
      return Promise.resolve([...order])
    },

    resolve(query: string): Promise<ResolveCollectionListResult> {
      const match = order.find((name) => name.toLowerCase() === query.toLowerCase())
      return Promise.resolve(
        match ? { name: match } : { kind: 'not-found', query, type: 'collection' },
      )
    },

    load(name: string): Promise<LoadedCollectionList | string> {
      store.loaded.push(name)
      const entries = entriesByList.get(name)
      if (!entries) return Promise.resolve(`no such list '${name}'`)
      return Promise.resolve({
        name,
        file: `${name}.md`,
        entries,
        warnings: warningsByList.get(name) ?? [],
      })
    },

    apply(name: string, changes: CardMutationChange[]): Promise<string[]> {
      if (name === failApplyFor) return Promise.reject(new Error('disk is full'))
      store.applied.push({ list: name, changes })
      return Promise.resolve([`${name}.md`, `${name}.md.sha256`, `${name}.changes.md`])
    },

    create(name: string): Promise<CreatedCollectionList | string> {
      const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
      store.created.push(slug)
      order.push(slug)
      entriesByList.set(slug, [])
      warningsByList.set(slug, [])
      return Promise.resolve({ name: slug, writtenFiles: [`${slug}.md`, `${slug}.md.sha256`] })
    },
  }
  return store
}

// ── The Archidekt client ──────────────────────────────────────────────

type RecordedRequest = {
  method: string
  url: string
  body: unknown
  /** The CSV text of an upload request; JSON writes carry `body` instead. */
  csv?: string
}

/** One row result of a stubbed CSV upload, as Archidekt would report it. */
type StubbedCsvRow = { ambiguous?: boolean; notFound?: boolean; errors?: string[] }

type MockArchidektOptions = {
  /** Collection pages, in order; the run follows `next` until the last one. */
  pages?: ArchidektCollectionRecord[][]
  /** Archidekt printing ids by `set:collectorNumber`; anything else fails to resolve. */
  printings?: Record<string, number>
  /** Make the collection fetch fail. */
  fetchFails?: boolean
  /** Make `/api/collection/bulk/` (the delete endpoint) fail. */
  bulkFails?: boolean
  /** Advertise a next page forever, so only `totalPages` stops the loop. */
  endlessNext?: boolean
  /** Make every `/api/collection/upload/v2/` request fail. */
  uploadFails?: boolean
  /** What the upload says about each 0-based data row; a clean import by default. */
  uploadRow?: (row: number) => StubbedCsvRow
}

type MockArchidekt = { client: ArchidektClient; requests: RecordedRequest[] }

function mockArchidekt(options: MockArchidektOptions = {}): MockArchidekt {
  const pages = options.pages ?? [[]]
  const requests: RecordedRequest[] = []
  let createdId = 900

  const fetch = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const href = url.toString()
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ method, url: href, body })

    if (href.includes('/api/collection/') && href.includes('/v2/?')) {
      if (options.fetchFails) return new Response('Server Error', { status: 500 })
      const page = Number(new URL(href).searchParams.get('page') ?? '1')
      const records = pages[page - 1] ?? []
      const next =
        options.endlessNext || page < pages.length
          ? `https://archidekt.com/next?page=${page + 1}`
          : null
      return Response.json(collectionPage(records, page, pages.length, next))
    }

    if (href.startsWith('https://archidekt.com/api/cards/v2/')) {
      const params = new URL(href).searchParams
      const key = `${params.get('editionSearch') ?? ''}:${params.get('collectorNumber') ?? ''}`
      const id = options.printings?.[key]
      return Response.json({
        results:
          id === undefined
            ? []
            : [
                {
                  id,
                  collectorNumber: params.get('collectorNumber') ?? '',
                  options: ['Normal', 'Foil'],
                  oracleCard: { name: params.get('nameSearch') ?? '', defaultCategory: 'Artifact' },
                },
              ],
      })
    }

    // Both the create (`/v2/`) and the update (`/v2/{id}/`) land here.
    if (href.startsWith('https://archidekt.com/api/collection/v2/')) {
      return Response.json({ id: ++createdId, createdAt: 'now', modifiedAt: 'now' })
    }
    if (href === 'https://archidekt.com/api/collection/bulk/') {
      if (options.bulkFails) return new Response('Server Error', { status: 500 })
      return Response.json([])
    }

    if (href === 'https://archidekt.com/api/collection/upload/v2/') {
      // A multipart body, so the CSV is recorded rather than parsed as JSON.
      const file = init?.body instanceof FormData ? init.body.get('file') : null
      const csv = file instanceof File ? await file.text() : ''
      requests[requests.length - 1] = { method, url: href, body: undefined, csv }
      if (options.uploadFails) return new Response('bad csv', { status: 400 })
      // One result per data row, which is every line but the header — in the
      // live-verified shape: the row echoed back re-serialized (every cell
      // quoted, CRLF), the server's own imported verdict, and its record id.
      // This drives the engine down the identity-pairing path the way the real
      // server does; the flags-only fallback is pinned at the csv.test.ts layer.
      const rows = csv.trimEnd().split('\n').slice(1)
      return Response.json({
        data: rows.map((line, row) => {
          const outcome = options.uploadRow?.(row) ?? {}
          const refused =
            (outcome.ambiguous ?? false) ||
            (outcome.notFound ?? false) ||
            (outcome.errors?.length ?? 0) > 0
          return {
            raw: `"${line.split(',').join('","')}"\r\n`,
            lineNumber: row + 2,
            id: refused ? null : ++createdId,
            imported: !refused,
            ambiguous: outcome.ambiguous ?? false,
            notFound: outcome.notFound ?? false,
            errors: outcome.errors ?? [],
          }
        }),
      })
    }

    return new Response('Unexpected request', { status: 404 })
  }

  return { client: new ArchidektClient({ fetch }), requests }
}

// ── The sync-state store ──────────────────────────────────────────────

type FakeStateStore = CollectionSyncStateStore & { written: CollectionSyncState[] }

function fakeState(writeFails = false): FakeStateStore {
  const written: CollectionSyncState[] = []
  return {
    written,
    read: () => Promise.resolve(written.at(-1) ?? null),
    write: (state: CollectionSyncState) => {
      if (writeFails) return Promise.reject(new Error('read-only filesystem'))
      written.push(state)
      return Promise.resolve()
    },
  }
}

// ── Harness ───────────────────────────────────────────────────────────

type Harness = {
  run: CollectionSyncRun
  events: CollectionSyncEvent[]
  logs: string[]
}

async function sync(
  options: Omit<CollectionSyncOptions, 'token' | 'userId' | 'into' | 'lookupPrintings'> &
    Partial<Pick<CollectionSyncOptions, 'token' | 'userId' | 'into' | 'lookupPrintings'>>,
): Promise<Harness> {
  const events: CollectionSyncEvent[] = []
  const run = await runCollectionSync({
    token: 'jwt-token',
    userId: TEST_ACCOUNT.id,
    into: 'Inbox',
    lookupPrintings: noPrintings,
    lookupByScryfallId: () => Promise.resolve(new Map()),
    ...options,
    onEvent: (event) => events.push(event),
  })
  return {
    run,
    events,
    logs: events.flatMap((event) => (event.kind === 'log' ? [event.message] : [])),
  }
}

// ── Pull ──────────────────────────────────────────────────────────────

describe('runCollectionSync (pull)', () => {
  test('writes remote-only cards into the target list, creating it on first use', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const state = fakeState()
    const { client } = mockArchidekt({
      pages: [
        [record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 })],
      ],
    })

    const { run } = await sync({ direction: 'pull', client, store, state })

    expect(store.created).toEqual(['inbox'])
    expect(store.applied).toHaveLength(1)
    expect(store.applied[0]?.list).toBe('inbox')
    expect(store.applied[0]?.changes).toHaveLength(2)
    expect(store.applied[0]?.changes[0]?.action).toBe('add')
    expect(run.report.totals).toEqual({ added: 2, removed: 0, skipped: 0, pending: 0 })
    expect(run.report.failedCount).toBe(0)
    // Both the created list and the applied write are staged.
    expect(run.writtenFiles).toContain('inbox.md')
    expect(run.writtenFiles).toContain('inbox.changes.md')
    expect(state.written).toHaveLength(1)
    expect(state.written[0]?.username).toBe(TEST_ACCOUNT.username)
    expect(state.written[0]?.userId).toBe(TEST_ACCOUNT.id)
  })

  test('removes surplus copies from the one list holding them', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
        ],
      },
    ])
    const { client } = mockArchidekt({
      pages: [
        [record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 })],
      ],
    })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(store.created).toEqual([])
    expect(store.applied[0]?.list).toBe('blue-binder')
    expect(store.applied[0]?.changes).toEqual([
      expect.objectContaining({ action: 'remove', cardName: 'Sol Ring', cardId: 2 }),
    ])
    expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', status: 'synced', removed: 1 })
  })

  test('removes a key the remote lacks from every list holding it', async () => {
    // Every copy is going, so the removal is not ambiguous however many binders
    // hold one — each simply loses what it holds.
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      { name: 'long-box', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 2 })] },
    ])
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(run.report.ambiguous).toEqual([])
    expect(store.applied.map((applied) => applied.list)).toEqual(['blue-binder', 'long-box'])
    expect(run.report.totals.removed).toBe(2)
    expect(run.report.failedCount).toBe(0)
  })

  test('a dry run reports the whole plan and writes nothing', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Lightning Bolt', 'lea', '161', { cardId: 1 })] },
    ])
    const state = fakeState()
    const { client, requests } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
    })

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state,
      dryRun: true,
    })

    expect(store.applied).toEqual([])
    expect(store.created).toEqual([])
    expect(run.writtenFiles).toEqual([])
    expect(state.written).toEqual([])
    // Only the read of the collection itself — asserted as a shape, so the test
    // fails both when a write leaks out and when the read stops happening.
    expect(requests.map((request) => request.method)).toEqual(['GET'])
    expect(run.report.dryRun).toBe(true)
    expect(run.report.totals).toEqual({ added: 1, removed: 1, skipped: 0, pending: 0 })
    expect(logs).toContain(
      '[dry-run] Would create collection list "Inbox" for the cards being added.',
    )
  })

  test('--only additions leaves local-only cards alone and says what it skipped', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Lightning Bolt', 'lea', '161', { cardId: 1 })] },
    ])
    const { client } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
    })

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      only: 'additions',
    })

    expect(store.applied.map((applied) => applied.list)).toEqual(['inbox'])
    expect(run.report.totals).toEqual({ added: 1, removed: 0, skipped: 1, pending: 0 })
    expect(logs).toContain('Skipped 1 removal (applying additions only).')
  })

  test('syncs only the named lists, treating the rest as out of scope', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      { name: 'long-box', entries: [entry('Black Lotus', 'lea', '232', { cardId: 2 })] },
    ])
    const { client } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
    })

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      lists: ['blue-binder'],
    })

    expect(store.loaded).toEqual(['blue-binder'])
    // The out-of-scope Black Lotus is absent from both sides of the diff, so
    // nothing is added for it and nothing is removed from `long-box`.
    expect(store.applied).toEqual([])
    expect(run.report.lists.map((list) => list.name)).toEqual(['blue-binder'])
  })

  test('an unresolvable list name fails on its own without sinking the run', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      lists: ['blue-binder', 'nonexistent'],
    })

    expect(store.loaded).toEqual(['blue-binder'])
    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists.find((list) => list.name === 'nonexistent')?.reason).toContain(
      "No collection named 'nonexistent' found",
    )
  })

  test('a failed save fails its list and leaves the totals honest', async () => {
    const store = fakeStore(
      [{ name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] }],
      'blue-binder',
    )
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists[0]?.reason).toContain('disk is full')
    expect(run.report.totals.removed).toBe(0)
  })

  test('follows every page of the collection', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client, requests } = mockArchidekt({
      pages: [
        [record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })],
        [record({ id: 2, name: 'Black Lotus', set: 'lea', collectorNumber: '232' })],
      ],
    })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(
      requests.filter((request) => request.url.includes(`/api/collection/${TEST_ACCOUNT.id}/v2/`)),
    ).toHaveLength(2)
    expect(run.report.totals.added).toBe(2)
  })

  test('a failed collection fetch fails every in-scope list', async () => {
    const store = fakeStore([{ name: 'blue-binder' }, { name: 'long-box' }])
    const state = fakeState()
    const { client } = mockArchidekt({ fetchFails: true })

    const { run } = await sync({ direction: 'pull', client, store, state })

    expect(run.report.failedCount).toBe(2)
    expect(run.report.errors[0]).toContain('Failed to fetch the Archidekt collection')
    expect(store.applied).toEqual([])
    expect(state.written).toEqual([])
  })
})

// ── Ambiguous removals ────────────────────────────────────────────────

/** The `&N` ids a change set removes, in the order the changes were emitted. */
function removedIds(changes: readonly CardMutationChange[]): (number | undefined)[] {
  return changes.flatMap((change) => (change.action === 'remove' ? [change.cardId] : []))
}

/**
 * Only *some* of a printing's copies are going and they live in several lists,
 * so the run cannot know which binder the card left. Resolution is
 * all-or-nothing: until every ambiguity is settled the run writes nothing at
 * all, not even the removals it could place on its own.
 */
describe('runCollectionSync (ambiguous removals)', () => {
  /**
   * One Sol Ring in `blue-binder` and two in `long-box` against a single remote
   * copy — two copies to remove, and nothing saying from where. `blue-binder`
   * also holds a Black Lotus the remote lacks entirely, which is the removal a
   * failed resolution must not write.
   */
  const ambiguousStore = (): FakeStore =>
    fakeStore([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Black Lotus', 'lea', '232', { cardId: 2 }),
        ],
      },
      {
        name: 'long-box',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 3 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 4 }),
        ],
      },
    ])

  const oneSolRing = (): MockArchidekt =>
    mockArchidekt({
      pages: [
        [record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 })],
      ],
    })

  test('fails the run and writes nothing when no strategy can place them', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    const state = fakeState()

    const { run, logs } = await sync({ direction: 'pull', client, store, state })

    expect(store.applied).toEqual([])
    // Nothing was written means nothing at all: no list was created, and the
    // account's timestamp does not claim a sync that changed nothing.
    expect(store.created).toEqual([])
    expect(state.written).toEqual([])
    expect(run.writtenFiles).toEqual([])
    expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
    expect(run.report.errors[0]).toContain('Could not place 2 × Sol Ring (LTC:284)')
    expect(run.report.errors[0]).toContain('Nothing was written.')
    // The ambiguity itself is still reported, per list and with its counts.
    expect(run.report.ambiguous[0]?.lists).toEqual([
      { list: 'blue-binder', copies: 1 },
      { list: 'long-box', copies: 2 },
    ])
    expect(logs).toContain(
      'Not removing 2 × Sol Ring (LTC:284): ambiguous — copies live in "blue-binder" (1) and "long-box" (2).',
    )
  })

  test('a removal priority places the copies and says which list lost them', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      removalPriority: ['long-box'],
    })

    expect(run.report.errors).toEqual([])
    const longBox = store.applied.find((applied) => applied.list === 'long-box')
    expect(removedIds(longBox?.changes ?? [])).toEqual([4, 3])
    // The Black Lotus removal, which was never ambiguous, applied alongside it.
    expect(store.applied.find((applied) => applied.list === 'blue-binder')?.changes).toHaveLength(1)
    expect(run.report.totals.removed).toBe(3)
    expect(logs).toContain('Removing 2 × Sol Ring (LTC:284) from "long-box" (removal priority).')
  })

  test('a priority that cannot cover the copies fails the run without writing', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    const state = fakeState()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state,
      // blue-binder holds one copy; two have to go.
      removalPriority: ['blue-binder'],
    })

    expect(store.applied).toEqual([])
    expect(store.created).toEqual([])
    expect(state.written).toEqual([])
    expect(run.writtenFiles).toEqual([])
    expect(run.report.errors[0]).toContain(
      'The removal priority (blue-binder) cannot place 2 × Sol Ring (LTC:284)',
    )
  })

  test('an unknown priority list name fails the run before anything is planned', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    const state = fakeState()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state,
      removalPriority: ['long-box', 'card-shop'],
    })

    expect(store.applied).toEqual([])
    expect(store.created).toEqual([])
    expect(state.written).toEqual([])
    expect(run.report.errors[0]).toBe(
      'Cannot use the removal priority: no collection list is named "card-shop".',
    )
  })

  test('a priority naming two lists at once says which they are', async () => {
    // Two files answer to the same name once case is folded, so the priority
    // cannot say which binder may lose cards.
    const store = fakeStore([
      { name: 'inbox', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      { name: 'InBox', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 2 })] },
    ])
    const { client } = oneSolRing()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      removalPriority: ['Inbox'],
    })

    expect(run.report.errors[0]).toBe(
      'Cannot use the removal priority: more than one collection list is named "Inbox": inbox, InBox.',
    )
    expect(store.applied).toEqual([])
  })

  test('a priority is resolved even when the run has nothing ambiguous in it', async () => {
    // The names are checked before the plan is consulted, so a typo fails a run
    // it could never have applied to — and, being a run-level failure, it writes
    // nothing at all rather than syncing the parts it understood.
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Black Lotus', 'lea', '232', { cardId: 1 })],
      },
    ])
    const { client } = oneSolRing()
    const state = fakeState()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state,
      removalPriority: ['nope'],
    })

    expect(run.report.ambiguous).toEqual([])
    expect(run.report.errors[0]).toBe(
      'Cannot use the removal priority: no collection list is named "nope".',
    )
    expect(store.applied).toEqual([])
    expect(state.written).toEqual([])
  })

  test('a run with an addition and an ambiguity creates no target list either', async () => {
    // The one path that writes a *new* file — resolving the pull target — must
    // stay behind the ambiguity gate: `writtenFiles` hardcodes `[]` on the
    // failure path, so a list created before it would be invisible here.
    const store = ambiguousStore()
    const { client } = mockArchidekt({
      pages: [
        [
          record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
          // Held by no list, so a successful run would create "Inbox" for it.
          record({ id: 2, name: 'Mox Pearl', set: 'lea', collectorNumber: '263' }),
        ],
      ],
    })
    const state = fakeState()

    const { run } = await sync({ direction: 'pull', client, store, state })

    expect(store.created).toEqual([])
    expect(store.applied).toEqual([])
    expect(state.written).toEqual([])
    expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
    expect(run.report.errors[0]).toContain('Nothing was written.')
  })

  test('a priority is the only strategy consulted, so nothing is asked', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    let asked = false

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      removalPriority: ['long-box'],
      resolveAmbiguous: () => {
        asked = true
        return { ok: false, message: 'asked anyway.' }
      },
    })

    expect(asked).toBe(false)
    expect(run.report.errors).toEqual([])
    expect(run.report.totals.removed).toBe(3)
  })

  test('calls the resolver once with the whole set and applies its answer', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    const calls: number[] = []

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      resolveAmbiguous: (ambiguous) => {
        calls.push(ambiguous.length)
        return {
          ok: true,
          assignments: ambiguous.map((entry) => ({
            key: entry.key,
            choices: [
              { list: 'blue-binder', copies: 1 },
              { list: 'long-box', copies: 1 },
            ],
          })),
        }
      },
    })

    expect(calls).toEqual([1])
    expect(run.report.errors).toEqual([])
    // One copy from each binder, plus the Black Lotus that was never ambiguous.
    expect(store.applied.map((applied) => [applied.list, removedIds(applied.changes)])).toEqual([
      ['blue-binder', [2, 1]],
      ['long-box', [4]],
    ])
    expect(run.report.totals.removed).toBe(3)
  })

  test('a resolver that gives up fails the run, quoting its own reason', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    const state = fakeState()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state,
      resolveAmbiguous: () => ({ ok: false, message: 'Cancelled after 1 of 2 copies.' }),
    })

    expect(store.applied).toEqual([])
    expect(store.created).toEqual([])
    expect(run.writtenFiles).toEqual([])
    // The resolver's wording reaches the report, so `--output json` carries it.
    expect(run.report.errors).toEqual(['Cancelled after 1 of 2 copies. Nothing was written.'])
    expect(state.written).toEqual([])
  })

  test('an incomplete answer is refused rather than half-applied', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      // Only one of the two copies is accounted for.
      resolveAmbiguous: (ambiguous) => ({
        ok: true,
        assignments: ambiguous.map((entry) => ({
          key: entry.key,
          choices: [{ list: 'long-box', copies: 1 }],
        })),
      }),
    })

    expect(store.applied).toEqual([])
    expect(run.report.errors[0]).toContain('did not say which lists lose those copies')
  })

  test('a dry run reports the ambiguity without asking or failing', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()
    let asked = false

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      dryRun: true,
      resolveAmbiguous: () => {
        asked = true
        return { ok: false, message: 'asked anyway.' }
      },
    })

    expect(asked).toBe(false)
    expect(run.report.errors).toEqual([])
    expect(store.applied).toEqual([])
    expect(run.report.ambiguous).toHaveLength(1)
    expect(logs).toContain(
      '[dry-run] A real run would refuse to place 2 × Sol Ring (LTC:284) until the ambiguity is resolved.',
    )
    // Only the Black Lotus removal is previewed; the ambiguous copies are not.
    expect(run.report.totals.removed).toBe(1)
  })

  test('a dry run says how a priority would place each removal', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      dryRun: true,
      removalPriority: ['long-box'],
    })

    expect(store.applied).toEqual([])
    expect(logs).toContain(
      '[dry-run] Removing 2 × Sol Ring (LTC:284) from "long-box" (removal priority).',
    )
    expect(run.report.totals.removed).toBe(3)
  })

  test('a dry run still fails on a priority name that resolves to nothing', async () => {
    // The exemption is from the *ambiguity*, not from a bad argument: the names
    // are resolved before the plan is consulted, so a typo fails a preview too.
    const store = ambiguousStore()
    const { client } = oneSolRing()

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      dryRun: true,
      removalPriority: ['card-shop'],
    })

    expect(run.report.errors[0]).toBe(
      'Cannot use the removal priority: no collection list is named "card-shop".',
    )
    expect(store.applied).toEqual([])
  })

  test('a dry run says a priority that cannot place the copies would fail', async () => {
    const store = ambiguousStore()
    const { client } = oneSolRing()

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      dryRun: true,
      removalPriority: ['blue-binder'],
    })

    expect(run.report.errors).toEqual([])
    expect(
      logs.some((line) => line.startsWith('[dry-run] The removal priority (blue-binder) cannot')),
    ).toBe(true)
  })
})

// ── Unreadable lines ──────────────────────────────────────────────────

describe('runCollectionSync (unreadable lines)', () => {
  const unreadableStore = (): FakeStore =>
    fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })],
        warnings: ['Skipped malformed line: - ???'],
      },
    ])

  test('refuses a list whose lines the parser could not read', async () => {
    const store = unreadableStore()
    const { client } = mockArchidekt({ pages: [[]] })

    const { run, events } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(events.some((event) => event.kind === 'unreadable-lines')).toBe(true)
    expect(store.applied).toEqual([])
    expect(run.report.failedCount).toBe(1)
    expect(run.report.unreadable[0]?.file).toBe('blue-binder.md')
    expect(run.report.lists[0]?.reason).toContain('1 unreadable line')
  })

  test('syncs it once the caller accepts what would be dropped', async () => {
    const store = unreadableStore()
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      confirmUnreadable: () => true,
    })

    expect(store.applied[0]?.list).toBe('blue-binder')
    expect(run.report.failedCount).toBe(0)
    // Reported either way, so a caller that never sees the event still knows.
    expect(run.report.unreadable).toHaveLength(1)
  })

  test('a dry run previews it without asking', async () => {
    const store = unreadableStore()
    const { client } = mockArchidekt({ pages: [[]] })
    let asked = false

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      dryRun: true,
      confirmUnreadable: () => {
        asked = true
        return false
      },
    })

    expect(asked).toBe(false)
    expect(run.report.failedCount).toBe(0)
    expect(run.report.totals.removed).toBe(1)
  })
})

// ── Push ──────────────────────────────────────────────────────────────

describe('runCollectionSync (push)', () => {
  test('creates records for local-only cards', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { finish: 'foil', cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { finish: 'foil', cardId: 2 }),
        ],
      },
    ])
    const { client, requests } = mockArchidekt({ pages: [[]], printings: { 'ltc:284': 4242 } })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    const created = requests.find((request) => request.method === 'POST')
    expect(created?.url).toBe('https://archidekt.com/api/collection/v2/')
    expect(created?.body).toEqual({
      game: 1,
      quantity: 2,
      card: 4242,
      modifier: 'Foil',
      language: 1,
      condition: 1,
      tags: [],
      purchasePrice: null,
    })
    expect(run.report.into).toBeNull()
    expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', status: 'synced', added: 2 })
    expect(run.writtenFiles).toEqual([])
  })

  test('deletes records for cards that live in no list any more', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client, requests } = mockArchidekt({
      pages: [
        [
          record({ id: 11, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 2 }),
          record({ id: 12, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', quantity: 1 }),
        ],
      ],
    })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    const deleted = requests.find((request) => request.method === 'DELETE')
    expect(deleted?.url).toBe('https://archidekt.com/api/collection/bulk/')
    expect(deleted?.body).toEqual({ ids: [11, 12] })
    expect(run.report.totals.removed).toBe(3)
    // The cards belong to no list, so the deletion is the run's, not a list's.
    expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', removed: 0 })
  })

  test('grows the leading record when the binders hold more copies', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { cardId: 1 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 2 }),
          entry('Sol Ring', 'ltc', '284', { cardId: 3 }),
        ],
      },
    ])
    const { client, requests } = mockArchidekt({
      pages: [
        [
          record({
            id: 11,
            name: 'Sol Ring',
            set: 'ltc',
            collectorNumber: '284',
            quantity: 1,
            archidektCardId: 4242,
          }),
        ],
      ],
    })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    const patched = requests.find((request) => request.method === 'PATCH')
    expect(patched?.url).toBe('https://archidekt.com/api/collection/v2/11/')
    expect(patched?.body).toMatchObject({ id: 11, quantity: 3, card: 4242 })
    expect(run.report.totals).toEqual({ added: 2, removed: 0, skipped: 0, pending: 0 })
  })

  test('a card split across binders counts for both of them', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      { name: 'long-box', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 2 })] },
    ])
    const { client, requests } = mockArchidekt({ pages: [[]], printings: { 'ltc:284': 4242 } })

    const { run, logs } = await sync({ direction: 'push', client, store, state: fakeState() })

    // One record covers both copies; neither binder pushed it alone.
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(run.report.lists).toEqual([
      {
        name: 'blue-binder',
        status: 'synced',
        reason: undefined,
        added: 2,
        removed: 0,
        pending: 0,
      },
      // Credited, so not "no changes" — the copies it holds really did move.
      { name: 'long-box', status: 'synced', reason: undefined, added: 2, removed: 0, pending: 0 },
    ])
    expect(logs.filter((line) => line === 'No changes.')).toEqual([])
    expect(run.report.totals.added).toBe(2)
  })

  test('creates a record for a double-faced card Archidekt names by its front face', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Delver of Secrets // Insectile Aberration', 'isd', '51', { cardId: 1 })],
      },
    ])
    const { client, requests } = mockArchidekt({ pages: [[]], printings: { 'isd:51': 5151 } })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    expect(run.report.failedCount).toBe(0)
    const created = requests.find((request) => request.method === 'POST')
    expect(created?.body).toMatchObject({ card: 5151, quantity: 1 })
    // Archidekt is searched for the front face, never the `//` spelling.
    const search = requests.find((request) => request.url.includes('/api/cards/v2/'))
    expect(new URL(search?.url ?? '').searchParams.get('nameSearch')).toBe('Delver of Secrets')
  })

  test('a printing Archidekt cannot resolve fails its list without stopping the run', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Made Up Card', 'xxx', '1', { cardId: 1 })],
      },
      {
        name: 'long-box',
        entries: [entry('Sol Ring', 'ltc', '284', { cardId: 2 })],
      },
    ])
    const { client, requests } = mockArchidekt({ pages: [[]], printings: { 'ltc:284': 4242 } })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists.find((list) => list.name === 'blue-binder')?.reason).toContain(
      'Card not found on Archidekt: Made Up Card (XXX:1)',
    )
    // The second list still pushed.
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(run.report.lists.find((list) => list.name === 'long-box')?.status).toBe('synced')
  })

  test('a dry run resolves printings but writes nothing', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
    ])
    const state = fakeState()
    const { client, requests } = mockArchidekt({ pages: [[]], printings: { 'ltc:284': 4242 } })

    const { run, logs } = await sync({
      direction: 'push',
      client,
      store,
      state,
      dryRun: true,
    })

    // The collection read, then the printing lookup a create has to resolve.
    expect(requests.map((request) => request.method)).toEqual(['GET', 'GET'])
    expect(requests[1]?.url).toContain('collectorNumber=284')
    expect(state.written).toEqual([])
    expect(run.report.totals.added).toBe(1)
    expect(logs).toContain('[dry-run] Would add 1 × Sol Ring (LTC:284).')
  })

  test('refuses to push when nothing local could be read', async () => {
    // An empty local side would otherwise read as "the collection is empty" and
    // delete every record in the account.
    const store = fakeStore([])
    const { client, requests } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
    })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    expect(requests).toEqual([])
    expect(run.report.errors[0]).toContain('Refusing')
  })
})

// ── Pushing additions as a CSV import ─────────────────────────────────

/**
 * Adding a printing costs a search plus a create, so a first push of a real
 * collection is hundreds of paced requests. Past {@link CSV_UPLOAD_THRESHOLD}
 * new printings the additions go through Archidekt's CSV importer instead —
 * built entirely from the local cache, so the whole batch costs one upload.
 *
 * What is pinned here is the flow around that: which route a run takes and who
 * decided it, that the question is settled before anything reaches Archidekt,
 * and that quantity changes and removals are untouched by any of it. The CSV
 * itself is pinned in `csv.test.ts`, and the upload transport in the client's
 * own tests.
 */
describe('runCollectionSync (push CSV additions)', () => {
  /** `count` distinct local printings, none of which the account holds. */
  function manyAdditions(count: number, list = 'blue-binder'): FakeListInput {
    return {
      name: list,
      entries: Array.from({ length: count }, (_, index) =>
        entry(`Card ${index + 1}`, 'ltc', String(index + 1), { cardId: index + 1 }),
      ),
    }
  }

  /** Archidekt printing ids for the same set, so the per-card path can resolve them. */
  function additionPrintings(count: number): Record<string, number> {
    return Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`ltc:${index + 1}`, 4000 + index]),
    )
  }

  /** The cache holding every printing `manyAdditions` names, minus `absent` numbers. */
  function additionCache(count: number, absent: string[] = []): CardPrintingsLookup {
    return printingsLookup(
      Array.from({ length: count }, (_, index) =>
        printing(`Card ${index + 1}`, 'ltc', String(index + 1), ['nonfoil']),
      ).filter((card) => !absent.includes(card.collector_number)),
    )
  }

  /** The data rows of an upload, header excluded. */
  function uploadedRows(requests: readonly RecordedRequest[]): string[] {
    const upload = requests.find((request) => request.csv !== undefined)
    return (upload?.csv ?? '').trimEnd().split('\n').slice(1)
  }

  /** A `writeCsv` seam that records instead of touching the filesystem. */
  function csvWriter(): { write: CsvFileWriter; written: { path: string; content: string }[] } {
    const written: { path: string; content: string }[] = []
    return {
      written,
      write: (path, content) => {
        written.push({ path, content })
        return Promise.resolve()
      },
    }
  }

  test('exactly at the threshold the additions still go one at a time', async () => {
    const store = fakeStore([manyAdditions(CSV_UPLOAD_THRESHOLD)])
    const { client, requests } = mockArchidekt({
      pages: [[]],
      printings: additionPrintings(CSV_UPLOAD_THRESHOLD),
    })

    const { run } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      lookupPrintings: additionCache(CSV_UPLOAD_THRESHOLD),
    })

    expect(run.report.csv).toBeNull()
    expect(requests.filter((request) => request.csv !== undefined)).toEqual([])
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(
      CSV_UPLOAD_THRESHOLD,
    )
    expect(run.report.totals).toEqual({
      added: CSV_UPLOAD_THRESHOLD,
      removed: 0,
      skipped: 0,
      pending: 0,
    })
  })

  test('one past the threshold with nobody to ask fails, leaving the account untouched', async () => {
    const store = fakeStore([manyAdditions(CSV_UPLOAD_THRESHOLD + 1)])
    const state = fakeState()
    // A record no list holds: a run that got as far as executing anything would
    // have deleted it, so its survival is what "untouched" means.
    const { client, requests } = mockArchidekt({
      pages: [[record({ id: 9, name: 'Sol Ring', set: 'c21', collectorNumber: '240' })]],
      printings: additionPrintings(CSV_UPLOAD_THRESHOLD + 1),
    })

    const { run } = await sync({
      direction: 'push',
      client,
      store,
      state,
      lookupPrintings: additionCache(CSV_UPLOAD_THRESHOLD + 1),
    })

    // Only the collection read went out: no printing search, no create, no delete.
    expect(requests.map((request) => request.method)).toEqual(['GET'])
    // Surface-neutral: this branch is only reached by callers that supply no
    // decider (the admin API, the MCP tool), where CLI flags would be advice the
    // reader cannot take — the CLI's own decider names them instead.
    expect(run.report.errors[0]).toBe(
      '26 cards would be added — more than 25, so adding them one at a time would cost 26 ' +
        'printing searches, and this run was not told to upload them as one CSV import instead. ' +
        'Nothing was pushed.',
    )
    expect(run.report.csv).toBeNull()
    expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
    // Nothing was written means the account's timestamp too.
    expect(state.written).toEqual([])
  })

  test('csv uploads the additions in Archidekt’s own spellings, without a search', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [
          entry('Sol Ring', 'ltc', '284', { finish: 'foil', condition: 'DMG', cardId: 1 }),
          entry('Black Lotus', 'lea', '232', { cardId: 2 }),
          entry('Black Lotus', 'lea', '232', { cardId: 3 }),
        ],
      },
    ])
    const { client, requests } = mockArchidekt({ pages: [[]] })

    const { run, logs } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      // Forced rather than earned: the flag applies at any count.
      csv: true,
      lookupPrintings: printingsLookup([
        printing('Sol Ring', 'ltc', '284', ['nonfoil', 'foil']),
        printing('Black Lotus', 'lea', '232', ['nonfoil']),
      ]),
    })

    // The uid keys every row, so nothing is searched for and nothing is created
    // one at a time.
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST'])
    expect(requests[1]?.url).toBe('https://archidekt.com/api/collection/upload/v2/')
    expect(uploadedRows(requests)).toEqual([
      // Damaged is `D` in a CSV cell, not Ritual's `DMG`, and a foil is `Foil`.
      // The uid is the cached printing's Scryfall id, which is nothing the set and
      // collector number could be spelled into.
      `${printingId('ltc', '284')},1,Foil,D`,
      // Two copies of one printing are one row.
      `${printingId('lea', '232')},2,Normal,NM`,
    ])
    expect(run.report.csv).toEqual({
      status: 'uploaded',
      cards: 3,
      rows: 2,
      uncached: 0,
      chunks: 1,
      failures: [],
      unconfirmedChunks: 0,
    })
    expect(run.report.totals).toEqual({ added: 3, removed: 0, skipped: 0, pending: 0 })
    expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', status: 'synced', added: 3 })
    expect(logs).toContain('Imported 3 cards (2 rows) from the CSV in 1 request.')
  })

  test('a printing the cache does not hold falls back to the per-card path', async () => {
    const count = CSV_UPLOAD_THRESHOLD + 1
    const store = fakeStore([manyAdditions(count)])
    const { client, requests } = mockArchidekt({
      pages: [[]],
      printings: additionPrintings(count),
    })

    const { run, logs } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      csv: true,
      // Card 3's printing is missing, so it cannot be turned into a row.
      lookupPrintings: additionCache(count, ['3']),
    })

    expect(uploadedRows(requests)).toHaveLength(count - 1)
    // One search plus one create for the card that could not ride the CSV.
    const searches = requests.filter((request) => request.url.includes('/api/cards/v2/'))
    expect(searches).toHaveLength(1)
    expect(searches[0]?.url).toContain('collectorNumber=3')
    expect(
      requests.filter((request) => request.url === 'https://archidekt.com/api/collection/v2/'),
    ).toHaveLength(1)
    expect(run.report.csv).toMatchObject({ status: 'uploaded', rows: count - 1, uncached: 1 })
    // Both routes landed their copies, so the totals still cover every addition.
    expect(run.report.totals.added).toBe(count)
    expect(logs).toContain(
      '1 addition cannot ride the CSV (the printing is not in the Scryfall cache); it is added one at a time instead.',
    )
    expect(logs.some((line) => line.includes('Card 3 (LTC:3) is not in the Scryfall cache'))).toBe(
      true,
    )
  })

  test('a cache holding no printing at all reports an empty CSV and pushes the slow way', async () => {
    const count = CSV_UPLOAD_THRESHOLD + 1
    const store = fakeStore([manyAdditions(count)])
    const { client, requests } = mockArchidekt({ pages: [[]], printings: additionPrintings(count) })

    const { run, logs } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      csv: true,
      // The degenerate case of the fallback above: not one printing can be keyed,
      // so there is no file to upload and every addition takes the per-card path.
      lookupPrintings: noPrintings,
    })

    expect(requests.filter((request) => request.csv !== undefined)).toEqual([])
    expect(requests.filter((request) => request.url.includes('/api/cards/v2/'))).toHaveLength(count)
    // Reported rather than left null: the run *did* take the CSV route, and this is
    // the only record of why those cards cost a search each.
    expect(run.report.csv).toEqual({ status: 'empty', cards: 0, rows: 0, uncached: count })
    expect(run.report.totals.added).toBe(count)
    expect(logs).toContain(
      `${count} additions cannot ride the CSV (the printing is not in the Scryfall cache); they are added one at a time instead.`,
    )
  })

  test('the threshold counts the additions a change filter left, not the ones it dropped', async () => {
    const count = CSV_UPLOAD_THRESHOLD + 1
    const store = fakeStore([manyAdditions(count)])
    const { client, requests } = mockArchidekt({
      // One record no list holds: the only change `--only removals` keeps.
      pages: [[record({ id: 9, name: 'Sol Ring', set: 'c21', collectorNumber: '240' })]],
      printings: additionPrintings(count),
    })
    let asked = false

    const { run } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      only: 'removals',
      lookupPrintings: additionCache(count),
      decideCsv: () => {
        asked = true
        return { kind: 'upload' }
      },
    })

    // The 26 additions were filtered out, so there is no CSV question to raise —
    // and the removal goes ahead rather than the run refusing.
    expect(asked).toBe(false)
    expect(run.report.errors).toEqual([])
    expect(run.report.csv).toBeNull()
    expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE'])
    expect(run.report.totals).toMatchObject({ added: 0, removed: 1, skipped: count })
  })

  test('csvFile writes the CSV and pushes no addition, while removals still push', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
    ])
    const state = fakeState()
    const { client, requests } = mockArchidekt({
      // A record no list holds any more: the removals of a `--csv-file` run still
      // reach Archidekt, only the additions do not.
      pages: [[record({ id: 9, name: 'Black Lotus', set: 'lea', collectorNumber: '232' })]],
      printings: { 'ltc:284': 4242 },
    })
    const writer = csvWriter()

    const { run, logs } = await sync({
      direction: 'push',
      client,
      store,
      state,
      csvFile: 'out/archidekt-import.csv',
      writeCsv: writer.write,
      lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
    })

    // The only writes on the wire are the delete; nothing was created or uploaded.
    expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE'])
    expect(writer.written).toEqual([
      {
        path: 'out/archidekt-import.csv',
        content: `Scryfall ID,Quantity,Variant,Condition\n${printingId('ltc', '284')},1,Normal,NM\n`,
      },
    ])
    expect(run.writtenFiles).toEqual(['out/archidekt-import.csv'])
    expect(run.report.csv).toEqual({
      status: 'exported',
      cards: 1,
      rows: 1,
      uncached: 0,
      path: 'out/archidekt-import.csv',
    })
    // Counted as pending, never as added: the card is in a file, not in the
    // account.
    expect(run.report.totals).toEqual({ added: 0, removed: 1, skipped: 0, pending: 1 })
    expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', status: 'synced', pending: 1 })
    expect(logs).toContain(
      'Wrote 1 card (1 row) to out/archidekt-import.csv; they were not pushed. Import the file at https://archidekt.com/collections/import.',
    )
    // The run did apply something, so it stamps the account state.
    expect(state.written).toHaveLength(1)
  })

  test('a CSV file that cannot be written fails those additions, not the run', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
    ])
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({
      direction: 'push',
      client,
      store,
      state: fakeState(),
      csvFile: '/nope/import.csv',
      writeCsv: () => Promise.reject(new Error('permission denied')),
      lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
    })

    expect(run.writtenFiles).toEqual([])
    expect(run.report.csv).toMatchObject({ status: 'failed', cards: 1 })
    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists[0]?.reason).toContain('permission denied')
    expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
  })

  describe('the decision seam', () => {
    const overThreshold = CSV_UPLOAD_THRESHOLD + 1

    /** A run one addition past the threshold, answered by `decideCsv`. */
    async function decided(
      decideCsv: NonNullable<CollectionSyncOptions['decideCsv']>,
      options: Partial<CollectionSyncOptions> = {},
    ): Promise<Harness & { requests: RecordedRequest[]; state: FakeStateStore }> {
      const store = fakeStore([manyAdditions(overThreshold)])
      const state = fakeState()
      const { client, requests } = mockArchidekt({
        pages: [[record({ id: 9, name: 'Sol Ring', set: 'c21', collectorNumber: '240' })]],
        printings: additionPrintings(overThreshold),
      })
      const harness = await sync({
        direction: 'push',
        client,
        store,
        state,
        decideCsv,
        lookupPrintings: additionCache(overThreshold),
        ...options,
      })
      return { ...harness, requests, state }
    }

    test('is asked once, with the counts and the threshold it passed', async () => {
      const asked: CsvUploadQuestion[] = []

      await decided((question) => {
        asked.push(question)
        return { kind: 'upload' }
      })

      expect(asked).toEqual([{ additions: overThreshold, threshold: CSV_UPLOAD_THRESHOLD }])
    })

    test('upload sends the CSV', async () => {
      const { run, requests } = await decided(() => ({ kind: 'upload' }))

      expect(uploadedRows(requests)).toHaveLength(overThreshold)
      expect(run.report.csv).toMatchObject({ status: 'uploaded' })
    })

    test('export-to-path writes the file instead of pushing the additions', async () => {
      const writer = csvWriter()

      const { run, requests } = await decided(() => ({ kind: 'export', path: ' import.csv ' }), {
        writeCsv: writer.write,
      })

      // The path is trimmed before it is used, so a prompt's stray space cannot
      // create " import.csv ".
      expect(writer.written.map((file) => file.path)).toEqual(['import.csv'])
      expect(requests.filter((request) => request.csv !== undefined)).toEqual([])
      expect(run.report.csv).toMatchObject({ status: 'exported', path: 'import.csv' })
      expect(run.report.totals.pending).toBe(overThreshold)
    })

    test('a blank export path is refused rather than written to', async () => {
      const writer = csvWriter()

      const { run, requests } = await decided(() => ({ kind: 'export', path: '   ' }), {
        writeCsv: writer.write,
      })

      expect(writer.written).toEqual([])
      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.errors[0]).toBe(
        'No file was named for the additions CSV. Nothing was pushed.',
      )
    })

    test('individual adds them one at a time anyway', async () => {
      const { run, requests } = await decided(() => ({ kind: 'individual' }))

      expect(requests.filter((request) => request.csv !== undefined)).toEqual([])
      expect(
        requests.filter((request) => request.url === 'https://archidekt.com/api/collection/v2/'),
      ).toHaveLength(overThreshold)
      expect(run.report.csv).toBeNull()
      expect(run.report.totals.added).toBe(overThreshold)
    })

    test('abort leaves the account exactly as it was, quoting the reason', async () => {
      const { run, requests, state } = await decided(() => ({
        kind: 'abort',
        message: 'Cancelled before adding 26 cards.',
      }))

      // Not even the delete of the record no list holds went out.
      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.errors).toEqual(['Cancelled before adding 26 cards. Nothing was pushed.'])
      expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
      expect(state.written).toEqual([])
    })

    test('a decider that throws is a decision that was never made', async () => {
      const { run, requests } = await decided(() => {
        throw new Error('no terminal')
      })

      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.errors[0]).toBe(
        'Could not decide how to add 26 cards: no terminal. Nothing was pushed.',
      )
    })

    test('is not consulted when a flag already answered the question', async () => {
      let asked = false

      const { run } = await decided(
        () => {
          asked = true
          return { kind: 'individual' }
        },
        { csv: true },
      )

      expect(asked).toBe(false)
      expect(run.report.csv).toMatchObject({ status: 'uploaded' })
    })

    test('is not consulted at or below the threshold', async () => {
      const store = fakeStore([manyAdditions(CSV_UPLOAD_THRESHOLD)])
      const { client } = mockArchidekt({
        pages: [[]],
        printings: additionPrintings(CSV_UPLOAD_THRESHOLD),
      })
      let asked = false

      const { run } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        lookupPrintings: additionCache(CSV_UPLOAD_THRESHOLD),
        decideCsv: () => {
          asked = true
          return { kind: 'upload' }
        },
      })

      expect(asked).toBe(false)
      expect(run.report.csv).toBeNull()
    })
  })

  describe('dry runs', () => {
    test('never search for the additions they would upload', async () => {
      const count = CSV_UPLOAD_THRESHOLD + 1
      const store = fakeStore([manyAdditions(count)])
      const state = fakeState()
      const { client, requests } = mockArchidekt({
        pages: [[]],
        printings: additionPrintings(count),
      })
      let asked = false

      const { run, logs } = await sync({
        direction: 'push',
        client,
        store,
        state,
        dryRun: true,
        lookupPrintings: additionCache(count),
        decideCsv: () => {
          asked = true
          return { kind: 'individual' }
        },
      })

      // The whole point of the preview: one read, and not one of the 26 printing
      // searches a per-card preview would have made.
      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(asked).toBe(false)
      expect(logs).toContain('[dry-run] Would upload 26 cards (26 rows) as a CSV import.')
      expect(run.report.csv).toEqual({
        status: 'planned',
        destination: 'upload',
        cards: count,
        rows: count,
        uncached: 0,
      })
      expect(run.report.totals.added).toBe(count)
      expect(state.written).toEqual([])
    })

    test('report the file a --csv-file run would write, without writing it', async () => {
      const store = fakeStore([
        { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      ])
      const { client, requests } = mockArchidekt({ pages: [[]] })
      const writer = csvWriter()

      const { run, logs } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        dryRun: true,
        csvFile: 'import.csv',
        writeCsv: writer.write,
        lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
      })

      expect(writer.written).toEqual([])
      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.writtenFiles).toEqual([])
      expect(run.report.csv).toEqual({
        status: 'planned',
        destination: 'export',
        path: 'import.csv',
        cards: 1,
        rows: 1,
        uncached: 0,
      })
      expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 1 })
      expect(logs).toContain(
        '[dry-run] Would write 1 card (1 row) to import.csv for a manual upload at https://archidekt.com/collections/import.',
      )
    })

    test('do not search even for the additions the CSV could not carry', async () => {
      const count = CSV_UPLOAD_THRESHOLD + 1
      const store = fakeStore([manyAdditions(count)])
      const { client, requests } = mockArchidekt({
        pages: [[]],
        printings: additionPrintings(count),
      })

      const { run, logs } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        dryRun: true,
        // Card 3 is missing from the cache, so it cannot become a row — and a
        // preview must still not spend a paced search on it. With a whole stale
        // cache that one search is 26 of them, which is the rate limiting this
        // path exists to avoid.
        lookupPrintings: additionCache(count, ['3']),
      })

      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.csv).toMatchObject({ status: 'planned', rows: count - 1, uncached: 1 })
      expect(logs).toContain(
        '[dry-run] Would add 1 × Card 3 (LTC:3) one at a time — the printing is not in the Scryfall cache, so it cannot ride the CSV and was not resolved here.',
      )
      // Named, and still counted as the copy a real run would add.
      expect(run.report.totals.added).toBe(count)
      expect(run.report.lists[0]).toMatchObject({ name: 'blue-binder', status: 'synced' })
    })

    test('below the threshold a preview still resolves each printing', async () => {
      // The other half of the rule: a small push has no CSV to preview, so an
      // unresolvable printing is exactly the failure the preview should surface.
      const store = fakeStore([
        { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      ])
      const { client, requests } = mockArchidekt({ pages: [[]] })

      const { run } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        dryRun: true,
        lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
      })

      expect(requests.filter((request) => request.url.includes('/api/cards/v2/'))).toHaveLength(1)
      expect(run.report.csv).toBeNull()
      // The stubbed client knows no printing ids, so the preview reports the
      // failure rather than a card it could not have created.
      expect(run.report.failedCount).toBe(1)
    })
  })

  describe('the cache-freshness gate', () => {
    /** A `--csv` push of one addition, with the gate answering `answer`. */
    async function gated(
      answer: true | string,
    ): Promise<Harness & { requests: RecordedRequest[]; asked: number[] }> {
      const store = fakeStore([
        { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      ])
      const { client, requests } = mockArchidekt({
        // A record no list holds: a refused run must not delete it either.
        pages: [[record({ id: 9, name: 'Black Lotus', set: 'lea', collectorNumber: '232' })]],
      })
      const asked: number[] = []
      const harness = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        csv: true,
        lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
        ensureCsvCache: ({ additions, log }) => {
          asked.push(additions)
          log('Refreshing the card cache...')
          return answer
        },
      })
      return { ...harness, requests, asked }
    }

    test('is asked once with the additions, and its log lines join the run', async () => {
      const { run, requests, asked, logs } = await gated(true)

      expect(asked).toEqual([1])
      expect(logs).toContain('Refreshing the card cache...')
      expect(requests.filter((request) => request.csv !== undefined)).toHaveLength(1)
      expect(run.report.csv).toMatchObject({ status: 'uploaded' })
    })

    test('a refusal fails the run before any remote write, quoting the reason', async () => {
      const { run, requests } = await gated('The card cache is empty.')

      // Only the collection read went out: no upload, and not even the delete of
      // the record no list holds.
      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.errors).toEqual(['The card cache is empty. Nothing was pushed.'])
      expect(run.report.csv).toBeNull()
      expect(run.report.totals).toEqual({ added: 0, removed: 0, skipped: 0, pending: 0 })
    })

    test('is not consulted by a push that adds nothing new', async () => {
      const store = fakeStore([
        { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      ])
      const { client } = mockArchidekt({
        pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
      })
      let asked = false

      await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        csv: true,
        lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
        ensureCsvCache: () => {
          asked = true
          return true
        },
      })

      // No creates, so no CSV, so nothing to vouch for.
      expect(asked).toBe(false)
    })

    test('is not consulted below the threshold, where no CSV is built', async () => {
      const store = fakeStore([manyAdditions(CSV_UPLOAD_THRESHOLD)])
      const { client } = mockArchidekt({
        pages: [[]],
        printings: additionPrintings(CSV_UPLOAD_THRESHOLD),
      })
      let asked = false

      const { run } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        lookupPrintings: additionCache(CSV_UPLOAD_THRESHOLD),
        ensureCsvCache: () => {
          asked = true
          return true
        },
      })

      expect(asked).toBe(false)
      expect(run.report.csv).toBeNull()
    })

    test('a gate that throws is a cache nothing vouched for', async () => {
      const store = fakeStore([
        { name: 'blue-binder', entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })] },
      ])
      const { client, requests } = mockArchidekt({ pages: [[]] })

      const { run } = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        csv: true,
        lookupPrintings: printingsLookup([printing('Sol Ring', 'ltc', '284', ['nonfoil'])]),
        ensureCsvCache: () => {
          throw new Error('the cache lock is held')
        },
      })

      expect(requests.map((request) => request.method)).toEqual(['GET'])
      expect(run.report.errors).toEqual([
        'Could not prepare the card cache for a CSV upload: the cache lock is held. Nothing was pushed.',
      ])
    })
  })

  describe('upload outcomes', () => {
    /** Two additions and one record no list holds, pushed with `--csv`. */
    async function uploaded(
      options: MockArchidektOptions,
    ): Promise<Harness & { requests: RecordedRequest[] }> {
      const store = fakeStore([
        {
          name: 'blue-binder',
          entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })],
        },
        {
          name: 'long-box',
          entries: [entry('Black Lotus', 'lea', '232', { cardId: 1 })],
        },
      ])
      const { client, requests } = mockArchidekt({
        pages: [[record({ id: 9, name: 'Mox Pearl', set: 'lea', collectorNumber: '263' })]],
        ...options,
      })
      const harness = await sync({
        direction: 'push',
        client,
        store,
        state: fakeState(),
        csv: true,
        lookupPrintings: printingsLookup([
          printing('Sol Ring', 'ltc', '284', ['nonfoil']),
          printing('Black Lotus', 'lea', '232', ['nonfoil']),
        ]),
      })
      return { ...harness, requests }
    }

    test('a row Archidekt did not import fails its list and is not counted', async () => {
      const { run, logs } = await uploaded({
        uploadRow: (row) => (row === 1 ? { notFound: true } : {}),
      })

      expect(run.report.csv).toMatchObject({
        status: 'uploaded',
        rows: 2,
        failures: [
          { row: 1, card: 'Black Lotus (LEA:232)', notFound: true, ambiguous: false, errors: [] },
        ],
      })
      // Only the row that landed is counted, and only its list stays clean.
      expect(run.report.totals.added).toBe(1)
      expect(run.report.lists.find((list) => list.name === 'blue-binder')?.status).toBe('synced')
      expect(run.report.lists.find((list) => list.name === 'long-box')?.status).toBe('failed')
      expect(logs).toContain('Archidekt did not import 1 of 2 CSV rows (1 not found).')
      expect(logs).toContain('  Not imported: Black Lotus (LEA:232) — not found on Archidekt.')
    })

    test('a per-row error message is carried through as Archidekt worded it', async () => {
      const { run, logs } = await uploaded({
        uploadRow: (row) => (row === 0 ? { errors: ['quantity must be positive'] } : {}),
      })

      expect(run.report.csv).toMatchObject({
        failures: [{ row: 0, card: 'Sol Ring (LTC:284)', errors: ['quantity must be positive'] }],
      })
      expect(logs).toContain('Archidekt did not import 1 of 2 CSV rows (1 rejected).')
      expect(logs).toContain('  Not imported: Sol Ring (LTC:284) — quantity must be positive.')
    })

    test('a failed upload fails those additions but not the rest of the run', async () => {
      const { run, requests, logs } = await uploaded({ uploadFails: true })

      // The record no list holds was still deleted: the upload's failure belongs
      // to the additions alone.
      expect(requests.some((request) => request.method === 'DELETE')).toBe(true)
      expect(run.report.totals).toEqual({ added: 0, removed: 1, skipped: 0, pending: 0 })
      expect(run.report.csv).toMatchObject({ status: 'failed', cards: 2, rows: 2 })
      expect(run.report.failedCount).toBe(2)
      // No addition is retried the slow way after a failed upload — a partial
      // import would then be imported twice.
      expect(requests.filter((request) => request.url.includes('/api/cards/v2/'))).toEqual([])
      expect(logs.some((line) => line.includes('Failed to upload 2 cards (2 rows)'))).toBe(true)
    })
  })
})

// ── An incomplete local side ──────────────────────────────────────────

/**
 * A list that drops out of the comparison makes every card it holds look like it
 * only exists remotely. Left alone, a pull would copy that whole file into the
 * target list and a push would delete its cards from the account — so the run
 * withholds exactly the changes the shortfall manufactured.
 */
describe('runCollectionSync (incomplete scope)', () => {
  const remoteSolRing = (): ReturnType<typeof record>[] => [
    record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }),
  ]

  test('a pull does not re-add cards held by a list it could not read', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })],
        warnings: ['Skipped malformed line: - ???'],
      },
    ])
    const { client } = mockArchidekt({ pages: [remoteSolRing()] })

    const { run, logs } = await sync({ direction: 'pull', client, store, state: fakeState() })

    // Without the guard the Sol Ring already in blue-binder would be duplicated
    // into the target list.
    expect(store.applied).toEqual([])
    expect(store.created).toEqual([])
    expect(run.report.totals.added).toBe(0)
    expect(run.report.localIncomplete).toBe(true)
    expect(logs.some((line) => line.includes('would be duplicated into "Inbox"'))).toBe(true)
  })

  test('a pull still removes copies from the lists it did read', async () => {
    const store = fakeStore([
      {
        name: 'blue-binder',
        entries: [entry('Black Lotus', 'lea', '232', { cardId: 1 })],
      },
      { name: 'long-box', entries: [], warnings: ['Skipped malformed line: - ???'] },
    ])
    const { client } = mockArchidekt({ pages: [remoteSolRing()] })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    // The removal names a list that *was* loaded, so it is safe to apply.
    expect(store.applied.map((applied) => applied.list)).toEqual(['blue-binder'])
    expect(run.report.totals).toMatchObject({ added: 0, removed: 1 })
  })

  test('an unresolvable list name also withholds a pull’s additions', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({ pages: [remoteSolRing()] })

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      lists: ['blue-binder', 'nonexistent'],
    })

    expect(store.applied).toEqual([])
    expect(run.report.localIncomplete).toBe(true)
  })

  test('a push does not delete records for cards a held-back list still holds', async () => {
    const store = fakeStore([
      { name: 'blue-binder', entries: [entry('Black Lotus', 'lea', '232', { cardId: 1 })] },
      {
        name: 'long-box',
        entries: [entry('Sol Ring', 'ltc', '284', { cardId: 1 })],
        warnings: ['Skipped malformed line: - ???'],
      },
    ])
    const { client, requests } = mockArchidekt({
      pages: [remoteSolRing()],
      printings: { 'lea:232': 99 },
    })

    const { run, logs } = await sync({ direction: 'push', client, store, state: fakeState() })

    expect(requests.filter((request) => request.method === 'DELETE')).toEqual([])
    expect(run.report.totals.removed).toBe(0)
    expect(run.report.localIncomplete).toBe(true)
    expect(logs.some((line) => line.includes('Not removing 1 copy from Archidekt'))).toBe(true)
  })

  test('a complete scope reports itself complete', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({ pages: [[]] })

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(run.report.localIncomplete).toBe(false)
  })
})

// ── The pull target ───────────────────────────────────────────────────

describe('runCollectionSync (pull target)', () => {
  const remote = (): MockArchidekt =>
    mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
    })

  test('matches an existing list by name rather than by substring', async () => {
    // `card-inbox` *contains* "inbox", which is exactly what the target
    // resolution must not treat as a match — those are different binders.
    const store = fakeStore([{ name: 'card-inbox' }])
    const { client } = remote()

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(store.created).toEqual(['inbox'])
    expect(store.applied.map((applied) => applied.list)).toEqual(['inbox'])
    expect(run.report.failedCount).toBe(0)
  })

  test('writes into a list already named the target', async () => {
    const store = fakeStore([{ name: 'inbox' }])
    const { client } = remote()

    await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(store.created).toEqual([])
    expect(store.applied.map((applied) => applied.list)).toEqual(['inbox'])
  })

  test('two lists answering to the target name drop the additions, not the run', async () => {
    // Both normalize to "inbox", so the run cannot choose between them.
    const store = fakeStore([
      { name: 'inbox' },
      { name: 'InBox', entries: [entry('Black Lotus', 'lea', '232', { cardId: 1 })] },
    ])
    const { client } = remote()

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(store.created).toEqual([])
    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists.find((list) => list.name === 'Inbox')?.reason).toContain(
      'More than one collection list is named "Inbox"',
    )
    // The removal of the out-of-sync Black Lotus still applied.
    expect(store.applied.map((applied) => applied.list)).toEqual(['InBox'])
  })

  test('a target that cannot be created fails under the requested name', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    store.create = (): Promise<string> => Promise.resolve('permission denied')
    const { client } = remote()

    const { run } = await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(store.applied).toEqual([])
    expect(run.report.failedCount).toBe(1)
    expect(run.report.lists.find((list) => list.name === 'Inbox')?.reason).toContain(
      'Could not create the collection list "Inbox": permission denied',
    )
  })
})

// ── Naming pulled cards ───────────────────────────────────────────────

describe('runCollectionSync (pulled card names)', () => {
  test('writes the Scryfall spelling of a card Archidekt names by its front face', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({
      pages: [
        [
          record({
            id: 1,
            name: 'Delver of Secrets',
            set: 'isd',
            collectorNumber: '51',
            uid: 'isd-51',
          }),
        ],
      ],
    })

    const { run } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      lookupByScryfallId: (ids) =>
        Promise.resolve(
          new Map(
            ids.includes('isd-51')
              ? [['isd-51', printing('Delver of Secrets // Insectile Aberration', 'isd', '51', [])]]
              : [],
          ),
        ),
    })

    expect(store.applied[0]?.changes[0]).toMatchObject({
      action: 'add',
      cardName: 'Delver of Secrets // Insectile Aberration',
    })
    expect(run.report.totals.added).toBe(1)
  })

  test('falls back to the oracle name when the cache cannot be read', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Delver of Secrets', set: 'isd', collectorNumber: '51' })]],
    })

    const { logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(),
      lookupByScryfallId: () => Promise.reject(new Error('cache is locked')),
    })

    expect(store.applied[0]?.changes[0]).toMatchObject({
      action: 'add',
      cardName: 'Delver of Secrets',
    })
    expect(logs.some((line) => line.includes('Could not read the Scryfall cache'))).toBe(true)
  })
})

// ── Run-level failures ────────────────────────────────────────────────

describe('runCollectionSync (run-level failures)', () => {
  test('a failed orphan delete becomes a run error, not a list failure', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({
      pages: [[record({ id: 11, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
      bulkFails: true,
    })

    const { run } = await sync({ direction: 'push', client, store, state: fakeState() })

    expect(run.report.failedCount).toBe(0)
    expect(run.report.errors[0]).toBe('Failed to remove Sol Ring (LTC:284) from Archidekt')
    expect(run.report.totals.removed).toBe(0)
  })

  test('stops paging when a response advertises a next page past the last one', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client, requests } = mockArchidekt({
      pages: [[record({ id: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' })]],
      endlessNext: true,
    })

    await sync({ direction: 'pull', client, store, state: fakeState() })

    expect(
      requests.filter((request) => request.url.includes(`/api/collection/${TEST_ACCOUNT.id}/v2/`)),
    ).toHaveLength(1)
  })

  test('a timestamp that cannot be recorded warns without failing the run', async () => {
    const store = fakeStore([{ name: 'blue-binder' }])
    const { client } = mockArchidekt({ pages: [[]] })

    const { run, logs } = await sync({
      direction: 'pull',
      client,
      store,
      state: fakeState(true),
    })

    expect(run.report.failedCount).toBe(0)
    expect(run.report.errors).toEqual([])
    expect(logs.some((line) => line.includes('Could not record the sync timestamp'))).toBe(true)
  })
})
