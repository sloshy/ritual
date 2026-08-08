import type { Page, Route } from '@playwright/test'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'
import type { DeckSyncRunResponse } from '../../../src/admin/api/deck-sync'
import type {
  CollectionSyncList,
  CollectionSyncRunResponse,
  CollectionSyncStatusResponse,
} from '../../../src/admin/api/collection-sync'
import type { SyncableDeck, UnreadableDeck } from '../../../src/deck-sync/engine'
import type {
  CollectionSyncCsv,
  CollectionSyncListResult,
  UnreadableList,
} from '../../../src/collection-sync/engine'
import { CSV_UPLOAD_THRESHOLD } from '../../../src/collection-sync/csv'
import type { AmbiguousRemoval } from '../../../src/collection-sync/describe'
import type { CardIndexResponse } from '../../../src/admin/api/card-index'
import type { StatusResponse } from '../../../src/admin/api/status'
import type { SellRefreshResponse } from '../../../src/admin/api/sell'
import { apiMessage } from '../../../src/admin/api/result'
import { renderSyncSummaryEnglish, type SyncSummary } from '../../../src/admin/api/sync-summary'
import {
  type BundleImportResponse,
  type BundleImportResult,
  type ListImportResult,
  bundleImportMessage,
} from '../../../src/admin/api/import-changes'
import type { BuildSiteResponse } from '../../../src/admin/api/build-site'
import type {
  CollectionFullLoadResult,
  DeckFullLoadResult,
  WantedFullLoadResult,
} from '../../../src/admin/api/load-results'
import type { ListInfo } from '../../../src/list-info'
import type { RitualConfig } from '../../../src/ritual-config'
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../src/editor/search-debounce'
import { fulfillJson } from './fulfill'
import { MOCK_COLLECTION_DETAIL, MOCK_WANTED_LIST_DETAIL, makeMockScryfallCard } from './mock-cards'
import { localeTag } from '../../../src/i18n/locale-tag'

type MockDeck = {
  slug: string
  name: string
}

type MockCollection = {
  slug: string
  name: string
}

type AuditEntry = {
  timestamp: string
  success: boolean
  username: string
  ip: string
  reason: string
  userAgent: string
}

export const MOCK_DECKS: MockDeck[] = [
  { slug: 'test-deck', name: 'Test Deck' },
  { slug: 'another-deck', name: 'Another Deck' },
]

export const MOCK_COLLECTIONS: MockCollection[] = [
  { slug: 'test-collection', name: 'Test Collection' },
]

export const MOCK_WANTED_LISTS = [{ slug: 'test-wanted-list', name: 'Test Wanted List' }]

export const MOCK_AUDIT_ENTRIES: AuditEntry[] = [
  {
    timestamp: '2026-03-08T12:00:00.000Z',
    success: true,
    username: 'testadmin',
    ip: '127.0.0.1',
    reason: 'Login successful',
    userAgent: 'Mozilla/5.0 Playwright',
  },
  {
    timestamp: '2026-03-08T11:55:00.000Z',
    success: false,
    username: 'attacker',
    ip: '192.168.1.100',
    reason: 'Invalid password',
    userAgent: 'curl/7.88.1',
  },
]

export const MOCK_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  wantedDir: './wanted',
  defaultCurrency: 'eur',
  defaultLanguage: 'en',
  uiLocale: localeTag('en'),
  cacheLockTimeoutSeconds: 300,
  cacheSource: 'scryfall',
  searchDebounceMs: DEFAULT_SEARCH_DEBOUNCE_MS,
  admin: {
    gitEnabled: false,
    gitAutoCommit: false,
    gitAutoPush: false,
    trustProxy: false,
    secureCookies: false,
    rateLimitEnabled: true,
    rateLimitMaxAttempts: 5,
    rateLimitWindowMinutes: 15,
    failedAuthDelayMs: 1000,
    ipAllowList: [],
    ipDenyList: [],
    userAgentAllowList: [],
    userAgentDenyList: [],
  },
  collectionSync: { pullTarget: 'Inbox' },
} satisfies RitualConfig

/**
 * Mock the decks list API endpoint
 */
export async function mockDecksApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/decks', { decks: MOCK_DECKS }, { method: 'GET' })
}

