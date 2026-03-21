import type { Page, Route } from '@playwright/test'

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

const MOCK_DECKS: MockDeck[] = [
  { slug: 'test-deck', name: 'Test Deck' },
  { slug: 'another-deck', name: 'Another Deck' },
]

const MOCK_COLLECTIONS: MockCollection[] = [{ slug: 'test-collection', name: 'Test Collection' }]

const MOCK_AUTOCOMPLETE_RESULTS = [
  'Lightning Bolt',
  'Lightning Helix',
  'Lightning Strike',
  'Lightning Greaves',
]

const MOCK_SEARCH_RESULTS = [
  { name: 'Lightning Bolt' },
  { name: 'Lightning Helix' },
  { name: 'Lightning Strike' },
]

const MOCK_AUDIT_ENTRIES: AuditEntry[] = [
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

const MOCK_CONFIG = {
  decksDir: './decks',
  collectionsDir: './collections',
  gitEnabled: false,
  gitAutoCommit: false,
  rateLimitEnabled: true,
  rateLimitMaxAttempts: 5,
  rateLimitWindowMinutes: 15,
  failedAuthDelayMs: 1000,
  ipAllowList: [],
  ipDenyList: [],
  userAgentAllowList: [],
  userAgentDenyList: [],
}

/**
 * Set up route interception for admin API endpoints that hit external services.
 * This mocks card search, autocomplete, and other Scryfall-dependent endpoints.
 */
export async function mockAdminCardApis(page: Page): Promise<void> {
  await page.route('**/api/autocomplete*', async (route: Route) => {
    const url = new URL(route.request().url())
    const query = url.searchParams.get('q')?.toLowerCase() ?? ''
    const filtered = MOCK_AUTOCOMPLETE_RESULTS.filter((name) => name.toLowerCase().includes(query))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, names: filtered }),
    })
  })

  await page.route('**/api/search-cards', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, cards: MOCK_SEARCH_RESULTS }),
    })
  })

  await page.route('**/api/card-printings*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    })
  })

  await page.route('**/api/card-price*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        printings: [],
        representative: null,
        lowestPriceCard: null,
        lowestPriceCardEur: null,
        lowestPriceCardTix: null,
      }),
    })
  })
}

/**
 * Mock the decks list API endpoint
 */
export async function mockDecksApi(page: Page): Promise<void> {
  await page.route('**/api/decks', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ decks: MOCK_DECKS }),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Mock the collections list API endpoint
 */
export async function mockCollectionsApi(page: Page): Promise<void> {
  await page.route('**/api/collections', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ collections: MOCK_COLLECTIONS }),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Mock the audit log API endpoint
 */
export async function mockAuditLogApi(page: Page): Promise<void> {
  await page.route('**/api/audit-log*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, entries: MOCK_AUDIT_ENTRIES }),
    })
  })
}

/**
 * Mock the config API endpoints
 */
export async function mockConfigApi(page: Page): Promise<void> {
  await page.route('**/api/config', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, config: MOCK_CONFIG }),
      })
    } else if (route.request().method() === 'PUT') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, config: MOCK_CONFIG }),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Mock the build-site API endpoint
 */
export async function mockBuildSiteApi(page: Page): Promise<void> {
  await page.route('**/api/build-site', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Site built successfully' }),
    })
  })
}

/**
 * Mock the import-deck API endpoint
 */
export async function mockImportDeckApi(page: Page): Promise<void> {
  await page.route('**/api/import-deck', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Deck imported', deckName: 'Imported Deck' }),
    })
  })
}

/**
 * Mock the TOTP status endpoint
 */
export async function mockTotpApi(page: Page): Promise<void> {
  await page.route('**/api/totp/status', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: false }),
    })
  })
}

/**
 * Mock the cache refresh SSE stream
 */
export async function mockCacheRefreshApi(page: Page): Promise<void> {
  await page.route('**/api/cache/refresh/stream', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'data: {"stage":"downloading","percentage":50,"message":"Downloading..."}',
        '',
        'data: {"stage":"parsing","percentage":100,"message":"Parsing..."}',
        '',
        'data: {"stage":"processing","percentage":100,"message":"Processing..."}',
        '',
        'data: {"stage":"saving","percentage":100,"message":"Saving..."}',
        '',
        'data: {"message":"Cache refreshed successfully"}',
        '',
      ].join('\n'),
    })
  })

  await page.route('**/api/cache/refresh', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Cache refreshed successfully' }),
      })
    } else {
      await route.continue()
    }
  })
}

const MOCK_SCRYFALL_CARD = {
  id: 'test-card-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  oracle_text: 'Test oracle text.',
  image_uris: {
    small: '',
    normal: '',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: { usd: '1.00', usd_foil: null, usd_etched: null, eur: '0.80', eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '1',
  rarity: 'common',
  color_identity: [],
}

const MOCK_DECK_WITH_CHANGELOG = {
  deck: {
    name: 'Test Changelog Deck',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Test Creature', set: 'tst', collectorNumber: '1' }],
      },
    ],
  },
  cards: { 'Test Creature': MOCK_SCRYFALL_CARD },
  printings: { 'Test Creature': [MOCK_SCRYFALL_CARD] },
  symbolMap: {},
  exportPath: 'decks/test-changelog-deck.txt',
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  changelog: [
    {
      timestamp: '2025-01-15T10:00:00.000Z',
      changes: [
        { action: 'Added', cardName: 'Test Creature', set: 'tst', collectorNumber: '1' },
        { action: 'Removed', cardName: 'Old Card' },
      ],
    },
    {
      timestamp: '2025-01-10T08:00:00.000Z',
      changes: [{ action: 'Added', cardName: 'Old Card' }],
    },
  ],
}

