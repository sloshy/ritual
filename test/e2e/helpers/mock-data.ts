import type { Page, Route } from '@playwright/test'
import type {
  CollectionDetail,
  DeckDetail,
  SiteIndex,
  WantedListDetail,
} from '../../../src/site/data-types'

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
  wantedDir: './wanted',
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
 * Mock the import-deck API endpoint. Pass `onRequest` to capture the parsed
 * request body for assertions on what the page sent.
 */
export async function mockImportDeckApi(
  page: Page,
  onRequest?: (body: unknown) => void,
): Promise<void> {
  await page.route('**/api/import-deck', async (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Deck imported', deckName: 'Imported Deck' }),
    })
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
  await page.route('**/api/import-csv', async (route: Route) => {
    onRequest?.(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: 'Imported 3 card(s)',
        cardCount: 3,
        failures,
      }),
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
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  changelog: [
    {
      timestamp: '2025-01-15T10:00:00.000Z',
      changes: [
        { action: 'Added', cardName: 'Test Creature', set: 'tst', collectorNumber: '1' },
        { action: 'Removed', cardName: 'Old Card' },
        { action: 'Added', cardName: 'Maybe Card', board: 'Maybeboard' },
        { action: 'Removed', cardName: 'Side Card', board: 'Sideboard' },
        { action: 'Set as commander', cardName: 'New Commander' },
        { action: 'Unset as commander', cardName: 'Old Commander' },
        { action: 'Set finish', cardName: 'Shiny Card', finish: 'foil' },
        { action: 'Set note', cardName: 'Noted Card', note: 'great vs aggro' },
        { action: 'Cleared note', cardName: 'Plain Card' },
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
      format: null,
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
      format: null,
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
          { quantity: 1, name: 'Test Creature', set: 'tst', collectorNumber: '1', cardId: 1 },
          { quantity: 1, name: 'Alpha Creature', set: 'tst', collectorNumber: '4', cardId: 2 },
          { quantity: 1, name: 'Test Instant', set: 'tst', collectorNumber: '2', cardId: 3 },
          { quantity: 1, name: 'Test Artifact', set: 'tst', collectorNumber: '3', cardId: 4 },
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
      format: null,
      cardCount: 3,
    },
  ],
  collections: [],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

// A portrait card image (matching Scryfall's 488×680 frame) served as an SVG so
// the <img> loads with the correct intrinsic aspect ratio in tests — no network
// and no flakiness from a missing image. Used by the sideways-card modal test.
const PORTRAIT_CARD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680"><rect width="488" height="680" fill="#334"/></svg>'

const MOCK_SCRYFALL_BATTLE = {
  id: 'battle-id',
  name: 'Test Battle',
  cmc: 4,
  type_line: 'Battle — Siege',
  oracle_text: 'When Test Battle enters, draw a card.',
  mana_cost: '{3}{R}',
  image_uris: {
    small: '',
    normal: 'https://card-images.test/battle.svg',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: { usd: '5.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '20',
  rarity: 'rare',
  color_identity: ['R'],
  edhrec_rank: 800,
}

const MOCK_SCRYFALL_UPRIGHT = {
  ...MOCK_SCRYFALL_CREATURE,
  image_uris: {
    small: '',
    normal: 'https://card-images.test/creature.svg',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
}

const MOCK_SIDEWAYS_DECK = {
  deck: {
    name: 'Test Sideways Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Test Battle', set: 'tst', collectorNumber: '20', cardId: 1 },
          { quantity: 1, name: 'Test Creature', set: 'tst', collectorNumber: '1', cardId: 2 },
        ],
      },
    ],
  },
  cards: {
    'Test Battle': MOCK_SCRYFALL_BATTLE,
    'Test Creature': MOCK_SCRYFALL_UPRIGHT,
  },
  printings: {
    'Test Battle': [MOCK_SCRYFALL_BATTLE],
    'Test Creature': [MOCK_SCRYFALL_UPRIGHT],
  },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_SITE_INDEX_WITH_SIDEWAYS_DECK = {
  decks: [
    {
      slug: 'test-sideways-deck',
      name: 'Test Sideways Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 2,
    },
  ],
  collections: [],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic deck containing a sideways
 * card (a Battle, which renders rotated) alongside an upright card, for testing
 * that the card-detail modal lays the sideways image out in a landscape panel.
 */
export async function mockPublicSiteDeckWithSidewaysCard(page: Page): Promise<void> {
  await page.route('https://card-images.test/*.svg', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PORTRAIT_CARD_SVG })
  })
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_SIDEWAYS_DECK),
    })
  })
  await page.route('**/decks/test-sideways-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SIDEWAYS_DECK),
    })
  })
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