/**
 * Mock the collections list API endpoint
 */
export async function mockCollectionsApi(page: Page): Promise<void> {
  await fulfillJson(
    page,
    '**/api/collections',
    { collections: MOCK_COLLECTIONS },
    { method: 'GET' },
  )
}

/**
 * Mock the audit log API endpoint
 */
export async function mockAuditLogApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/audit-log*', { success: true, entries: MOCK_AUDIT_ENTRIES })
}

/**
 * Mock the config API endpoints. `overrides` are merged over {@link MOCK_CONFIG}
 * per test (e.g. `{ defaultLanguage: 'ja' }` to exercise the admin shell's
 * config→runtime default-language wiring). Install it BEFORE the first
 * navigation when the value under test is read at app boot — the logged-in
 * Layout fetches `/api/config` once on mount.
 */
export async function mockConfigApi(
  page: Page,
  overrides: Partial<RitualConfig> = {},
): Promise<void> {
  const config: RitualConfig = { ...MOCK_CONFIG, ...overrides }
  await fulfillJson(page, '**/api/config', { success: true, config }, { method: 'GET' })
  await fulfillJson(page, '**/api/config', { success: true, config }, { method: 'PUT' })
}

/**
 * Mock the build-site API endpoint
 */
export async function mockBuildSiteApi(page: Page): Promise<void> {
  // Typed against the real response so a widened body (this one grew `outDir`
  // and `durationMs`) cannot leave the mock behind, telling the UI a shape the
  // server no longer sends.
  const body: BuildSiteResponse = {
    success: true,
    // The whole message triple, as the handler sends it: the alert renders the
    // key when it has one, so a mock carrying only English would silently test
    // the fallback path instead of the real one.
    ...apiMessage('admin.api.buildSite.built'),
    outDir: '/tmp/ritual-e2e/dist',
    durationMs: 1234,
  }
  await fulfillJson(page, '**/api/build-site', body)
}

/**
 * Mock the import-deck API endpoint. Pass `onRequest` to capture the parsed
 * request body for assertions on what the page sent.
 */
export async function mockImportDeckApi(
  page: Page,
  onRequest?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/import-deck', (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    return { success: true, message: 'Deck imported', deckName: 'Imported Deck' }
  })
}

/**
 * Mock the import-csv API endpoint. Pass `onRequest` to capture the parsed
 * request body, and `failures` to simulate rows that failed to import.
 */
export async function mockImportCsvApi(
  page: Page,
  onRequest?: (body: unknown) => void,
  failures?: { lineNumber: number; raw: string; reason: string }[],
): Promise<void> {
  await fulfillJson(page, '**/api/import-csv', (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    // `failures`/`failedCount` are always present on the real response: a
    // partially-failed import is a success whose per-row report is the point.
    const rows = failures ?? []
    return {
      success: true,
      message: 'Imported 3 card(s)',
      cardCount: 3,
      failures: rows,
      failedCount: rows.length,
    }
  })
}

/**
 * Mock the import-changes API endpoint. Pass `onRequest` to capture the parsed
 * request body, and `lists` to control the per-list outcomes reported back.
 *
 * A partially-failed import is still a 200 with `success: true` — the failure
 * count rides on `failedCount` so the per-list report survives — so the envelope
 * and summary line are built by the route's own helper rather than restated here.
 */
export async function mockImportChangesApi(
  page: Page,
  lists: ListImportResult[],
  onRequest?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/import-changes', (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    const result: BundleImportResult = {
      failedCount: lists.filter((l) => l.error !== undefined).length,
      lists,
    }
    const body: BundleImportResponse = {
      success: true,
      ...result,
      message: bundleImportMessage(result),
    }
    return body
  })
}

/**
 * Mock the TOTP status endpoint
 */
export async function mockTotpApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/totp/status', { enabled: false })
}

/**
 * Answer `GET /api/status` with a fixed logged-in payload. Specs that mock the
 * config routes want this too: a Settings save re-reads the effective sell mode
 * from this endpoint, and unmocked it would reach the real e2e server (which
 * runs with `--sell-mode`) and answer for the wrong server. For a status whose
 * `sellMode` must track mock state per request, write the `fulfillJson` closure
 * locally instead (see sell-mode-gate.spec.ts).
 */
