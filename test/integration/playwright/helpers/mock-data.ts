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

const LONG_DESCRIPTION =
  'This is a test deck with a long description that exceeds the 200-character truncation ' +
  'threshold used by the ExpandableText component. It contains enough text to ensure the ' +
  'Read more and Show less buttons appear and function correctly when toggling.'

const MOCK_DECK_WITH_DESCRIPTION = {
  deck: {
    name: 'Test Description Deck',
    description: LONG_DESCRIPTION,
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
  exportPath: 'decks/test-description-deck.txt',
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_SITE_INDEX_WITH_DESCRIPTION_DECK = {
  decks: [
    {
      slug: 'test-description-deck',
      name: 'Test Description Deck',
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
 * Mock the public site JSON endpoints with a synthetic deck that has a long description.
 * Intercepts index.json and the deck JSON for 'test-description-deck'.
 */
export async function mockPublicSiteDeckWithDescription(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_DESCRIPTION_DECK),
    })
  })

  await page.route('**/decks/test-description-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DECK_WITH_DESCRIPTION),
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

const MOCK_SCRYFALL_CREATURE = {
  id: 'creature-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  oracle_text: '',
  mana_cost: '{1}{W}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '1.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '1',
  rarity: 'common',
  color_identity: ['W'],
  edhrec_rank: 1000,
}

const MOCK_SCRYFALL_CREATURE_B = {
  id: 'creature-b-id',
  name: 'Alpha Creature',
  cmc: 3,
  type_line: 'Creature — Beast',
  oracle_text: '',
  mana_cost: '{2}{G}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '0.75', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '4',
  rarity: 'common',
  color_identity: ['G'],
  edhrec_rank: 1500,
}

const MOCK_SCRYFALL_INSTANT = {
  id: 'instant-id',
  name: 'Test Instant',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: '',
  mana_cost: '{R}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '0.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '2',
  rarity: 'common',
  color_identity: ['R'],
  edhrec_rank: 2000,
}

const MOCK_SCRYFALL_ARTIFACT = {
  id: 'artifact-id',
  name: 'Test Artifact',
  cmc: 3,
  type_line: 'Artifact',
  oracle_text: '',
  mana_cost: '{3}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '2.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '3',
  rarity: 'uncommon',
  color_identity: [],
  edhrec_rank: 3000,
}

const MOCK_MULTI_SECTION_DECK = {
  deck: {
    name: 'Test Multi-Section Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Test Creature', set: 'tst', collectorNumber: '1' },
          { quantity: 1, name: 'Alpha Creature', set: 'tst', collectorNumber: '4' },
          { quantity: 1, name: 'Test Instant', set: 'tst', collectorNumber: '2' },
          { quantity: 1, name: 'Test Artifact', set: 'tst', collectorNumber: '3' },
        ],
      },
    ],
  },
  cards: {
    'Test Creature': MOCK_SCRYFALL_CREATURE,
    'Alpha Creature': MOCK_SCRYFALL_CREATURE_B,
    'Test Instant': MOCK_SCRYFALL_INSTANT,
    'Test Artifact': MOCK_SCRYFALL_ARTIFACT,
  },
  printings: {
    'Test Creature': [MOCK_SCRYFALL_CREATURE],
    'Alpha Creature': [MOCK_SCRYFALL_CREATURE_B],
    'Test Instant': [MOCK_SCRYFALL_INSTANT],
    'Test Artifact': [MOCK_SCRYFALL_ARTIFACT],
  },
  symbolMap: {},
  exportPath: 'decks/test-multi-section-deck.txt',
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_SITE_INDEX_WITH_MULTI_SECTION_DECK = {
  decks: [
    {
      slug: 'test-multi-section-deck',
      name: 'Test Multi-Section Deck',
      featuredCardImage: '',
      commander: null,
      cardCount: 3,
    },
  ],
  collections: [],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic deck that has cards of multiple
 * types (Creature, Instant, Artifact), producing multiple type-based sections in the toolbar.
 */
export async function mockPublicSiteDeckWithMultipleSections(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_MULTI_SECTION_DECK),
    })
  })

  await page.route('**/decks/test-multi-section-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MULTI_SECTION_DECK),
    })
  })
}

const MOCK_COLLECTION_CARD_PRICED = {
  id: 'collection-priced-id',
  name: 'Priced Card',
  cmc: 2,
  type_line: 'Creature — Human',
  oracle_text: '',
  mana_cost: '{1}{W}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '3.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '10',
  rarity: 'rare',
  color_identity: ['W'],
  edhrec_rank: 5000,
}