// A collection holding two identical copies of one card, so "Group Duplicates"
// merges them into a single quantity-2 tile — used to test that "Remove a copy"
// appears only for a real multi-copy group.
const MOCK_COLLECTION_DUP_DETAIL = {
  name: 'Dup Collection',
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
      name: 'Priced Card',
      set: 'tst',
      collectorNumber: '10',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3.5,
      fileOrder: 1,
    },
  ],
  cards: { 'tst:10': MOCK_COLLECTION_CARD_PRICED },
  printings: { 'Priced Card': [MOCK_COLLECTION_CARD_PRICED] },
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 7.0,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_SITE_INDEX_WITH_DUP_COLLECTION = {
  decks: [],
  collections: [
    {
      slug: 'dup-collection',
      name: 'Dup Collection',
      featuredCardImage: '',
      cardCount: 2,
      totalPrice: 7.0,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/** Mock a collection with duplicate entries, for the duplicate-grouping selection tests. */
export async function mockPublicSiteCollectionWithDuplicates(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_DUP_COLLECTION),
    })
  })

  await page.route('**/collections/dup-collection.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_COLLECTION_DUP_DETAIL),
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

// ===== Filter menu mock data =====

const MOCK_FILTER_CARD_BASE = {
  oracle_text: '',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '1.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set_name: 'Test Set A',
  rarity: 'common',
}

const MOCK_FILTER_CARD_KNIGHT = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-knight-id',
  name: 'White Knight',
  cmc: 2,
  type_line: 'Creature — Human Knight',
  mana_cost: '{W}{W}',
  set: 'tsa',
  collector_number: '1',
  color_identity: ['W'],
  edhrec_rank: 1000,
  oracleTags: ['removal', 'mana-rock'],
  artTags: ['human'],
}

const MOCK_FILTER_CARD_ELF = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-elf-id',
  name: 'Green Elf',
  cmc: 1,
  type_line: 'Creature — Elf Druid',
  mana_cost: '{G}',
  set: 'tsb',
  set_name: 'Test Set B',
  collector_number: '2',
  color_identity: ['G'],
  edhrec_rank: 1100,
  oracleTags: ['ramp'],
  artTags: ['forest'],
}

const MOCK_FILTER_CARD_LORD = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-lord-id',
  name: 'Golgari Lord',
  cmc: 3,
  type_line: 'Creature — Zombie Elf',
  mana_cost: '{1}{B}{G}',
  set: 'tsa',
  collector_number: '3',
  color_identity: ['B', 'G'],
  edhrec_rank: 1200,
  oracleTags: ['removal', 'ramp'],
  artTags: ['zombie'],
}

const MOCK_FILTER_CARD_FOREST = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-forest-id',
  name: 'Test Forest',
  cmc: 0,
  type_line: 'Basic Land — Forest',
  mana_cost: '',
  set: 'tsa',
  collector_number: '4',
  color_identity: ['G'],
  edhrec_rank: 1300,
}

const MOCK_FILTER_CARD_ROCK = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-rock-id',
  name: 'Boring Rock',
  cmc: 2,
  type_line: 'Artifact',
  mana_cost: '{2}',
  set: 'tsb',
  set_name: 'Test Set B',
  collector_number: '5',
  color_identity: [],
  edhrec_rank: 1400,
  prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
}

const MOCK_FILTER_CARD_DRAGON = {
  ...MOCK_FILTER_CARD_BASE,
  id: 'filter-dragon-id',
  name: 'Maybe Dragon',
  cmc: 5,
  type_line: 'Creature — Dragon',
  mana_cost: '{3}{R}{R}',
  set: 'tsa',
  collector_number: '6',
  color_identity: ['R'],
  edhrec_rank: 1500,
  oracleTags: ['flying'],
  artTags: ['dragon'],
}