export async function mockStatusApi(page: Page, sellMode = false): Promise<void> {
  await fulfillJson(
    page,
    '**/api/status',
    (): StatusResponse => ({ ok: true, setupRequired: false, totpEnabled: false, sellMode }),
  )
}

/**
 * The browser `window` as the SSE mocks see it: `EventSource` is replaceable,
 * and the installed mock instance is stashed for later dispatch.
 */
type MockEventSourceWindow = Window & {
  EventSource: unknown
  __mockEventSource?: EventTarget & { url: string }
}

/** Swap `window.EventSource` for the controllable stand-in. Runs in the page. */
function replaceEventSource(): void {
  class MockEventSource extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2
    readonly url: string
    readyState = 1
    constructor(url: string) {
      super()
      this.url = url
      ;(window as unknown as MockEventSourceWindow).__mockEventSource = this
    }
    close(): void {
      this.readyState = 2
    }
  }
  ;(window as unknown as MockEventSourceWindow).EventSource = MockEventSource
}

/**
 * Replace the page's `EventSource` with a controllable stand-in, for any page
 * driven by a server-sent event stream (cache refresh, deck sync). A
 * route-fulfilled SSE body delivers every event in one burst, unmounting the
 * progress UI before assertions can observe it — tests instead drive each event
 * explicitly via {@link emitStreamEvent}.
 *
 * Installed both into the current document and as an init script, so the mock
 * holds whether it is set up before or after the page navigates.
 */
export async function installMockEventSource(page: Page): Promise<void> {
  await page.addInitScript(replaceEventSource)
  await page.evaluate(replaceEventSource)
}

/**
 * Dispatch one named SSE event on the mock EventSource installed by
 * {@link installMockEventSource}. The page must have constructed it already
 * (i.e. the action that opens the stream was clicked).
 */
export async function emitStreamEvent(
  page: Page,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([eventName, payload]) => {
      const es = (window as unknown as MockEventSourceWindow).__mockEventSource
      if (!es) throw new Error('Mock EventSource not constructed yet — start the stream first')
      es.dispatchEvent(new MessageEvent(eventName, { data: payload }))
    },
    [event, JSON.stringify(data)] as const,
  )
}

/**
 * Dispatch a connection-level failure: an `error` event carrying no data, which
 * is how a browser reports a stream that could not be opened (or was dropped).
 */
export async function emitStreamConnectionError(page: Page): Promise<void> {
  await page.evaluate(() => {
    const es = (window as unknown as MockEventSourceWindow).__mockEventSource
    if (!es) throw new Error('Mock EventSource not constructed yet — start the stream first')
    es.dispatchEvent(new Event('error'))
  })
}

/** The URL the page opened its (mock) event stream with. */
export async function streamUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const es = (window as unknown as MockEventSourceWindow).__mockEventSource
    if (!es) throw new Error('Mock EventSource not constructed yet — start the stream first')
    return es.url
  })
}

/**
 * Mock the cache refresh SSE stream, plus the POST fallback endpoint for
 * completeness. Events are driven from the test via {@link emitStreamEvent}.
 */
export async function mockCacheRefreshApi(page: Page): Promise<void> {
  await installMockEventSource(page)
  await fulfillJson(
    page,
    '**/api/cache/refresh',
    { success: true, ...apiMessage('admin.api.cache.refreshed') },
    { method: 'POST' },
  )
}

/**
 * Mock the buylist status/refresh routes behind the Refresh Cache page's Card
 * Kingdom card. `status` chooses the initial state: 'missing' is the 503 a
 * fresh workspace answers with (an empty state, not an error).
 *
 * `refresh` overrides fields of the `POST /api/sell/refresh` answer, whose
 * default is the clean "downloaded a new feed" outcome. The three outcomes are
 * behaviorally distinct on the client — only `refreshed: true` drops the
 * session's quotes, and a non-empty `warnings` reports "not updated" — so a
 * test has to be able to ask for each.
 */
