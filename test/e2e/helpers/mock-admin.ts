import type { Page, Route } from '@playwright/test'
import type { SyncEvent, UnreadableSource } from '../../../src/sync/common'
import type { ImportCsvRequest, ImportCsvResponse } from '../../../src/admin/api/import-csv'
import type { CsvRowFailure } from '../../../src/importers/csv'
import type { MoveCommitResponse } from '../../../src/admin/api/move'
import {
  syncList,
  syncMessage,
  syncRef,
  syncSize,
  type SyncMessage,
} from '../../../src/sync/message'
import type { CacheRefreshEvent } from '../../../src/scryfall/progress'
import { AUDIT_REASONS } from '../../../src/admin/audit-reasons'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'
import type { DeckSyncRunResponse } from '../../../src/admin/api/deck-sync'
import type {
  CollectionSyncList,
  CollectionSyncRequest,
  CollectionSyncRunResponse,
  CollectionSyncStatusResponse,
} from '../../../src/admin/api/collection-sync'
import type {
  DeckSyncCardChange,
  SyncableDeck,
  UnreadableDeck,
} from '../../../src/deck-sync/engine'
import type {
  CollectionSyncCardChange,
  CollectionSyncCardRemoved,
  CollectionSyncCsv,
  CollectionSyncListResult,
  UnreadableList,
} from '../../../src/collection-sync/engine'
import { CSV_UPLOAD_THRESHOLD } from '../../../src/collection-sync/csv'
import type { AmbiguousRemoval } from '../../../src/collection-sync/describe'
import type { CardIndexResponse } from '../../../src/admin/api/card-index'
import type { StatusResponse } from '../../../src/admin/api/status'
import type { SellRefreshResponse } from '../../../src/admin/api/sell'
import { apiMessage } from '../../../src/api/result'
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
import type { ListInfo } from '../../../src/list/list-info'
import type { RitualConfig } from '../../../src/config/ritual-config'
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../src/config/search-debounce'
import { fulfillJson } from './fulfill'
import { MOCK_COLLECTION_DETAIL, MOCK_WANTED_LIST_DETAIL, makeMockScryfallCard } from './mock-cards'
import { localeTag } from '../../../src/i18n/locale-tag'
import { EXAMPLE_SOURCE_OFFER } from '../../helpers/source-offer'

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
    reason: AUDIT_REASONS.loginSucceeded,
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
  artDir: './art',
  defaultPriceSource: 'cardmarket',
  defaultLanguage: 'en',
  uiLocale: localeTag('en'),
  cacheLockTimeoutSeconds: 300,
  cacheSource: 'scryfall',
  searchDebounceMs: DEFAULT_SEARCH_DEBOUNCE_MS,
  updateCheck: true,
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
  priceSources: ['tcgplayer', 'cardmarket'],
  defaultCategories: ['Ramp', 'Draw', 'Removal'],
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
 * Mock the build-site stream, plus the POST fallback endpoint the page retries
 * over when the stream never connects. Events are driven from the test via
 * {@link emitStreamEvent}.
 */
export type BuildSiteMocks = {
  /** How many times the plain `POST /api/build-site` fallback was issued. */
  postedBuilds: () => number
}

export async function mockBuildSiteApi(page: Page): Promise<BuildSiteMocks> {
  await installMockEventSource(page)
  let posted = 0
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
  await fulfillJson(
    page,
    '**/api/build-site',
    () => {
      posted++
      return body
    },
    { method: 'POST' },
  )
  return { postedBuilds: () => posted }
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
    const body = route.request().postDataJSON() as { name?: string } | null
    onRequest?.(body)
    // Keyed and nested like the route's own summary, naming what the page sent,
    // so the page's keyed path (not only its English fallback) is observable.
    const deckName = body?.name ?? 'Imported Deck'
    return {
      success: true,
      ...syncMessage('admin.api.importDeck.imported', {
        name: deckName,
        notes: syncList([], 'concat'),
      }),
      deckName,
    }
  })
}

/**
 * Mock the import-csv API endpoint. Pass `onRequest` to capture the parsed
 * request body, `failures` to simulate rows that failed to import and `warnings`
 * for the route's non-fatal notices — both built with the importer's own
 * message builders, so the page's keyed path is the one exercised.
 */