const MOCK_FILTER_CARDS = [
  MOCK_FILTER_CARD_KNIGHT,
  MOCK_FILTER_CARD_ELF,
  MOCK_FILTER_CARD_LORD,
  MOCK_FILTER_CARD_FOREST,
  MOCK_FILTER_CARD_ROCK,
  MOCK_FILTER_CARD_DRAGON,
]

const MOCK_FILTER_DECK = {
  deck: {
    name: 'Test Filter Deck',
    sections: [
      {
        name: 'Main',
        cards: MOCK_FILTER_CARDS.filter((card) => card !== MOCK_FILTER_CARD_DRAGON).map(
          (card, i) => ({
            quantity: 1,
            name: card.name,
            set: card.set,
            collectorNumber: card.collector_number,
            cardId: i + 1,
          }),
        ),
      },
      {
        name: 'Maybeboard',
        cards: [
          {
            quantity: 1,
            name: MOCK_FILTER_CARD_DRAGON.name,
            set: MOCK_FILTER_CARD_DRAGON.set,
            collectorNumber: MOCK_FILTER_CARD_DRAGON.collector_number,
            cardId: 6,
          },
        ],
      },
    ],
  },
  cards: Object.fromEntries(MOCK_FILTER_CARDS.map((card) => [card.name, card])),
  printings: Object.fromEntries(MOCK_FILTER_CARDS.map((card) => [card.name, [card]])),
  symbolMap: {},
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_SITE_INDEX_WITH_FILTER_DECK = {
  decks: [
    {
      slug: 'test-filter-deck',
      name: 'Test Filter Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: MOCK_FILTER_CARDS.length,
    },
  ],
  collections: [],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic deck whose cards differ in
 * name, color identity, set code, mana value, type, and pricing — one card per
 * axis the toolbar Filters menu can filter on — plus a Maybeboard card for the
 * Hide Extras toggle.
 */
export async function mockPublicSiteDeckForFilters(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_FILTER_DECK),
    })
  })

  await page.route('**/decks/test-filter-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_FILTER_DECK),
    })
  })
}

// ===== Trade page mock data =====

/**
 * Base shape for a printing returned by the Scryfall search endpoint, used by
 * trade printing-picker tests that fabricate several printings off a single
 * card name. Spread and override `id`, `set`, `collector_number`, etc. per row.
 */
export const PICKER_BASE_PRINTING = {
  id: 'crypt-base',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: '',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: {
    usd: '175.00',
    usd_foil: null,
    usd_etched: null,
    eur: null,
    eur_foil: null,
    tix: null,
  },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  color_identity: [],
  released_at: '2020-08-07',
}