export async function mockBuylistApi(
  page: Page,
  status: 'present' | 'missing' = 'present',
  refresh: Partial<SellRefreshResponse> = {},
): Promise<void> {
  await fulfillJson(
    page,
    '**/api/buylist/status',
    status === 'present'
      ? {
          success: true,
          buyer: 'cardkingdom',
          buyers: ['cardkingdom'],
          feedCreatedAt: '2026-08-04 06:06:09',
          feedRetrievedAt: 1785850800000,
          stale: false,
          productCount: 149978,
        }
      : { error: 'No Card Kingdom buylist has been downloaded yet.' },
    { status: status === 'present' ? 200 : 503 },
  )
  await fulfillJson(
    page,
    '**/api/sell/refresh*',
    (): SellRefreshResponse => ({
      success: true,
      refreshed: true,
      feedRetrievedAt: 1785850800000,
      feedCreatedAt: '2026-08-04 06:06:09',
      productCount: 149978,
      warnings: [],
      ...refresh,
    }),
    { method: 'POST' },
  )
}

// ===== Deck sync mock data =====

export const ARCHIDEKT_NOT_LOGGED_IN: ArchidektLoginStatus = {
  loggedIn: false,
  username: null,
  accessTokenExpiration: null,
  accessTokenValid: false,
  refreshTokenExpiration: null,
  refreshTokenValid: false,
  loginRequired: true,
}

export const ARCHIDEKT_LOGGED_IN: ArchidektLoginStatus = {
  loggedIn: true,
  username: 'testuser',
  accessTokenExpiration: new Date(Date.now() + 4 * 3600_000).toISOString(),
  accessTokenValid: true,
  refreshTokenExpiration: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
  refreshTokenValid: true,
  loginRequired: false,
}

export const ARCHIDEKT_SESSION_EXPIRED: ArchidektLoginStatus = {
  loggedIn: true,
  username: 'testuser',
  accessTokenExpiration: new Date(Date.now() - 4 * 3600_000).toISOString(),
  accessTokenValid: false,
  refreshTokenExpiration: new Date(Date.now() - 3600_000).toISOString(),
  refreshTokenValid: false,
  loginRequired: true,
}