export async function mockImportCsvApi(
  page: Page,
  onRequest?: (body: unknown) => void,
  failures?: CsvRowFailure[],
  warnings?: SyncMessage[],
): Promise<void> {
  await fulfillJson(page, '**/api/import-csv', (route: Route) => {
    const body = route.request().postDataJSON() as ImportCsvRequest
    onRequest?.(body)
    // `failures`/`failedCount` are always present on the real response: a
    // partially-failed import is a success whose per-row report is the point.
    // `warnings` likewise — the non-fatal channel (a refused category value, a
    // categories sidecar that could not be written) is always an array.
    const rows = failures ?? []
    const response: ImportCsvResponse = {
      success: true,
      // Keyed and nested like the route's own summary, naming what the page
      // sent, so the page's keyed path is observable.
      ...syncMessage(
        body.mode === 'append' ? 'admin.api.importCsv.appended' : 'admin.api.importCsv.imported',
        {
          listType: body.listType,
          cards: syncRef('domain.count.cards', { count: 3 }),
          name: body.name,
        },
      ),
      cardCount: 3,
      failures: rows,
      failedCount: rows.length,
      warnings: warnings ?? [],
    }
    return response
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
      ...bundleImportMessage(result),
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

/** A logged-in server's `GET /api/status`, offering sell mode or not. */
export function mockStatusResponse(sellMode = false): StatusResponse {
  return {
    ok: true,
    setupRequired: false,
    totpEnabled: false,
    sellMode,
    about: EXAMPLE_SOURCE_OFFER,
  }
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
  await fulfillJson(page, '**/api/status', () => mockStatusResponse(sellMode))
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

/** A sync stream's `unreadable-lines` frame. */
export type UnreadableLinesFrame = Extract<SyncEvent<unknown>, { kind: 'unreadable-lines' }>

/**
 * A sync stream's `unreadable-lines` frame, typed so each warning has to be a
 * message (English plus its key), as the engines send it — never a bare string.
 */
export function unreadableLinesFrame(items: UnreadableSource[]): UnreadableLinesFrame {
  return { kind: 'unreadable-lines', items }
}

/** The warning a deck or list parser records for a line it skipped, as the engines send it. */
export function skippedLineWarning(line: string): SyncMessage {
  return syncMessage('domain.import.text.malformedLine', { line })
}

/**
 * Dispatch one named SSE event on the mock EventSource installed by
 * {@link installMockEventSource}. The page must have constructed it already
 * (i.e. the action that opens the stream was clicked).
 */
export async function emitStreamEvent(
  page: Page,
  event: string,
  // `object`, not a string-keyed record: an event payload is often an
  // interface (`CacheRefreshEvent`), which has no index signature.
  data: object,
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
 * One `progress` frame of the cache refresh stream, exactly as the route sends
 * it: the engine's stage (and percentage), plus the line as English with its
 * key and params.
 */
export function cacheRefreshProgressFrame(
  stage: CacheRefreshEvent['stage'],
  line: SyncMessage,
  percentage?: number,
): CacheRefreshEvent {
  return percentage === undefined ? { stage, ...line } : { stage, percentage, ...line }
}

/** The download frame the cache refresh specs share: half of 72.50 MiB in. */
export function cacheRefreshDownloadFrame(): CacheRefreshEvent {
  return cacheRefreshProgressFrame(
    'download',
    syncMessage('domain.cache.refresh.processing', {
      percentage: 50,
      received: syncSize(38_010_880),
      total: syncSize(76_021_760),
    }),
    50,
  )
}

/** What {@link mockCacheRefreshApi} lets a test observe: how many fallback POSTs were sent. */
export type CacheRefreshMocks = { postedRefreshes: () => number }

/**
 * Mock the cache refresh SSE stream, plus the POST fallback endpoint. Events are
 * driven from the test via {@link emitStreamEvent}; `postedRefreshes` counts the
 * fallback POSTs, so a test can prove a dropped stream did not start a second
 * refresh.
 */
export async function mockCacheRefreshApi(page: Page): Promise<CacheRefreshMocks> {
  await installMockEventSource(page)
  let posted = 0
  await fulfillJson(
    page,
    '**/api/cache/refresh',
    () => {
      posted++
      return { success: true, ...apiMessage('admin.api.cache.refreshed') }
    },
    { method: 'POST' },
  )
  return { postedRefreshes: () => posted }
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
      : { success: false, message: 'No Card Kingdom buylist has been downloaded yet.' },
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
  /** The card changes the non-streaming run reports for a deck, by deck name. */
  setDeckChanges: (changes: Record<string, DeckSyncCardChange[]>) => void
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
  let currentChanges: Record<string, DeckSyncCardChange[]> = {}
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
          decks: currentDecks.map((deck) => {
            const changes = currentChanges[deck.name]
            return {
              name: deck.name,
              status: 'synced',
              outcome: 'changed',
              ...(changes ? { changes } : {}),
            }
          }),
          failedCount: 0,
          unreadable: currentUnreadable,
          cancelled: false,
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
    setDeckChanges: (next: Record<string, DeckSyncCardChange[]>) => {
      currentChanges = next
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
  /**
   * The card changes the non-streaming run reports for a list, by list name.
   * The list's counts stay the mock's fixed `added: 1` — the page renders the
   * count line from the changes, never from those fields.
   */
  setListChanges: (changes: Record<string, CollectionSyncCardChange[]>) => void
  /** A push's removals of cards no list holds, as the non-streaming run reports them. */
  setUnlisted: (changes: CollectionSyncCardRemoved[]) => void
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
  let currentChanges: Record<string, CollectionSyncCardChange[]> = {}
  let currentUnlisted: CollectionSyncCardRemoved[] = []
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
      const request = route.request().postDataJSON() as CollectionSyncRequest
      posted.push(request)
      // Echoes the run it was asked for: a push has nowhere to put cards.
      const direction = request.direction
      const into = direction === 'push' ? null : pullTarget
      // Typed against the real response so the mock cannot drift from the handler.
      const results = currentLists.map((list): CollectionSyncListResult => {
        const changes = currentChanges[list.name]
        return {
          name: list.name,
          status: 'synced',
          outcome: 'changed',
          added: 1,
          removed: 0,
          pending: 0,
          ...(changes ? { changes } : {}),
        }
      })
      const action = direction === 'push' ? 'pushed' : 'pulled'
      const summary: SyncSummary = {
        clauses: [
          into === null
            ? apiMessage('admin.api.collectionSync.totals', {
                action,
                added: results.length,
                removed: 0,
              })
            : apiMessage('admin.api.collectionSync.totalsInto', {
                action,
                added: results.length,
                removed: 0,
                into,
              }),
        ],
      }
      return {
        success: true,
        message: renderSyncSummaryEnglish(summary),
        summary,
        report: {
          direction,
          into,
          dryRun: false,
          lists: results,
          failedCount: 0,
          errors: currentErrors,
          errorMessages: currentErrors.map((message) => ({ message })),
          unreadable: currentUnreadable,
          cancelled: false,
          // As the engine reports it: a run that stopped on the ambiguity it found.
          unresolvedAmbiguity: currentAmbiguous.length > 0 && currentErrors.length > 0,
          ambiguous: currentAmbiguous,
          localIncomplete: false,
          csv: currentCsv,
          totals: { added: results.length, removed: 0, skipped: 0, pending: 0 },
          ...(currentUnlisted.length > 0 ? { unlisted: currentUnlisted } : {}),
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
    setListChanges: (next: Record<string, CollectionSyncCardChange[]>) => {
      currentChanges = next
    },
    setUnlisted: (next: CollectionSyncCardRemoved[]) => {
      currentUnlisted = next
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
    description: MOCK_WANTED_LIST_DETAIL.description,
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
    entries: MOCK_COLLECTION_DETAIL.entries.map((entry) => ({ ...entry, effectiveLabels: [] })),
    description: MOCK_COLLECTION_DETAIL.description,
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

/**
 * A deck card held with no printing, in two copies. Moving it into a collection
 * has to ask for a printing (collections require one) and then for a copy count
 * — the one flow where both prompts run back to back.
 */
const MOVE_GROWTH_PRINTINGS = ['tst', 'pln'].map((set) =>
  makeMockScryfallCard({
    id: `move-growth-${set}`,
    name: 'Giant Growth',
    cmc: 1,
    type_line: 'Instant',
    mana_cost: '{G}',
    prices: { usd: '0.25' },
    set,
    set_name: set === 'tst' ? 'Test Set' : 'Plane Set',
    collector_number: '7',
    color_identity: ['G'],
  }),
)

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
    // Both physical copies of the deck's one printing-less Giant Growth entry.
    ...[0, 1].map((copyIndex) => ({
      key: `deck:move-deck:5:${copyIndex}`,
      listType: 'deck' as const,
      listSlug: 'move-deck',
      name: 'Giant Growth',
      cardId: 5,
      copyIndex,
    })),
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
    const body = route.request().postDataJSON()
    onCommit?.(body)
    // Echo the requested count rather than a hardcoded 1: a multi-copy commit
    // would otherwise get a response that contradicts what it sent.
    const moved = Array.isArray(body?.moves) ? body.moves.length : 0
    const response: MoveCommitResponse = {
      success: true,
      moved,
      requested: moved,
      skipped: 0,
      droppedNotes: [],
      warnings: [],
      ...apiMessage('admin.api.move.moved', { count: moved }),
    }
    return response
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
        effectiveLabels: [],
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
    deck: {
      name: 'Move Deck',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 2, name: 'Giant Growth', cardId: 5, effectiveLabels: [] }],
        },
      ],
    },
    cards: { 'Giant Growth': MOVE_GROWTH_PRINTINGS[0]! },
    printings: { 'Giant Growth': MOVE_GROWTH_PRINTINGS },
    lowestPriceCards: {},
    lowestPriceCardsEur: {},
    lowestPriceCardsTix: {},
    symbolMap: {},
    frontMatter: {},
    slug: 'move-deck',
    contentHash: 'move-deck-hash',
    totalCount: 2,
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

  await fulfillJson(page, '**/api/card-printings*', (route: Route) => ({
    success: true,
    printings:
      new URL(route.request().url()).searchParams.get('name') === 'Giant Growth'
        ? MOVE_GROWTH_PRINTINGS
        : [MOVE_BOLT_CARD],
    complete: true,
  }))
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
    {
      timestamp: '2026-02-01T00:00:00.000Z',
      lines: ['- Added "Mana Crypt" &2'],
      events: [
        { id: '2026-02-01#0', timestamp: 0, action: 'add', cardName: 'Mana Crypt', cardId: 2 },
      ],
    },
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      lines: ['- Added "Sol Ring" (LEA:1) &1'],
      events: [
        {
          id: '2026-01-01#0',
          timestamp: 0,
          action: 'add',
          cardName: 'Sol Ring',
          cardId: 1,
          set: 'lea',
          collectorNumber: '1',
        },
      ],
      trailing: ['NOTE: the FNM tuning session.'],
    },
  ],
  defaultEvents: [
    {
      id: 'd0',
      timestamp: 0,
      action: 'add',
      cardName: 'Sol Ring',
      cardId: 1,
      set: 'lea',
      collectorNumber: '1',
    },
    { id: 'd1', timestamp: 0, action: 'add', cardName: 'Mana Crypt', cardId: 2 },
  ],
}

/** Options for {@link mockChangeHistoryApi}. */
export type MockChangeHistoryOptions = {
  /**
   * Make the older set a legacy (block-less) one: prose lines but no events.
   * It cannot combine with the modern set, so the Combine dialog is empty.
   */
  legacyOlderSet?: boolean
}

/**
 * Mock the change-history endpoints with a single deck holding two change sets.
 * `onSave` receives the POSTed `{ sets }` body so tests can assert what was saved.
 */
export async function mockChangeHistoryApi(
  page: Page,
  onSave?: (body: unknown) => void,
  { legacyOlderSet = false }: MockChangeHistoryOptions = {},
): Promise<void> {
  await fulfillJson(page, '**/api/lists', HISTORY_LISTS)

  const detail = legacyOlderSet
    ? {
        ...HISTORY_DETAIL,
        sets: [HISTORY_DETAIL.sets[0], { ...HISTORY_DETAIL.sets[1], events: [] }],
      }
    : HISTORY_DETAIL
  await fulfillJson(page, '**/api/history/deck/history-deck', detail)

  await fulfillJson(page, '**/api/history/deck/history-deck/save', (route: Route) => {
    onSave?.(route.request().postDataJSON())
    return { success: true, ...apiMessage('admin.api.history.saved', { count: 1 }), setCount: 1 }
  })
}