export const MOCK_TRADE_COLLECTION_CARD_BOLT = {
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
      format: null,
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

const MOCK_SITE_INDEX_FOR_QUICK_SWITCH: SiteIndex = {
  decks: [
    {
      slug: 'azorius-control',
      name: 'Azorius Control',
      featuredCardImage: '',
      commander: 'Teferi, Hero of Dominaria',
      format: 'modern',
      cardCount: 60,
      totalPrice: 250.5,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
    {
      slug: 'mono-red-aggro',
      name: 'Mono Red Aggro',
      featuredCardImage: '',
      commander: null,
      format: 'modern',
      cardCount: 60,
      totalPrice: 80,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  collections: [
    {
      slug: 'main-binder',
      name: 'Main Binder',
      featuredCardImage: '',
      cardCount: 423,
      totalPrice: 1240.75,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  wantedLists: [
    {
      slug: 'high-priority',
      name: 'High Priority',
      featuredCardImage: '',
      cardCount: 8,
      totalPrice: 95,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

const MOCK_QUICK_SWITCH_DECK_AZORIUS = {
  deck: {
    name: 'Azorius Control',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Counterspell', set: 'mh2', collectorNumber: '267' }],
      },
    ],
  },
  cards: { Counterspell: null, 'Teferi, Hero of Dominaria': null },
  printings: {},
  symbolMap: {},
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
} satisfies DeckDetail

const MOCK_QUICK_SWITCH_DECK_MONO_RED = {
  deck: {
    name: 'Mono Red Aggro',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146' }],
      },
    ],
  },
  cards: { 'Lightning Bolt': null, 'Goblin Guide': null },
  printings: {},
  symbolMap: {},
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
} satisfies DeckDetail

const MOCK_QUICK_SWITCH_COLLECTION_MAIN_BINDER = {
  name: 'Main Binder',
  entries: [],
  cards: {
    'Sol Ring': null,
    'Lightning Bolt': null,
    'mkm:42': null,
  },
  printings: {},
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 1240.75,
  defaultCurrency: 'usd',
} satisfies CollectionDetail

const MOCK_QUICK_SWITCH_WANTED_HIGH_PRIORITY = {
  name: 'High Priority',
  entries: [],
  cards: { 'Mana Crypt': null },
  printings: {},
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 95,
  defaultCurrency: 'usd',
} satisfies WantedListDetail

/**
 * Mock the public site index.json with two decks, one collection, and one wanted list,
 * plus their detail JSONs (used by Quick Switch's commander/card pre-fetch).
 */
export async function mockPublicSiteForQuickSwitch(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_FOR_QUICK_SWITCH),
    })
  })
  await page.route('**/decks/azorius-control.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QUICK_SWITCH_DECK_AZORIUS),
    })
  })
  await page.route('**/decks/mono-red-aggro.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QUICK_SWITCH_DECK_MONO_RED),
    })
  })
  await page.route('**/collections/main-binder.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QUICK_SWITCH_COLLECTION_MAIN_BINDER),
    })
  })
  await page.route('**/wanted/high-priority.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_QUICK_SWITCH_WANTED_HIGH_PRIORITY),
    })
  })
}

// Index with multiple collections and wanted lists, each given distinct names,
// last-updated timestamps, and prices so the shared index toolbar's sort orders
// are unambiguous. Alphabetical and price orders are deliberately reverses of
// each other to make assertions easy to read.
const MOCK_SITE_INDEX_MULTI_LISTS: SiteIndex = {
  decks: [
    {
      slug: 'sample-deck',
      name: 'Sample Deck',
      featuredCardImage: '',
      commander: null,
      format: 'modern',
      cardCount: 60,
      totalPrice: 100,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  collections: [
    {
      slug: 'alpha-collection',
      name: 'Alpha Collection',
      featuredCardImage: '',
      cardCount: 50,
      lastUpdatedAt: '2026-05-01T00:00:00.000Z',
      totalPrice: 100,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
    {
      slug: 'mid-collection',
      name: 'Mid Collection',
      featuredCardImage: '',
      cardCount: 30,
      lastUpdatedAt: '2026-03-01T00:00:00.000Z',
      totalPrice: 250,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
    {
      slug: 'zebra-collection',
      name: 'Zebra Collection',
      featuredCardImage: '',
      cardCount: 10,
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      totalPrice: 500,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  wantedLists: [
    {
      slug: 'acquire-a',
      name: 'Acquire A',
      featuredCardImage: '',
      cardCount: 5,
      lastUpdatedAt: '2026-05-01T00:00:00.000Z',
      totalPrice: 30,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
    {
      slug: 'need-m',
      name: 'Need M',
      featuredCardImage: '',
      cardCount: 8,
      lastUpdatedAt: '2026-03-01T00:00:00.000Z',
      totalPrice: 60,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
    {
      slug: 'wishlist-z',
      name: 'Wishlist Z',
      featuredCardImage: '',
      cardCount: 12,
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      totalPrice: 90,
      totalPriceEur: 0,
      totalPriceTix: 0,
    },
  ],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site index.json with several collections and wanted lists so
 * the collection/wanted index toolbars can be exercised. Only index.json is
 * intercepted — these tests stay on the index page and never open a list.
 */
export async function mockPublicSiteIndexLists(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_MULTI_LISTS),
    })
  })
}

// ===== Move Cards page mock data =====

const MOVE_BOLT_CARD = {
  id: 'move-bolt',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  mana_cost: '{R}',
  image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
  prices: { usd: '2.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil', 'foil'],
  games: ['paper'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  rarity: 'common',
  color_identity: ['R'],
  released_at: '1993-08-05',
}

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
  await page.route('**/api/move', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOVE_DATA),
    })
  })

  await page.route('**/api/move/commit', async (route: Route) => {
    onCommit?.(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, moved: 1, skipped: 0, message: 'Moved 1 card.' }),
    })
  })

  await page.route('**/api/collection/move-binder', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
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
      }),
    })
  })

  await page.route('**/api/deck/move-deck', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        deck: { name: 'Move Deck', sections: [{ name: 'Main', cards: [] }] },
        cards: {},
        printings: {},
        symbolMap: {},
        frontMatter: { name: 'Move Deck' },
        slug: 'move-deck',
        contentHash: 'move-deck-hash',
      }),
    })
  })

  await page.route('**/api/wanted/move-wishlist', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        entries: [],
        sectionOrder: ['Main'],
        cards: {},
        printings: {},
        symbolMap: {},
        slug: 'move-wishlist',
        contentHash: 'move-wishlist-hash',
      }),
    })
  })

  await page.route('**/api/card-printings*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, printings: [MOVE_BOLT_CARD] }),
    })
  })
}

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
  await page.route('**/api/history', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(HISTORY_LISTS),
    })
  })

  await page.route('**/api/history/deck/history-deck', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(HISTORY_DETAIL),
    })
  })

  await page.route('**/api/history/deck/history-deck/save', async (route: Route) => {
    onSave?.(route.request().postDataJSON())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'Saved.', setCount: 1 }),
    })
  })
}