export const MOCK_SYNC_DECKS: SyncableDeck[] = [
  {
    slug: 'winota-stax',
    name: 'Winota Stax',
    sourceId: '111',
    sourceUrl: 'https://archidekt.com/decks/111',
    lastSynced: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
  {
    slug: 'oops-all-soldiers',
    name: 'Oops All Soldiers',
    sourceId: '222',
    sourceUrl: 'https://archidekt.com/decks/222',
    lastSynced: null,
  },
]

/** Handles on the deck-sync mocks, for asserting and reshaping mid-test. */
export type DeckSyncMocks = {
  /** Change what the next `GET /api/deck-sync` returns (e.g. after a run). */
  setDecks: (decks: SyncableDeck[]) => void
  /** Change the Archidekt session the next status load reports (e.g. after signing in). */
  setArchidekt: (status: ArchidektLoginStatus) => void
  /** Decks the non-streaming run reports as holding unreadable lines. */
  setUnreadable: (decks: UnreadableDeck[]) => void
  /** How many times the page has loaded the deck list. */
  statusRequests: () => number
  /** Bodies posted to the non-streaming fallback endpoint. */
  postedRuns: () => unknown[]
}

/**
 * Mock the Sync Decks page endpoints: the deck/login listing, the SSE stream
 * (driven from the test via {@link emitStreamEvent}), and the non-streaming
 * POST fallback.
 */
export async function mockDeckSyncApi(
  page: Page,
  archidekt: ArchidektLoginStatus = ARCHIDEKT_LOGGED_IN,
  decks: SyncableDeck[] = MOCK_SYNC_DECKS,
): Promise<DeckSyncMocks> {
  let currentDecks = decks
  let currentArchidekt = archidekt
  let currentUnreadable: UnreadableDeck[] = []
  let statusCount = 0
  const posted: unknown[] = []

  await installMockEventSource(page)

  await fulfillJson(
    page,
    '**/api/deck-sync',
    () => {
      statusCount += 1
      return { success: true, decks: currentDecks, archidekt: currentArchidekt }
    },
    { method: 'GET' },
  )

  await fulfillJson(
    page,
    '**/api/deck-sync',
    (route: Route): DeckSyncRunResponse => {
      posted.push(route.request().postDataJSON())
      // Typed against the real response so the mock cannot drift from the handler.
      const summary: SyncSummary = {
        clauses: [apiMessage('admin.api.deckSync.pulled', { count: currentDecks.length })],
      }
      return {
        success: true,
        message: renderSyncSummaryEnglish(summary),
        summary,
        report: {
          direction: 'pull',
          decks: currentDecks.map((deck) => ({ name: deck.name, status: 'synced' })),
          failedCount: 0,
          unreadable: currentUnreadable,
        },
      }
    },
    { method: 'POST' },
  )

  return {
    setDecks: (next: SyncableDeck[]) => {
      currentDecks = next
    },
    setArchidekt: (next: ArchidektLoginStatus) => {
      currentArchidekt = next
    },
    setUnreadable: (next: UnreadableDeck[]) => {
      currentUnreadable = next
    },
    statusRequests: () => statusCount,
    postedRuns: () => posted,
  }
}

// ===== Collection sync mock data =====

export const MOCK_SYNC_COLLECTION_LISTS: CollectionSyncList[] = [
  // Slugs deliberately unlike the display names: a request scopes a run by slug,
  // so a page that sent the heading instead would still look right on screen.
  { slug: 'blue-binder', name: 'Blue Binder' },
  { slug: 'long-box', name: 'Long Box' },
]

/** The pull target the status reports, which no list answers to — as `Inbox` usually does not. */
export const MOCK_PULL_TARGET = 'Inbox'

/**
 * The CSV threshold the status reports — the engine's own, so the page's wording
 * is asserted against the number a real server would send.
 */
export const MOCK_CSV_THRESHOLD = CSV_UPLOAD_THRESHOLD

/** Handles on the collection-sync mocks, for asserting and reshaping mid-test. */
export type CollectionSyncMocks = {
  /** Change the lists the next `GET /api/collection-sync` reports. */
  setLists: (lists: CollectionSyncList[]) => void
  /** Change the Archidekt session the next status load reports (e.g. after signing in). */
  setArchidekt: (status: ArchidektLoginStatus) => void
  /** Change when the account last synced, e.g. to what a finished run would report. */
  setLastSynced: (iso: string | null) => void
  /** Lists the non-streaming run reports as holding unreadable lines. */
  setUnreadable: (lists: UnreadableList[]) => void
  /** Removals the non-streaming run reports as too ambiguous to place. */
  setAmbiguous: (removals: AmbiguousRemoval[]) => void
  /**
   * Run-level errors the non-streaming run reports. Empty is a run that applied
   * its changes; non-empty is one that stopped without writing, which is what
   * tells the page whether a reported ambiguity was placed or refused.
   */
  setErrors: (errors: string[]) => void
  /** What the non-streaming run reports the CSV import did with a push's new cards. */
  setCsv: (csv: CollectionSyncCsv | null) => void
  /** How many times the page has loaded the status. */
  statusRequests: () => number
  /** Bodies posted to the non-streaming fallback endpoint. */
  postedRuns: () => unknown[]
}

/**
 * Mock the Sync Collection page endpoints: the list/login/status read, the SSE
 * stream (driven from the test via {@link emitStreamEvent}), and the
 * non-streaming POST fallback.
 */
export async function mockCollectionSyncApi(
  page: Page,
  archidekt: ArchidektLoginStatus = ARCHIDEKT_LOGGED_IN,
  lists: CollectionSyncList[] = MOCK_SYNC_COLLECTION_LISTS,
  pullTarget: string = MOCK_PULL_TARGET,
): Promise<CollectionSyncMocks> {
  let currentLists = lists
  let currentArchidekt = archidekt
  let currentLastSynced: string | null = new Date(Date.now() - 3 * 3600_000).toISOString()
  let currentUnreadable: UnreadableList[] = []
  let currentAmbiguous: AmbiguousRemoval[] = []
  let currentErrors: string[] = []
  let currentCsv: CollectionSyncCsv | null = null
  let statusCount = 0
  const posted: unknown[] = []

  await installMockEventSource(page)

  await fulfillJson(
    page,
    '**/api/collection-sync',
    (): CollectionSyncStatusResponse => {
      statusCount += 1
      return {
        success: true,
        lists: currentLists,
        archidekt: currentArchidekt,
        lastSynced: currentLastSynced,
        pullTarget,
        csvThreshold: MOCK_CSV_THRESHOLD,
      }
    },
    { method: 'GET' },
  )

  await fulfillJson(
    page,
    '**/api/collection-sync',
    (route: Route): CollectionSyncRunResponse => {
      posted.push(route.request().postDataJSON())
      // Typed against the real response so the mock cannot drift from the handler.
      const results = currentLists.map(
        (list): CollectionSyncListResult => ({
          name: list.name,
          status: 'synced',
          added: 1,
          removed: 0,
          pending: 0,
        }),
      )
      const summary: SyncSummary = {
        clauses: [
          apiMessage('admin.api.collectionSync.totalsInto', {
            action: 'pulled',
            added: results.length,
            removed: 0,
            into: pullTarget,
          }),
        ],
      }
      return {
        success: true,
        message: renderSyncSummaryEnglish(summary),
        summary,
        report: {
          direction: 'pull',
          into: pullTarget,
          dryRun: false,
          lists: results,
          failedCount: 0,
          errors: currentErrors,
          unreadable: currentUnreadable,
          ambiguous: currentAmbiguous,
          localIncomplete: false,
          csv: currentCsv,
          totals: { added: results.length, removed: 0, skipped: 0, pending: 0 },
        },
      }
    },
    { method: 'POST' },
  )

  return {
    setLists: (next: CollectionSyncList[]) => {
      currentLists = next
    },
    setArchidekt: (next: ArchidektLoginStatus) => {
      currentArchidekt = next
    },
    setLastSynced: (next: string | null) => {
      currentLastSynced = next
    },
    setErrors: (next: string[]) => {
      currentErrors = next
    },
    setUnreadable: (next: UnreadableList[]) => {
      currentUnreadable = next
    },
    setAmbiguous: (next: AmbiguousRemoval[]) => {
      currentAmbiguous = next
    },
    setCsv: (next: CollectionSyncCsv | null) => {
      currentCsv = next
    },
    statusRequests: () => statusCount,
    postedRuns: () => posted,
  }
}

/**
 * Mock the wanted lists list API endpoint
 */
export async function mockWantedListsApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/wanted', { wantedLists: MOCK_WANTED_LISTS }, { method: 'GET' })
}

