import type { Page, Route } from '@playwright/test'
import type { RitualConfig } from '../../../src/ritual-config'
import { fulfillJson } from './fulfill'
import { MOCK_COLLECTION_DETAIL, MOCK_WANTED_LIST_DETAIL, makeMockScryfallCard } from './mock-cards'

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

export const MOCK_AUTOCOMPLETE_RESULTS = [
  'Lightning Bolt',
  'Lightning Helix',
  'Lightning Strike',
  'Lightning Greaves',
]

export const MOCK_SEARCH_RESULTS = [
  { name: 'Lightning Bolt' },
  { name: 'Lightning Helix' },
  { name: 'Lightning Strike' },
]

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
  cacheLockTimeoutSeconds: 300,
  cacheSource: 'scryfall',
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
} satisfies RitualConfig

/**
 * Set up route interception for admin API endpoints that hit external services.
 * This mocks card search, autocomplete, and other Scryfall-dependent endpoints.
 */
export async function mockAdminCardApis(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/autocomplete*', (route: Route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('q')?.toLowerCase() ?? ''
    const filtered = MOCK_AUTOCOMPLETE_RESULTS.filter((name) => name.toLowerCase().includes(query))
    return { success: true, names: filtered }
  })

  await fulfillJson(page, '**/api/search-cards', { success: true, cards: MOCK_SEARCH_RESULTS })

  await fulfillJson(page, '**/api/card-printings*', {
    success: true,
    printings: [
      {
        name: 'Lightning Bolt',
        set: 'A25',
        collector_number: '141',
        image_uris: { normal: 'https://via.placeholder.com/200x280?text=LightningBolt' },
        prices: { usd: '1.50', eur: '1.20', tix: '0.05' },
      },
    ],
  })

  await fulfillJson(page, '**/api/card-price*', {
    success: true,
    printings: [],
    representative: null,
    lowestPriceCard: null,
    lowestPriceCardEur: null,
    lowestPriceCardTix: null,
  })
}

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
 * Mock the config API endpoints
 */
export async function mockConfigApi(page: Page): Promise<void> {
  await fulfillJson(
    page,
    '**/api/config',
    { success: true, config: MOCK_CONFIG },
    { method: 'GET' },
  )
  await fulfillJson(
    page,
    '**/api/config',
    { success: true, config: MOCK_CONFIG },
    { method: 'PUT' },
  )
}

/**
 * Mock the build-site API endpoint
 */
export async function mockBuildSiteApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/build-site', {
    success: true,
    message: 'Site built successfully',
  })
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
    return { success: true, message: 'Imported 3 card(s)', cardCount: 3, failures }
  })
}

/** One list's outcome in a mocked import-changes response. */
type MockImportChangesListResult = {
  kind: string
  slug: string
  name: string
  applied: number
  conflicts: { change: Record<string, unknown>; reason: string }[]
  error?: string
}

/**
 * Mock the import-changes API endpoint. Pass `onRequest` to capture the parsed
 * request body, and `lists` to control the per-list outcomes reported back.
 */
export async function mockImportChangesApi(
  page: Page,
  lists: MockImportChangesListResult[],
  onRequest?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/import-changes', (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    const success = lists.every((l) => l.error === undefined)
    const applied = lists.reduce((sum, l) => sum + l.applied, 0)
    return {
      success,
      lists,
      message: success
        ? `Applied ${applied} changes across ${lists.length} lists`
        : `Applied ${applied} changes; some lists failed`,
    }
  })
}

/**
 * Mock the TOTP status endpoint
 */
export async function mockTotpApi(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/totp/status', { enabled: false })
}

/**
 * The browser `window` as the cache-refresh mocks see it: `EventSource` is
 * replaceable, and the installed mock instance is stashed for later dispatch.
 */
type MockEventSourceWindow = Window & { EventSource: unknown; __mockEventSource?: EventTarget }

/**
 * Mock the cache refresh SSE stream by replacing the page's `EventSource` with
 * a controllable stand-in. A route-fulfilled SSE body delivers every event in
 * one burst, unmounting the progress UI before assertions can observe it —
 * tests instead drive each stage explicitly via {@link emitCacheRefreshEvent}.
 * Also stubs the POST fallback endpoint for completeness.
 */