// ===== Multi-select mock data =====

// A two-card deck (one Instant, one Artifact, so default type-grouping splits
// them) used to exercise the list-page multi-select feature. Reuses the trade
// mock cards so the resolved printings carry real set/collector data.
const MOCK_MULTISELECT_DECK = {
  deck: {
    name: 'Multi Select Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          { quantity: 1, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 2 },
        ],
      },
    ],
  },
  cards: {
    'Lightning Bolt': MOCK_TRADE_COLLECTION_CARD_BOLT,
    'Sol Ring': MOCK_TRADE_COLLECTION_CARD_RING,
  },
  printings: {
    'Lightning Bolt': [MOCK_TRADE_COLLECTION_CARD_BOLT],
    'Sol Ring': [MOCK_TRADE_COLLECTION_CARD_RING],
  },
  symbolMap: {},
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_MULTISELECT_INDEX = {
  decks: [
    {
      slug: 'test-multi-select',
      name: 'Multi Select Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 2,
    },
  ],
  collections: [],
  useScryfallImgUrls: false,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/** Serve a synthetic two-card deck for the public-site multi-select tests. */
export async function mockPublicSiteDeckForMultiSelect(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MULTISELECT_INDEX),
    })
  })

  await page.route('**/decks/test-multi-select.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MULTISELECT_DECK),
    })
  })
}

// Two decks for cross-list selection tests. Deck A holds printing-pinned cards;
// deck B holds a single name-only card (no set/collector number) so adding it to
// a trade has to prompt for a printing. The cards carry a non-empty image so the
// modal's hover preview has something to show (these decks use Scryfall URLs).
// A 1×1 PNG data URL so the hover-preview <img> actually loads and gives the
// tooltip a non-zero size in tests (a 404 URL would leave it zero-height).
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
type CardWithImageUris = { id: string; image_uris: Record<string, string> }
function withImage<T extends CardWithImageUris>(
  card: T,
): Omit<T, 'image_uris'> & CardWithImageUris {
  return { ...card, image_uris: { ...card.image_uris, normal: TINY_PNG } }
}
const MS_BOLT = withImage(MOCK_TRADE_COLLECTION_CARD_BOLT)
const MS_RING = withImage(MOCK_TRADE_COLLECTION_CARD_RING)
const MS_CRYPT = withImage(MOCK_TRADE_WANTED_CARD_CRYPT)