/**
 * Mock a wanted list load API endpoint
 */
export async function mockWantedListLoadApi(page: Page): Promise<void> {
  const body: WantedFullLoadResult = {
    success: true,
    view: 'full',
    entries: MOCK_WANTED_LIST_DETAIL.entries,
    cards: MOCK_WANTED_LIST_DETAIL.cards,
    printings: MOCK_WANTED_LIST_DETAIL.printings,
    symbolMap: {},
    slug: 'test-wanted-list',
    totalCount: MOCK_WANTED_LIST_DETAIL.entries.length,
    warnings: [],
  }
  await fulfillJson(page, '**/api/wanted/test-wanted-list', body, { method: 'GET' })
}

/**
 * Mock the admin API endpoint for loading a single collection with priced and unpriced cards.
 */
export async function mockAdminCollectionLoadApi(page: Page): Promise<void> {
  const body: CollectionFullLoadResult = {
    success: true,
    view: 'full',
    entries: MOCK_COLLECTION_DETAIL.entries,
    cards: MOCK_COLLECTION_DETAIL.cards,
    printings: MOCK_COLLECTION_DETAIL.printings,
    symbolMap: {},
    slug: 'test-collection',
    contentHash: 'abc123',
    totalCount: MOCK_COLLECTION_DETAIL.entries.length,
    warnings: [],
  }
  await fulfillJson(page, '**/api/collection/test-collection', body, { method: 'GET' })
}

// ===== Move Cards page mock data =====