const MOCK_COLLECTION_CARD_UNPRICED = {
  id: 'collection-unpriced-id',
  name: 'Unpriced Card',
  cmc: 3,
  type_line: 'Artifact',
  oracle_text: '',
  mana_cost: '{3}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '11',
  rarity: 'uncommon',
  color_identity: [],
  edhrec_rank: 10000,
}

const MOCK_COLLECTION_DETAIL = {
  name: 'Test Collection',
  entries: [
    {
      name: 'Priced Card',
      set: 'tst',
      collectorNumber: '10',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3.5,
      fileOrder: 0,
    },
    {
      name: 'Unpriced Card',
      set: 'tst',
      collectorNumber: '11',
      finish: 'nonfoil',
      condition: 'NM',
      price: 0,
      fileOrder: 1,
    },
  ],
  cards: {
    'tst:10': MOCK_COLLECTION_CARD_PRICED,
    'tst:11': MOCK_COLLECTION_CARD_UNPRICED,
  },
  printings: {
    'Priced Card': [MOCK_COLLECTION_CARD_PRICED],
    'Unpriced Card': [MOCK_COLLECTION_CARD_UNPRICED],
  },
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 3.5,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_SITE_INDEX_WITH_COLLECTION = {
  decks: [],
  collections: [
    {
      slug: 'test-collection',
      name: 'Test Collection',
      featuredCardImage: '',
      cardCount: 2,
      totalPrice: 3.5,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic collection containing
 * both priced and unpriced cards, for testing the Hide Unpriced toolbar option.
 */
export async function mockPublicSiteCollection(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_COLLECTION),
    })
  })

  await page.route('**/collections/test-collection.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_COLLECTION_DETAIL),
    })
  })
}

/**
 * Mock the admin API endpoint for loading a single collection with priced and unpriced cards.
 */
export async function mockAdminCollectionLoadApi(page: Page): Promise<void> {
  await page.route('**/api/collection/test-collection', async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          entries: MOCK_COLLECTION_DETAIL.entries,
          cards: MOCK_COLLECTION_DETAIL.cards,
          printings: MOCK_COLLECTION_DETAIL.printings,
          symbolMap: {},
          slug: 'test-collection',
          contentHash: 'abc123',
        }),
      })
    } else {
      await route.continue()
    }
  })
}

// ===== Trade page mock data =====

const MOCK_TRADE_COLLECTION_CARD_BOLT = {
  id: 'trade-bolt-id',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '2.50',
    usd_foil: '5.00',
    usd_etched: null,
    eur: '2.00',
    eur_foil: null,
    tix: '0.50',
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  color_identity: ['R'],
  released_at: '1993-08-05',
}

const MOCK_TRADE_COLLECTION_CARD_RING = {
  id: 'trade-ring-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '3.00', usd_foil: null, usd_etched: null, eur: '2.50', eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'c19',
  set_name: 'Commander 2019',
  collector_number: '221',
  rarity: 'uncommon',
  color_identity: [],
  released_at: '2019-08-23',
}

const MOCK_TRADE_WANTED_CARD_CRYPT = {
  id: 'trade-crypt-id',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: 'At the beginning of your upkeep, flip a coin.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '175.00',
    usd_foil: '300.00',
    usd_etched: null,
    eur: '150.00',
    eur_foil: null,
    tix: null,
  },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  color_identity: [],
  released_at: '2020-08-07',
}