const MOCK_MS_DECK_A = {
  deck: {
    name: 'MS Deck A',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          {
            quantity: 1,
            name: 'Sol Ring',
            set: 'c19',
            collectorNumber: '221',
            finish: 'foil',
            condition: 'LP',
            cardId: 2,
          },
        ],
      },
    ],
  },
  cards: { 'Lightning Bolt': MS_BOLT, 'Sol Ring': MS_RING },
  printings: { 'Lightning Bolt': [MS_BOLT], 'Sol Ring': [MS_RING] },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_MS_DECK_B = {
  deck: {
    name: 'MS Deck B',
    sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Mana Crypt', cardId: 1 }] }],
  },
  cards: { 'Mana Crypt': MS_CRYPT },
  printings: { 'Mana Crypt': [MS_CRYPT] },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

// A deck with a 4× quantity group, for the per-copy selection tests.
const MOCK_MS_DECK_QTY = {
  deck: {
    name: 'MS Deck Qty',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 4, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
        ],
      },
    ],
  },
  cards: { 'Lightning Bolt': MS_BOLT },
  printings: { 'Lightning Bolt': [MS_BOLT] },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_MS_INDEX = {
  decks: [
    {
      slug: 'ms-a',
      name: 'MS Deck A',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 2,
    },
    {
      slug: 'ms-b',
      name: 'MS Deck B',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 1,
    },
    {
      slug: 'ms-qty',
      name: 'MS Deck Qty',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 4,
    },
  ],
  collections: [],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/** Serve two synthetic decks (one with a name-only card) for cross-list selection tests. */
export async function mockPublicSiteMultiSelectLists(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MS_INDEX),
    })
  })
  await page.route('**/decks/ms-a.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MS_DECK_A),
    })
  })
  await page.route('**/decks/ms-b.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MS_DECK_B),
    })
  })
  await page.route('**/decks/ms-qty.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_MS_DECK_QTY),
    })
  })
}

// ---- Combined List view ----
// A deck and a collection that share a card (Sol Ring), used to exercise the
// "Combine with list" modal and the combined view: cross-type combining, the
// lowest-common-denominator "no card merging" rule, and source-list grouping.
const MOCK_CV_DECK = {
  deck: {
    name: 'CV Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          { quantity: 2, name: 'Sol Ring', set: 'c19', collectorNumber: '221', cardId: 2 },
        ],
      },
    ],
  },
  cards: { 'Lightning Bolt': MS_BOLT, 'Sol Ring': MS_RING },
  printings: { 'Lightning Bolt': [MS_BOLT], 'Sol Ring': [MS_RING] },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_CV_COLLECTION = {
  name: 'CV Box',
  entries: [
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3,
      fileOrder: 0,
      section: 'Main',
      cardId: 1,
    },
  ],
  cards: { 'c19:221': MS_RING },
  printings: { 'Sol Ring': [MS_RING] },
  symbolMap: {},
  useScryfallImgUrls: true,
  totalPrice: 3,
  defaultCurrency: 'usd',
}

const MOCK_CV_INDEX = {
  decks: [
    {
      slug: 'cv-deck',
      name: 'CV Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 3,
      totalPrice: 8,
    },
  ],
  collections: [
    { slug: 'cv-box', name: 'CV Box', featuredCardImage: '', cardCount: 1, totalPrice: 3 },
  ],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/** Serve a deck + collection for the combined-list-view tests. */
export async function mockPublicSiteCombinedLists(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CV_INDEX),
    })
  })
  await page.route('**/decks/cv-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CV_DECK),
    })
  })
  await page.route('**/collections/cv-box.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CV_COLLECTION),
    })
  })
}