const MOVE_BOLT_CARD = makeMockScryfallCard({
  id: 'move-bolt',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  mana_cost: '{R}',
  prices: { usd: '2.00' },
  finishes: ['nonfoil', 'foil'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  color_identity: ['R'],
  released_at: '1993-08-05',
})

const MOVE_LISTS: ListInfo[] = [
  { type: 'deck', slug: 'move-deck', name: 'Move Deck' },
  { type: 'collection', slug: 'move-binder', name: 'Move Binder' },
  { type: 'wanted', slug: 'move-wishlist', name: 'Move Wishlist' },
]

const MOVE_DATA = {
  success: true,
  lists: MOVE_LISTS,
  cards: [
    {
      key: 'collection:move-binder:1:0',
      listType: 'collection',
      listSlug: 'move-binder',
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      condition: 'NM',
      cardId: 1,
      copyIndex: 0,
    },
  ],
  warnings: [],
} satisfies CardIndexResponse

/**
 * Mock the admin Move Cards endpoints: the bulk `/api/card-index`, the per-list
 * load endpoints for the three synthetic lists, card printings (for moved-in
 * rendering), and the commit endpoint. `onCommit` receives the parsed POST body.
 */
export async function mockMoveCardsApi(
  page: Page,
  onCommit?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/card-index', MOVE_DATA)

  await fulfillJson(page, '**/api/move/commit', (route: Route) => {
    onCommit?.(route.request().postDataJSON())
    return {
      success: true,
      moved: 1,
      skipped: 0,
      ...apiMessage('admin.api.move.moved', { count: 1 }),
    }
  })

  const binder: CollectionFullLoadResult = {
    success: true,
    view: 'full',
    entries: [
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        condition: 'NM',
        section: 'Main',
        cardId: 1,
      },
    ],
    sectionOrder: ['Main'],
    cards: { 'lea:161': MOVE_BOLT_CARD, 'Lightning Bolt': MOVE_BOLT_CARD },
    printings: { 'Lightning Bolt': [MOVE_BOLT_CARD] },
    symbolMap: {},
    slug: 'move-binder',
    contentHash: 'move-binder-hash',
    totalCount: 1,
    warnings: [],
  }
  await fulfillJson(page, '**/api/collection/move-binder', binder)

  const deck: DeckFullLoadResult = {
    success: true,
    view: 'full',
    deck: { name: 'Move Deck', sections: [{ name: 'Main', cards: [] }] },
    cards: {},
    printings: {},
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: { name: 'Move Deck' },
    slug: 'move-deck',
    contentHash: 'move-deck-hash',
    totalCount: 0,
    warnings: [],
  }
  await fulfillJson(page, '**/api/deck/move-deck', deck)

  const wishlist: WantedFullLoadResult = {
    success: true,
    view: 'full',
    entries: [],
    sectionOrder: ['Main'],
    cards: {},
    printings: {},
    symbolMap: {},
    slug: 'move-wishlist',
    contentHash: 'move-wishlist-hash',
    totalCount: 0,
    warnings: [],
  }
  await fulfillJson(page, '**/api/wanted/move-wishlist', wishlist)

  await fulfillJson(page, '**/api/card-printings*', {
    success: true,
    printings: [MOVE_BOLT_CARD],
    complete: true,
  })
}

// ===== Change history mock data =====

const HISTORY_LISTS = {
  success: true,
  lists: [{ type: 'deck', slug: 'history-deck', name: 'History Deck' }],
}

const HISTORY_DETAIL = {
  success: true,
  header: '# Changelog for History Deck',
  // Returned newest-first by the real endpoint. The older set carries preserved
  // hand-written prose in `trailing`, so specs can pin its display + round trip.
  sets: [
    { timestamp: '2026-02-01T00:00:00.000Z', lines: ['- Added "Mana Crypt" &2'] },
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      lines: ['- Added "Sol Ring" (LEA:1) &1'],
      trailing: ['NOTE: the FNM tuning session.'],
    },
  ],
  defaultLines: ['- Added "Sol Ring" (LEA:1) &1', '- Added "Mana Crypt" &2'],
}

/**
 * Mock the change-history endpoints with a single deck holding two change sets.
 * `onSave` receives the POSTed `{ sets }` body so tests can assert what was saved.
 */
export async function mockChangeHistoryApi(
  page: Page,
  onSave?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/lists', HISTORY_LISTS)

  await fulfillJson(page, '**/api/history/deck/history-deck', HISTORY_DETAIL)

  await fulfillJson(page, '**/api/history/deck/history-deck/save', (route: Route) => {
    onSave?.(route.request().postDataJSON())
    return { success: true, ...apiMessage('admin.api.history.saved', { count: 1 }), setCount: 1 }
  })
}