export async function mockCacheRefreshApi(page: Page): Promise<void> {
  await page.evaluate(() => {
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
  })

  await fulfillJson(
    page,
    '**/api/cache/refresh',
    { success: true, message: 'Cache refreshed successfully' },
    { method: 'POST' },
  )
}

/**
 * Dispatch one named SSE event on the mock EventSource installed by
 * {@link mockCacheRefreshApi}. The page must have constructed it already
 * (i.e. the refresh button was clicked).
 */
export async function emitCacheRefreshEvent(
  page: Page,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([eventName, payload]) => {
      const es = (window as unknown as MockEventSourceWindow).__mockEventSource
      if (!es) throw new Error('Mock EventSource not constructed yet — click Refresh Cache first')
      es.dispatchEvent(new MessageEvent(eventName, { data: payload }))
    },
    [event, JSON.stringify(data)] as const,
  )
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
  await fulfillJson(
    page,
    '**/api/wanted/test-wanted-list',
    {
      success: true,
      entries: MOCK_WANTED_LIST_DETAIL.entries,
      cards: MOCK_WANTED_LIST_DETAIL.cards,
      printings: MOCK_WANTED_LIST_DETAIL.printings,
      symbolMap: {},
      slug: 'test-wanted-list',
    },
    { method: 'GET' },
  )
}

/**
 * Mock the admin API endpoint for loading a single collection with priced and unpriced cards.
 */
export async function mockAdminCollectionLoadApi(page: Page): Promise<void> {
  await fulfillJson(
    page,
    '**/api/collection/test-collection',
    {
      success: true,
      entries: MOCK_COLLECTION_DETAIL.entries,
      cards: MOCK_COLLECTION_DETAIL.cards,
      printings: MOCK_COLLECTION_DETAIL.printings,
      symbolMap: {},
      slug: 'test-collection',
      contentHash: 'abc123',
    },
    { method: 'GET' },
  )
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

const MOVE_LISTS = [
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
}

/**
 * Mock the admin Move Cards endpoints: the bulk `/api/move` index, the per-list
 * load endpoints for the three synthetic lists, card printings (for moved-in
 * rendering), and the commit endpoint. `onCommit` receives the parsed POST body.
 */
export async function mockMoveCardsApi(
  page: Page,
  onCommit?: (body: unknown) => void,
): Promise<void> {
  await fulfillJson(page, '**/api/move', MOVE_DATA)

  await fulfillJson(page, '**/api/move/commit', (route: Route) => {
    onCommit?.(route.request().postDataJSON())
    return { success: true, moved: 1, skipped: 0, message: 'Moved 1 card.' }
  })

  await fulfillJson(page, '**/api/collection/move-binder', {
    success: true,
    entries: [
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        condition: 'NM',
        price: 2,
        fileOrder: 0,
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
  })

  await fulfillJson(page, '**/api/deck/move-deck', {
    success: true,
    deck: { name: 'Move Deck', sections: [{ name: 'Main', cards: [] }] },
    cards: {},
    printings: {},
    symbolMap: {},
    frontMatter: { name: 'Move Deck' },
    slug: 'move-deck',
    contentHash: 'move-deck-hash',
  })

  await fulfillJson(page, '**/api/wanted/move-wishlist', {
    success: true,
    entries: [],
    sectionOrder: ['Main'],
    cards: {},
    printings: {},
    symbolMap: {},
    slug: 'move-wishlist',
    contentHash: 'move-wishlist-hash',
  })

  await fulfillJson(page, '**/api/card-printings*', {
    success: true,
    printings: [MOVE_BOLT_CARD],
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
  // Returned newest-first by the real endpoint.
  sets: [
    { timestamp: '2026-02-01T00:00:00.000Z', lines: ['- Added "Mana Crypt" &2'] },
    { timestamp: '2026-01-01T00:00:00.000Z', lines: ['- Added "Sol Ring" (LEA:1) &1'] },
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
  await fulfillJson(page, '**/api/history', HISTORY_LISTS)

  await fulfillJson(page, '**/api/history/deck/history-deck', HISTORY_DETAIL)

  await fulfillJson(page, '**/api/history/deck/history-deck/save', (route: Route) => {
    onSave?.(route.request().postDataJSON())
    return { success: true, message: 'Saved.', setCount: 1 }
  })
}