// A double-faced card whose front is a Creature and back is a Land. Has no
// top-level image_uris (so isDoubleFacedCard() is true) and distinct per-face
// images, exercising both the front-face grouping rule and the flip button.
const MOCK_SCRYFALL_DFC = {
  id: 'dfc-id',
  name: 'Werewolf Front // Werewolf Back',
  cmc: 3,
  type_line: 'Creature — Human Werewolf // Land',
  oracle_text: '',
  card_faces: [
    {
      name: 'Werewolf Front',
      mana_cost: '{2}{G}',
      type_line: 'Creature — Human Werewolf',
      oracle_text: 'Front face.',
      image_uris: { normal: 'https://card-images.test/dfc-front.svg' },
    },
    {
      name: 'Werewolf Back',
      mana_cost: '',
      type_line: 'Land',
      oracle_text: 'Back face.',
      image_uris: { normal: 'https://card-images.test/dfc-back.svg' },
    },
  ],
  prices: { usd: '2.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '30',
  rarity: 'rare',
  color_identity: ['G'],
  edhrec_rank: 500,
}

const MOCK_SCRYFALL_PLAIN_LAND = {
  id: 'land-id',
  name: 'Test Wastes',
  cmc: 0,
  type_line: 'Land',
  oracle_text: '',
  image_uris: {
    small: '',
    normal: 'https://card-images.test/land.svg',
    large: '',
    png: '',
    art_crop: '',
    border_crop: '',
  },
  prices: { usd: '0.10', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '31',
  rarity: 'common',
  color_identity: [],
  edhrec_rank: 600,
}

const MOCK_DFC_DECK = {
  deck: {
    name: 'Test DFC Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            quantity: 1,
            name: 'Werewolf Front // Werewolf Back',
            set: 'tst',
            collectorNumber: '30',
            cardId: 1,
          },
          { quantity: 1, name: 'Test Wastes', set: 'tst', collectorNumber: '31', cardId: 2 },
        ],
      },
    ],
  },
  cards: {
    'Werewolf Front // Werewolf Back': MOCK_SCRYFALL_DFC,
    'Test Wastes': MOCK_SCRYFALL_PLAIN_LAND,
  },
  printings: {
    'Werewolf Front // Werewolf Back': [MOCK_SCRYFALL_DFC],
    'Test Wastes': [MOCK_SCRYFALL_PLAIN_LAND],
  },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const MOCK_SITE_INDEX_WITH_DFC_DECK = {
  decks: [
    {
      slug: 'test-dfc-deck',
      name: 'Test DFC Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 2,
    },
  ],
  collections: [],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/**
 * Mock the public site JSON endpoints with a synthetic deck containing a
 * double-faced card (Creature front / Land back) alongside a plain land, for
 * testing front-face type grouping and the in-place flip button.
 */
export async function mockPublicSiteDeckWithDoubleFacedCard(page: Page): Promise<void> {
  await page.route('https://card-images.test/*.svg', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PORTRAIT_CARD_SVG })
  })
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_SITE_INDEX_WITH_DFC_DECK),
    })
  })
  await page.route('**/decks/test-dfc-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_DFC_DECK),
    })
  })
}

// ----- Find page -----
// Exercises name-based search across a deck, a collection, and a wanted list,
// including a true double-faced card (front-face-only matching) and a double-art
// printing whose two faces share one name (`Steam Vents // Steam Vents`).
const FIND_BASE_CARD = {
  cmc: 1,
  type_line: 'Instant',
  oracle_text: '',
  prices: { usd: '1.00', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  finishes: ['nonfoil'],
  games: ['paper'],
  rarity: 'common',
  set_name: 'Test Set',
}

const FIND_BOLT = {
  ...FIND_BASE_CARD,
  id: 'find-bolt',
  name: 'Lightning Bolt',
  image_uris: { normal: '' },
  set: 'lea',
  collector_number: '161',
  color_identity: ['R'],
  edhrec_rank: 100,
}

const FIND_RING = {
  ...FIND_BASE_CARD,
  id: 'find-ring',
  name: 'Sol Ring',
  type_line: 'Artifact',
  image_uris: { normal: '' },
  set: 'c19',
  collector_number: '221',
  color_identity: [],
  edhrec_rank: 50,
}

const FIND_STEAM = {
  ...FIND_BASE_CARD,
  id: 'find-steam',
  name: 'Steam Vents',
  type_line: 'Land — Island Mountain',
  image_uris: { normal: '' },
  set: 'gpt',
  collector_number: '233',
  color_identity: ['U', 'R'],
  edhrec_rank: 200,
}

// A double-art printing: one physical card whose two faces share the same name.
const FIND_STEAM_DOUBLE_ART = {
  ...FIND_STEAM,
  id: 'find-steam-da',
  name: 'Steam Vents // Steam Vents',
  set: 'sld',
  collector_number: '1234',
}

// A true double-faced card: front "Bruce Banner", back "The Incredible Hulk".
const FIND_BRUCE = {
  ...FIND_BASE_CARD,
  id: 'find-bruce',
  name: 'Bruce Banner // The Incredible Hulk',
  type_line: 'Legendary Creature — Human Scientist // Legendary Creature — Monster',
  card_faces: [
    { name: 'Bruce Banner', image_uris: { normal: 'https://card-images.test/bruce-front.svg' } },
    {
      name: 'The Incredible Hulk',
      image_uris: { normal: 'https://card-images.test/bruce-back.svg' },
    },
  ],
  set: 'mom',
  collector_number: '40',
  color_identity: ['G'],
  edhrec_rank: 300,
}

const FIND_COUNTER = {
  ...FIND_BASE_CARD,
  id: 'find-counter',
  name: 'Counterspell',
  image_uris: { normal: '' },
  set: 'lea',
  collector_number: '54',
  color_identity: ['U'],
  edhrec_rank: 150,
}

const FIND_DECK = {
  deck: {
    name: 'Find Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
          {
            quantity: 1,
            name: 'Bruce Banner // The Incredible Hulk',
            set: 'mom',
            collectorNumber: '40',
            cardId: 2,
          },
          { quantity: 1, name: 'Steam Vents', set: 'gpt', collectorNumber: '233', cardId: 3 },
        ],
      },
    ],
  },
  cards: {
    'Lightning Bolt': FIND_BOLT,
    'Bruce Banner // The Incredible Hulk': FIND_BRUCE,
    'Steam Vents': FIND_STEAM,
  },
  printings: {
    'Lightning Bolt': [FIND_BOLT],
    'Bruce Banner // The Incredible Hulk': [FIND_BRUCE],
    'Steam Vents': [FIND_STEAM],
  },
  symbolMap: {},
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
  missingCards: { usd: [], eur: [], tix: [] },
}