const MOCK_SITE_INDEX_WITH_CHANGELOG_DECK = {
  decks: [
    {
      slug: 'test-changelog-deck',
      name: 'Test Changelog Deck',
      featuredCardImage: '',
      commander: null,
      cardCount: 1,
    },
  ],
  collections: [],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic deck that has a changelog.
 * Intercepts index.json and the deck JSON for 'test-changelog-deck'.
 */
export async function mockPublicSiteDeckWithChangelog(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_CHANGELOG_DECK),
    })
  })

  await page.route('**/decks/test-changelog-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DECK_WITH_CHANGELOG),
    })
  })
}

const MOCK_WANTED_LISTS = [{ slug: 'test-wanted-list', name: 'Test Wanted List' }]

const MOCK_WANTED_LIST_CARD_BOLT = {
  id: 'bolt-id',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  mana_cost: '{R}',
  image_uris: {
    small: '',
    normal: '',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: {
    usd: '2.00',
    usd_foil: '5.00',
    usd_etched: null,
    eur: '1.50',
    eur_foil: '4.00',
    tix: '0.10',
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'a25',
  set_name: 'Masters 25',
  collector_number: '141',
  rarity: 'uncommon',
  color_identity: ['R'],
}

const MOCK_WANTED_LIST_CARD_SOL = {
  id: 'sol-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  mana_cost: '{1}',
  image_uris: {
    small: '',
    normal: '',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: {
    usd: '3.00',
    usd_foil: '8.00',
    usd_etched: null,
    eur: '2.50',
    eur_foil: '7.00',
    tix: null,
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'c19',
  set_name: 'Commander 2019',
  collector_number: '221',
  rarity: 'uncommon',
  color_identity: [],
}

const MOCK_WANTED_LIST_CARD_CRYPT = {
  id: 'crypt-id',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: 'At the beginning of your upkeep, flip a coin...',
  mana_cost: '{0}',
  image_uris: {
    small: '',
    normal: '',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: {
    usd: '150.00',
    usd_foil: '200.00',
    usd_etched: null,
    eur: '130.00',
    eur_foil: '180.00',
    tix: '5.00',
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  color_identity: [],
}

const MOCK_WANTED_LIST_DETAIL = {
  name: 'Test Wanted List',
  entries: [
    { name: 'Lightning Bolt', price: 2.0, fileOrder: 0, state: 'name-only' },
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      price: 3.0,
      fileOrder: 1,
      state: 'printing',
    },
    {
      name: 'Mana Crypt',
      set: '2xm',
      collectorNumber: '270',
      finish: 'foil',
      price: 200.0,
      fileOrder: 2,
      state: 'fully-specified',
    },
  ],
  cards: {
    'Lightning Bolt': MOCK_WANTED_LIST_CARD_BOLT,
    'Sol Ring': MOCK_WANTED_LIST_CARD_SOL,
    'Mana Crypt': MOCK_WANTED_LIST_CARD_CRYPT,
    'c19:221': MOCK_WANTED_LIST_CARD_SOL,
    '2xm:270': MOCK_WANTED_LIST_CARD_CRYPT,
  },
  printings: {
    'Lightning Bolt': [MOCK_WANTED_LIST_CARD_BOLT],
    'Sol Ring': [MOCK_WANTED_LIST_CARD_SOL],
    'Mana Crypt': [MOCK_WANTED_LIST_CARD_CRYPT],
  },
  symbolMap: {},
  useScryfallImgUrls: true,
  totalPrice: 205.0,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_SITE_INDEX_WITH_WANTED_LIST = {
  decks: [],
  collections: [],
  wantedLists: [
    {
      slug: 'test-wanted-list',
      name: 'Test Wanted List',
      featuredCardImage: '',
      cardCount: 3,
      totalPrice: 205.0,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic wanted list.
 */
export async function mockPublicSiteWantedList(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_WANTED_LIST),
    })
  })

  await page.route('**/wanted/test-wanted-list.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_WANTED_LIST_DETAIL),
    })
  })
}

/**
 * Mock the wanted lists list API endpoint
 */
export async function mockWantedListsApi(page: Page): Promise<void> {
  await page.route('**/api/wanted', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ wantedLists: MOCK_WANTED_LISTS }),
      })
    } else {
      await route.continue()
    }
  })
}

/**
 * Mock a wanted list load API endpoint
 */
export async function mockWantedListLoadApi(page: Page): Promise<void> {
  await page.route('**/api/wanted/test-wanted-list', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          entries: MOCK_WANTED_LIST_DETAIL.entries,
          cards: MOCK_WANTED_LIST_DETAIL.cards,
          printings: MOCK_WANTED_LIST_DETAIL.printings,
          symbolMap: {},
          slug: 'test-wanted-list',
        }),
      })
    } else {
      await route.continue()
    }
  })
}

export {
  MOCK_DECKS,
  MOCK_COLLECTIONS,
  MOCK_WANTED_LISTS,
  MOCK_AUTOCOMPLETE_RESULTS,
  MOCK_SEARCH_RESULTS,
  MOCK_AUDIT_ENTRIES,
  MOCK_CONFIG,
}