const MOCK_TRADE_COLLECTION_DETAIL = {
  name: 'Trade Collection',
  entries: [
    // Three identical Lightning Bolts (no notes) — should aggregate maxQty=3.
    {
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      condition: 'NM',
      price: 2.5,
      fileOrder: 0,
      cardId: 1,
    },
    {
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      condition: 'NM',
      price: 2.5,
      fileOrder: 1,
      cardId: 2,
    },
    {
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      condition: 'NM',
      price: 2.5,
      fileOrder: 2,
      cardId: 3,
    },
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      finish: 'nonfoil',
      condition: 'LP',
      price: 3.0,
      fileOrder: 3,
      cardId: 4,
    },
  ],
  cards: {
    'lea:161': MOCK_TRADE_COLLECTION_CARD_BOLT,
    'c19:221': MOCK_TRADE_COLLECTION_CARD_RING,
  },
  printings: {
    'Lightning Bolt': [MOCK_TRADE_COLLECTION_CARD_BOLT],
    'Sol Ring': [MOCK_TRADE_COLLECTION_CARD_RING],
  },
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 5.5,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_TRADE_WANTED_DETAIL = {
  name: 'Trade Wanted List',
  entries: [
    {
      name: 'Mana Crypt',
      set: '2xm',
      collectorNumber: '270',
      finish: 'nonfoil',
      price: 175.0,
      fileOrder: 0,
      state: 'fully-specified',
      cardId: 1,
    },
  ],
  cards: {
    'Mana Crypt': MOCK_TRADE_WANTED_CARD_CRYPT,
    '2xm:270': MOCK_TRADE_WANTED_CARD_CRYPT,
  },
  printings: { 'Mana Crypt': [MOCK_TRADE_WANTED_CARD_CRYPT] },
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 175.0,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_TRADE_DECK_CARD_COUNTERSPELL = {
  id: 'trade-counterspell-id',
  name: 'Counterspell',
  cmc: 2,
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '1.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'mh3',
  set_name: 'Modern Horizons 3',
  collector_number: '50',
  rarity: 'common',
  color_identity: ['U'],
  released_at: '2024-06-14',
}

const MOCK_TRADE_DECK_DETAIL = {
  deck: {
    name: 'Trade Deck',
    sections: [
      {
        name: 'Mainboard',
        cards: [
          // Card without set/collectorNumber — should trigger printing picker
          { quantity: 1, name: 'Counterspell', cardId: 1 },
          // Same printing in two sections, summed to maxQty=3
          {
            quantity: 2,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            finish: 'nonfoil',
            cardId: 2,
          },
        ],
      },
      {
        name: 'Sideboard',
        cards: [
          {
            quantity: 1,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            finish: 'nonfoil',
            cardId: 3,
          },
        ],
      },
    ],
  },
  cards: { 'Sol Ring': MOCK_TRADE_COLLECTION_CARD_RING },
  printings: {},
  symbolMap: {},
  exportPath: '',
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_SITE_INDEX_FOR_TRADE = {
  decks: [
    {
      slug: 'trade-deck',
      name: 'Trade Deck',
      featuredCardImage: '',
      commander: null,
      cardCount: 1,
    },
  ],
  collections: [
    {
      slug: 'trade-collection',
      name: 'Trade Collection',
      featuredCardImage: '',
      cardCount: 2,
      totalPrice: 5.5,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  wantedLists: [
    {
      slug: 'trade-wanted-list',
      name: 'Trade Wanted List',
      featuredCardImage: '',
      cardCount: 1,
      totalPrice: 175.0,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints for the Trade page.
 * Provides one collection (with Lightning Bolt + Sol Ring) and one wanted list (with Mana Crypt).
 * Also mocks the Scryfall autocomplete and search endpoints for right-column Scryfall mode tests.
 */
export async function mockPublicSiteForTrade(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_FOR_TRADE),
    })
  })

  await page.route('**/collections/trade-collection.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TRADE_COLLECTION_DETAIL),
    })
  })

  await page.route('**/wanted/trade-wanted-list.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TRADE_WANTED_DETAIL),
    })
  })

  await page.route('**/decks/trade-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TRADE_DECK_DETAIL),
    })
  })

  // Mock Scryfall autocomplete endpoint
  await page.route('**/api.scryfall.com/cards/autocomplete**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'catalog',
        total_values: 1,
        data: ['Mana Crypt'],
      }),
    })
  })

  // Mock Scryfall search (printings) endpoint
  await page.route('**/api.scryfall.com/cards/search**', async (route: Route) => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') ?? ''
    const data = q.toLowerCase().includes('counterspell')
      ? [MOCK_TRADE_DECK_CARD_COUNTERSPELL]
      : [MOCK_TRADE_WANTED_CARD_CRYPT]
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        object: 'list',
        total_cards: data.length,
        has_more: false,
        data,
      }),
    })
  })

  // Mock Scryfall batch collection endpoint (used when restoring scryfall cards from URL)
  await page.route('**/api.scryfall.com/cards/collection', async (route: Route) => {
    const body = (await route.request().postDataJSON()) as { identifiers?: { id: string }[] }
    const ids = (body.identifiers ?? []).map((i) => i.id)
    const allCards = [MOCK_TRADE_WANTED_CARD_CRYPT, MOCK_TRADE_DECK_CARD_COUNTERSPELL]
    const data = allCards.filter((c) => ids.includes(c.id))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data, not_found: [] }),
    })
  })
}