const FIND_COLLECTION = {
  name: 'Find Box',
  entries: [
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3,
      fileOrder: 0,
      section: 'Main',
      cardId: 1,
    },
    {
      name: 'Steam Vents',
      set: 'sld',
      collectorNumber: '1234',
      finish: 'nonfoil',
      condition: 'NM',
      price: 5,
      fileOrder: 1,
      section: 'Main',
      cardId: 2,
    },
  ],
  cards: { 'c19:221': FIND_RING, 'sld:1234': FIND_STEAM_DOUBLE_ART },
  printings: { 'Sol Ring': [FIND_RING], 'Steam Vents': [FIND_STEAM_DOUBLE_ART] },
  symbolMap: {},
  useScryfallImgUrls: true,
  totalPrice: 8,
  defaultCurrency: 'usd',
}

const FIND_WANTED = {
  name: 'Find Wanted',
  entries: [
    {
      name: 'Counterspell',
      price: 1,
      fileOrder: 0,
      section: 'Main',
      state: 'name-only',
      cardId: 1,
    },
  ],
  cards: { Counterspell: FIND_COUNTER },
  printings: { Counterspell: [FIND_COUNTER] },
  symbolMap: {},
  useScryfallImgUrls: true,
  totalPrice: 1,
  defaultCurrency: 'usd',
}

const FIND_INDEX = {
  decks: [
    {
      slug: 'find-deck',
      name: 'Find Deck',
      featuredCardImage: '',
      commander: null,
      format: null,
      cardCount: 3,
      totalPrice: 10,
    },
  ],
  collections: [
    { slug: 'find-box', name: 'Find Box', featuredCardImage: '', cardCount: 2, totalPrice: 8 },
  ],
  wantedLists: [
    {
      slug: 'find-wanted',
      name: 'Find Wanted',
      featuredCardImage: '',
      cardCount: 1,
      totalPrice: 1,
    },
  ],
  useScryfallImgUrls: true,
  defaultCurrency: 'usd',
  availableCurrencies: ['usd'],
}

/** Serve a deck + collection + wanted list for the Find page tests. */
export async function mockPublicSiteForFind(page: Page): Promise<void> {
  await page.route('**/index.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIND_INDEX),
    })
  })
  await page.route('**/decks/find-deck.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIND_DECK),
    })
  })
  await page.route('**/collections/find-box.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIND_COLLECTION),
    })
  })
  await page.route('**/wanted/find-wanted.json', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(FIND_WANTED),
    })
  })
}
