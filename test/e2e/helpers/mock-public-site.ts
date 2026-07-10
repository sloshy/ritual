import type { Page, Route } from '@playwright/test'
import type {
  CollectionCardEntry,
  CollectionDetail,
  CollectionSummary,
  DeckDetail,
  DeckSummary,
  SiteIndex,
  WantedListDetail,
  WantedListSummary,
} from '../../../src/site/data-types'
import type { ScryfallCard } from '../../../src/types'
import { fulfillJson } from './fulfill'
import {
  MOCK_COLLECTION_CARD_PRICED,
  MOCK_COLLECTION_DETAIL,
  MOCK_WANTED_LIST_DETAIL,
  makeMockScryfallCard,
  withImage,
} from './mock-cards'

// ===== index.json builders =====

/** An index.json payload; array and currency fields default to the common single-currency shape. */
export function makeSiteIndex(overrides: Partial<SiteIndex> = {}): SiteIndex {
  return {
    decks: [],
    collections: [],
    useScryfallImgUrls: false,
    defaultCurrency: 'usd',
    availableCurrencies: ['usd'],
    ...overrides,
  }
}

/** A deck row for {@link makeSiteIndex}, defaulting the boilerplate summary fields. */
export function makeDeckSummary(overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    slug: 'test-deck',
    name: 'Test Deck',
    featuredCardImage: '',
    commander: null,
    format: null,
    cardCount: 1,
    ...overrides,
  }
}

/** A collection row for {@link makeSiteIndex}, defaulting the boilerplate summary fields. */
export function makeCollectionSummary(
  overrides: Partial<CollectionSummary> = {},
): CollectionSummary {
  return {
    slug: 'test-collection',
    name: 'Test Collection',
    featuredCardImage: '',
    cardCount: 1,
    totalPrice: 0,
    totalPriceEur: 0,
    totalPriceTix: 0,
    ...overrides,
  }
}

/** A wanted-list row for {@link makeSiteIndex}, defaulting the boilerplate summary fields. */
export function makeWantedListSummary(
  overrides: Partial<WantedListSummary> = {},
): WantedListSummary {
  return {
    slug: 'test-wanted-list',
    name: 'Test Wanted List',
    featuredCardImage: '',
    cardCount: 1,
    totalPrice: 0,
    totalPriceEur: 0,
    totalPriceTix: 0,
    ...overrides,
  }
}

// ===== Changelog deck =====

const MOCK_SCRYFALL_CARD = makeMockScryfallCard({
  id: 'test-card-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  oracle_text: 'Test oracle text.',
  prices: { usd: '1.00', eur: '0.80' },
})

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_CHANGELOG_DECK = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'test-changelog-deck', name: 'Test Changelog Deck' })],
})

/**
 * Mock the public site JSON endpoints with a synthetic deck that has a changelog.
 * Intercepts index.json and the deck JSON for 'test-changelog-deck'.
 */
export async function mockPublicSiteDeckWithChangelog(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_CHANGELOG_DECK)
  await fulfillJson(page, '**/decks/test-changelog-deck.json', MOCK_DECK_WITH_CHANGELOG)
}

// ===== Description deck =====

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_DESCRIPTION_DECK = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'test-description-deck', name: 'Test Description Deck' })],
})

/**
 * Mock the public site JSON endpoints with a synthetic deck that has a long description.
 * Intercepts index.json and the deck JSON for 'test-description-deck'.
 */
export async function mockPublicSiteDeckWithDescription(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_DESCRIPTION_DECK)
  await fulfillJson(page, '**/decks/test-description-deck.json', MOCK_DECK_WITH_DESCRIPTION)
}

// ===== Wanted list =====

const MOCK_SITE_INDEX_WITH_WANTED_LIST = makeSiteIndex({
  wantedLists: [makeWantedListSummary({ cardCount: 3, totalPrice: 205.0 })],
  useScryfallImgUrls: true,
})

/**
 * Mock the public site JSON endpoints with a synthetic wanted list.
 */
export async function mockPublicSiteWantedList(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_WANTED_LIST)
  await fulfillJson(page, '**/wanted/test-wanted-list.json', MOCK_WANTED_LIST_DETAIL)
}

// ===== Multi-section deck =====

const MOCK_SCRYFALL_CREATURE = makeMockScryfallCard({
  id: 'creature-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  mana_cost: '{1}{W}',
  prices: { usd: '1.00' },
  color_identity: ['W'],
  edhrec_rank: 1000,
})

const MOCK_SCRYFALL_CREATURE_B = makeMockScryfallCard({
  id: 'creature-b-id',
  name: 'Alpha Creature',
  cmc: 3,
  type_line: 'Creature — Beast',
  mana_cost: '{2}{G}',
  prices: { usd: '0.75' },
  collector_number: '4',
  color_identity: ['G'],
  edhrec_rank: 1500,
})

const MOCK_SCRYFALL_INSTANT = makeMockScryfallCard({
  id: 'instant-id',
  name: 'Test Instant',
  cmc: 1,
  type_line: 'Instant',
  mana_cost: '{R}',
  prices: { usd: '0.50' },
  collector_number: '2',
  color_identity: ['R'],
  edhrec_rank: 2000,
})

const MOCK_SCRYFALL_ARTIFACT = makeMockScryfallCard({
  id: 'artifact-id',
  name: 'Test Artifact',
  cmc: 3,
  type_line: 'Artifact',
  mana_cost: '{3}',
  prices: { usd: '2.00' },
  collector_number: '3',
  rarity: 'uncommon',
  edhrec_rank: 3000,
})

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_MULTI_SECTION_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'test-multi-section-deck',
      name: 'Test Multi-Section Deck',
      cardCount: 3,
    }),
  ],
})

// A portrait card image (matching Scryfall's 488×680 frame) served as an SVG so
// the <img> loads with the correct intrinsic aspect ratio in tests — no network
// and no flakiness from a missing image. Used by the sideways-card modal test.
const PORTRAIT_CARD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="488" height="680" viewBox="0 0 488 680"><rect width="488" height="680" fill="#334"/></svg>'

/** Serve every https://card-images.test/*.svg request with the portrait card SVG. */
async function mockCardImageSvgs(page: Page): Promise<void> {
  await page.route('https://card-images.test/*.svg', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PORTRAIT_CARD_SVG })
  })
}

const MOCK_SCRYFALL_BATTLE = makeMockScryfallCard({
  id: 'battle-id',
  name: 'Test Battle',
  cmc: 4,
  type_line: 'Battle — Siege',
  oracle_text: 'When Test Battle enters, draw a card.',
  mana_cost: '{3}{R}',
  image_uris: { normal: 'https://card-images.test/battle.svg' },
  prices: { usd: '5.00' },
  collector_number: '20',
  rarity: 'rare',
  color_identity: ['R'],
  edhrec_rank: 800,
})

const MOCK_SCRYFALL_UPRIGHT = withImage(
  MOCK_SCRYFALL_CREATURE,
  'https://card-images.test/creature.svg',
)

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_SIDEWAYS_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'test-sideways-deck', name: 'Test Sideways Deck', cardCount: 2 }),
  ],
  useScryfallImgUrls: true,
})

/**
 * Mock the public site JSON endpoints with a synthetic deck containing a sideways
 * card (a Battle, which renders rotated) alongside an upright card, for testing
 * that the card-detail modal lays the sideways image out in a landscape panel.
 */
export async function mockPublicSiteDeckWithSidewaysCard(page: Page): Promise<void> {
  await mockCardImageSvgs(page)
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_SIDEWAYS_DECK)
  await fulfillJson(page, '**/decks/test-sideways-deck.json', MOCK_SIDEWAYS_DECK)
}

/**
 * Mock the public site JSON endpoints with a synthetic deck that has cards of multiple
 * types (Creature, Instant, Artifact), producing multiple type-based sections in the toolbar.
 */
export async function mockPublicSiteDeckWithMultipleSections(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_MULTI_SECTION_DECK)
  await fulfillJson(page, '**/decks/test-multi-section-deck.json', MOCK_MULTI_SECTION_DECK)
}

// ===== Collection with priced and unpriced cards =====

const MOCK_SITE_INDEX_WITH_COLLECTION = makeSiteIndex({
  collections: [makeCollectionSummary({ cardCount: 2, totalPrice: 3.5 })],
})

/**
 * Mock the public site JSON endpoints with a synthetic collection containing
 * both priced and unpriced cards, for testing the Hide Unpriced toolbar option.
 */
export async function mockPublicSiteCollection(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_COLLECTION)
  await fulfillJson(page, '**/collections/test-collection.json', MOCK_COLLECTION_DETAIL)
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
      section: 'Main',
    },
    {
      name: 'Priced Card',
      set: 'tst',
      collectorNumber: '10',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3.5,
      fileOrder: 1,
      section: 'Main',
    },
  ],
  cards: { 'tst:10': MOCK_COLLECTION_CARD_PRICED },
  printings: { 'Priced Card': [MOCK_COLLECTION_CARD_PRICED] },
  symbolMap: {},
  useScryfallImgUrls: false,
  totalPrice: 7.0,
  defaultCurrency: 'usd',
} satisfies CollectionDetail

const MOCK_SITE_INDEX_WITH_DUP_COLLECTION = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'dup-collection',
      name: 'Dup Collection',
      cardCount: 2,
      totalPrice: 7.0,
    }),
  ],
})

/** Mock a collection with duplicate entries, for the duplicate-grouping selection tests. */
export async function mockPublicSiteCollectionWithDuplicates(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_DUP_COLLECTION)
  await fulfillJson(page, '**/collections/dup-collection.json', MOCK_COLLECTION_DUP_DETAIL)
}

// ===== Filter menu mock data =====

const MOCK_FILTER_CARD_KNIGHT = makeMockScryfallCard({
  id: 'filter-knight-id',
  name: 'White Knight',
  cmc: 2,
  type_line: 'Creature — Human Knight',
  mana_cost: '{W}{W}',
  set: 'tsa',
  set_name: 'Test Set A',
  color_identity: ['W'],
  edhrec_rank: 1000,
  oracleTags: ['removal', 'mana-rock'],
  artTags: ['human'],
  prices: { usd: '5.00', eur: '4.00' },
})

const MOCK_FILTER_CARD_ELF = makeMockScryfallCard({
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
  prices: { usd: '0.50', eur: '0.40' },
})

const MOCK_FILTER_CARD_LORD = makeMockScryfallCard({
  id: 'filter-lord-id',
  name: 'Golgari Lord',
  cmc: 3,
  type_line: 'Creature — Zombie Elf',
  mana_cost: '{1}{B}{G}',
  set: 'tsa',
  set_name: 'Test Set A',
  collector_number: '3',
  color_identity: ['B', 'G'],
  edhrec_rank: 1200,
  oracleTags: ['removal', 'ramp'],
  artTags: ['zombie'],
  prices: { usd: '10.00', eur: '8.00' },
})

const MOCK_FILTER_CARD_FOREST = makeMockScryfallCard({
  id: 'filter-forest-id',
  name: 'Test Forest',
  cmc: 0,
  type_line: 'Basic Land — Forest',
  mana_cost: '',
  set: 'tsa',
  set_name: 'Test Set A',
  collector_number: '4',
  color_identity: ['G'],
  edhrec_rank: 1300,
  prices: { usd: '0.25', eur: '0.20' },
})

const MOCK_FILTER_CARD_ROCK = makeMockScryfallCard({
  id: 'filter-rock-id',
  name: 'Boring Rock',
  cmc: 2,
  type_line: 'Artifact',
  mana_cost: '{2}',
  set: 'tsb',
  set_name: 'Test Set B',
  collector_number: '5',
  edhrec_rank: 1400,
})

const MOCK_FILTER_CARD_DRAGON = makeMockScryfallCard({
  id: 'filter-dragon-id',
  name: 'Maybe Dragon',
  cmc: 5,
  type_line: 'Creature — Dragon',
  mana_cost: '{3}{R}{R}',
  set: 'tsa',
  set_name: 'Test Set A',
  collector_number: '6',
  color_identity: ['R'],
  edhrec_rank: 1500,
  oracleTags: ['flying'],
  artTags: ['dragon'],
  prices: { usd: '25.00', eur: '20.00' },
})

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
            // Golgari Lord carries 2 copies so the Copies filter has a duplicate
            // to distinguish from the other (true one-of) cards in this fixture.
            quantity: card === MOCK_FILTER_CARD_LORD ? 2 : 1,
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
  availableCurrencies: ['usd', 'eur'],
  missingCards: { usd: [], eur: [], tix: [] },
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_FILTER_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'test-filter-deck',
      name: 'Test Filter Deck',
      cardCount: MOCK_FILTER_CARDS.length,
    }),
  ],
  availableCurrencies: ['usd', 'eur'],
})

/**
 * Mock the public site JSON endpoints with a synthetic deck whose cards differ in
 * name, color identity, set code, mana value, type, and pricing — one card per
 * axis the toolbar Filters menu can filter on — plus a Maybeboard card for the
 * Hide Extras toggle.
 */
export async function mockPublicSiteDeckForFilters(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_FILTER_DECK)
  await fulfillJson(page, '**/decks/test-filter-deck.json', MOCK_FILTER_DECK)
}

// ===== Trade page mock data =====

/** Request body of Scryfall's batch `/cards/collection` endpoint. */
type ScryfallCollectionRequestBody = { identifiers?: { id: string }[] }

/**
 * Base shape for a printing returned by the Scryfall search endpoint, used by
 * trade printing-picker tests that fabricate several printings off a single
 * card name. Spread and override `id`, `set`, `collector_number`, etc. per row.
 */
export const PICKER_BASE_PRINTING = makeMockScryfallCard({
  id: 'crypt-base',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  prices: { usd: '175.00' },
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  released_at: '2020-08-07',
})

export const MOCK_TRADE_COLLECTION_CARD_BOLT = makeMockScryfallCard({
  id: 'trade-bolt-id',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  prices: { usd: '2.50', usd_foil: '5.00', eur: '2.00', tix: '0.50' },
  finishes: ['nonfoil', 'foil'],
  set: 'lea',
  set_name: 'Limited Edition Alpha',
  collector_number: '161',
  color_identity: ['R'],
  released_at: '1993-08-05',
})

const MOCK_TRADE_COLLECTION_CARD_RING = makeMockScryfallCard({
  id: 'trade-ring-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  prices: { usd: '3.00', eur: '2.50' },
  set: 'c19',
  set_name: 'Commander 2019',
  collector_number: '221',
  rarity: 'uncommon',
  released_at: '2019-08-23',
})

const MOCK_TRADE_WANTED_CARD_CRYPT = makeMockScryfallCard({
  id: 'trade-crypt-id',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: 'At the beginning of your upkeep, flip a coin.',
  prices: { usd: '175.00', usd_foil: '300.00', eur: '150.00' },
  finishes: ['nonfoil', 'foil'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
  released_at: '2020-08-07',
})

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
      section: 'Main',
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
      section: 'Main',
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
      section: 'Main',
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
      section: 'Main',
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
} satisfies CollectionDetail

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
      section: 'Main',
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
} satisfies WantedListDetail

const MOCK_TRADE_DECK_CARD_COUNTERSPELL = makeMockScryfallCard({
  id: 'trade-counterspell-id',
  name: 'Counterspell',
  cmc: 2,
  type_line: 'Instant',
  oracle_text: 'Counter target spell.',
  prices: { usd: '1.50' },
  set: 'mh3',
  set_name: 'Modern Horizons 3',
  collector_number: '50',
  color_identity: ['U'],
  released_at: '2024-06-14',
})

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_FOR_TRADE = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'trade-deck', name: 'Trade Deck' })],
  collections: [
    makeCollectionSummary({
      slug: 'trade-collection',
      name: 'Trade Collection',
      cardCount: 2,
      totalPrice: 5.5,
    }),
  ],
  wantedLists: [
    makeWantedListSummary({
      slug: 'trade-wanted-list',
      name: 'Trade Wanted List',
      totalPrice: 175.0,
    }),
  ],
})

/**
 * Mock the public site JSON endpoints for the Trade page.
 * Provides one collection (with Lightning Bolt + Sol Ring) and one wanted list (with Mana Crypt).
 * Also mocks the Scryfall autocomplete and search endpoints for right-column Scryfall mode tests.
 */
export async function mockPublicSiteForTrade(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_TRADE)
  await fulfillJson(page, '**/collections/trade-collection.json', MOCK_TRADE_COLLECTION_DETAIL)
  await fulfillJson(page, '**/wanted/trade-wanted-list.json', MOCK_TRADE_WANTED_DETAIL)
  await fulfillJson(page, '**/decks/trade-deck.json', MOCK_TRADE_DECK_DETAIL)

  // Mock Scryfall autocomplete endpoint
  await fulfillJson(page, '**/api.scryfall.com/cards/autocomplete**', {
    object: 'catalog',
    total_values: 1,
    data: ['Mana Crypt'],
  })

  // Mock Scryfall search (printings) endpoint
  await fulfillJson(page, '**/api.scryfall.com/cards/search**', (route: Route) => {
    const url = new URL(route.request().url())
    const q = url.searchParams.get('q') ?? ''
    const data = q.toLowerCase().includes('counterspell')
      ? [MOCK_TRADE_DECK_CARD_COUNTERSPELL]
      : [MOCK_TRADE_WANTED_CARD_CRYPT]
    return { object: 'list', total_cards: data.length, has_more: false, data }
  })

  // Mock Scryfall batch collection endpoint (used when restoring scryfall cards from URL)
  await fulfillJson(page, '**/api.scryfall.com/cards/collection', (route: Route) => {
    const body = route.request().postDataJSON() as ScryfallCollectionRequestBody
    const ids = (body.identifiers ?? []).map((i) => i.id)
    const allCards = [MOCK_TRADE_WANTED_CARD_CRYPT, MOCK_TRADE_DECK_CARD_COUNTERSPELL]
    const data = allCards.filter((c) => ids.includes(c.id))
    return { data, not_found: [] }
  })
}

// ===== Quick Switch =====

const MOCK_SITE_INDEX_FOR_QUICK_SWITCH: SiteIndex = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'azorius-control',
      name: 'Azorius Control',
      commander: 'Teferi, Hero of Dominaria',
      format: 'modern',
      cardCount: 60,
      totalPrice: 250.5,
      totalPriceEur: 0,
      totalPriceTix: 0,
    }),
    makeDeckSummary({
      slug: 'mono-red-aggro',
      name: 'Mono Red Aggro',
      format: 'modern',
      cardCount: 60,
      totalPrice: 80,
      totalPriceEur: 0,
      totalPriceTix: 0,
    }),
  ],
  collections: [
    makeCollectionSummary({
      slug: 'main-binder',
      name: 'Main Binder',
      cardCount: 423,
      totalPrice: 1240.75,
    }),
  ],
  wantedLists: [
    makeWantedListSummary({
      slug: 'high-priority',
      name: 'High Priority',
      cardCount: 8,
      totalPrice: 95,
    }),
  ],
})

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

function binderEntry(
  name: string,
  set: string,
  collectorNumber: string,
  fileOrder: number,
): CollectionCardEntry {
  return {
    name,
    set,
    collectorNumber,
    finish: 'nonfoil',
    condition: 'NM',
    price: 0,
    fileOrder,
    section: 'Main',
  }
}

// The owned Moonshadow printing (ecl:386). The collection's card map also holds
// a second, differently-illustrated printing of the same name (ecl:110) under a
// bare card-name key — the shape build-site emits for changelog-referenced
// cards so the changelog modal can resolve a thumbnail. Because only ecl:386 is
// an actual entry, the quick switch must surface a single Moonshadow card and a
// single ECL:386 printing, never the non-owned ecl:110.
const MOONSHADOW_OWNED_PRINTING: ScryfallCard = makeMockScryfallCard({
  id: 'moonshadow-ecl-386',
  oracle_id: 'moonshadow-oracle',
  illustration_id: 'moonshadow-art-a',
  name: 'Moonshadow',
  cmc: 1,
  type_line: 'Creature — Elemental',
  // build-site emits these thumbnail-less cards without oracle_text or image_uris.
  oracle_text: undefined,
  image_uris: null,
  prices: { usd: '5.00' },
  set: 'ecl',
  set_name: 'Eclipse',
  collector_number: '386',
  rarity: 'rare',
  color_identity: ['B'],
})

const MOONSHADOW_OTHER_PRINTING: ScryfallCard = {
  ...MOONSHADOW_OWNED_PRINTING,
  id: 'moonshadow-ecl-110',
  illustration_id: 'moonshadow-art-b',
  collector_number: '110',
}

// Sol Ring owned as two distinct printings — the "Card" tier must collapse these
// to one row while the "Printing" tier keeps them separate.
const SOL_RING_C16: ScryfallCard = makeMockScryfallCard({
  id: 'sol-ring-c16',
  oracle_id: 'sol-ring-oracle',
  illustration_id: 'sol-ring-art-a',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: undefined,
  image_uris: null,
  prices: { usd: '2.00' },
  set: 'c16',
  set_name: 'Commander 2016',
  collector_number: '234',
  rarity: 'uncommon',
})

const SOL_RING_LGN: ScryfallCard = {
  ...SOL_RING_C16,
  id: 'sol-ring-lgn',
  illustration_id: 'sol-ring-art-b',
  set: 'lgn',
  set_name: 'Legions',
  collector_number: '303',
}

const MOCK_QUICK_SWITCH_COLLECTION_MAIN_BINDER = {
  name: 'Main Binder',
  entries: [
    binderEntry('Lightning Bolt', 'm10', '146', 0),
    binderEntry('Mock Sanity', 'mkm', '42', 1),
    binderEntry('Moonshadow', 'ecl', '386', 2),
    binderEntry('Sol Ring', 'c16', '234', 3),
    binderEntry('Sol Ring', 'lgn', '303', 4),
  ],
  cards: {
    'm10:146': null,
    'mkm:42': null,
    'ecl:386': MOONSHADOW_OWNED_PRINTING,
    'c16:234': SOL_RING_C16,
    'lgn:303': SOL_RING_LGN,
    // Changelog-modal lookup entries (keyed by name), NOT owned entries. These
    // must never appear in the quick switch: Moonshadow points at a non-owned
    // printing, and Mistrise Village is a removed card no longer in the binder.
    Moonshadow: MOONSHADOW_OTHER_PRINTING,
    'Mistrise Village': null,
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
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_QUICK_SWITCH)
  await fulfillJson(page, '**/decks/azorius-control.json', MOCK_QUICK_SWITCH_DECK_AZORIUS)
  await fulfillJson(page, '**/decks/mono-red-aggro.json', MOCK_QUICK_SWITCH_DECK_MONO_RED)
  await fulfillJson(
    page,
    '**/collections/main-binder.json',
    MOCK_QUICK_SWITCH_COLLECTION_MAIN_BINDER,
  )
  await fulfillJson(page, '**/wanted/high-priority.json', MOCK_QUICK_SWITCH_WANTED_HIGH_PRIORITY)
}

// ===== Index toolbar lists =====

// Index with multiple decks, collections, and wanted lists, each given distinct
// names, last-updated timestamps, and prices so the shared index toolbar's sort
// orders are unambiguous. Alphabetical and price orders are deliberately
// reverses of each other to make assertions easy to read. The decks span two
// formats (Modern first alphabetically, then Commander) so format grouping has
// exact expected sections.
const MOCK_SITE_INDEX_MULTI_LISTS: SiteIndex = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'aggro-alpha',
      name: 'Aggro Alpha',
      format: 'modern',
      cardCount: 60,
      totalPrice: 100,
      totalPriceEur: 0,
      totalPriceTix: 0,
    }),
    makeDeckSummary({
      slug: 'midrange-mike',
      name: 'Midrange Mike',
      format: 'commander',
      cardCount: 100,
      totalPrice: 250,
      totalPriceEur: 0,
      totalPriceTix: 0,
    }),
    makeDeckSummary({
      slug: 'zoo-zebra',
      name: 'Zoo Zebra',
      format: 'modern',
      cardCount: 60,
      totalPrice: 500,
      totalPriceEur: 0,
      totalPriceTix: 0,
    }),
  ],
  collections: [
    makeCollectionSummary({
      slug: 'alpha-collection',
      name: 'Alpha Collection',
      cardCount: 50,
      lastUpdatedAt: '2026-05-01T00:00:00.000Z',
      totalPrice: 100,
    }),
    makeCollectionSummary({
      slug: 'mid-collection',
      name: 'Mid Collection',
      cardCount: 30,
      lastUpdatedAt: '2026-03-01T00:00:00.000Z',
      totalPrice: 250,
    }),
    makeCollectionSummary({
      slug: 'zebra-collection',
      name: 'Zebra Collection',
      cardCount: 10,
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      totalPrice: 500,
    }),
  ],
  wantedLists: [
    makeWantedListSummary({
      slug: 'acquire-a',
      name: 'Acquire A',
      cardCount: 5,
      lastUpdatedAt: '2026-05-01T00:00:00.000Z',
      totalPrice: 30,
    }),
    makeWantedListSummary({
      slug: 'need-m',
      name: 'Need M',
      cardCount: 8,
      lastUpdatedAt: '2026-03-01T00:00:00.000Z',
      totalPrice: 60,
    }),
    makeWantedListSummary({
      slug: 'wishlist-z',
      name: 'Wishlist Z',
      cardCount: 12,
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      totalPrice: 90,
    }),
  ],
})

/**
 * Mock the public site index.json with several decks, collections, and wanted
 * lists so the index toolbars can be exercised. Only index.json is
 * intercepted — these tests stay on the index page and never open a list.
 */
export async function mockPublicSiteIndexLists(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_MULTI_LISTS)
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
} satisfies DeckDetail

const MOCK_MULTISELECT_INDEX = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'test-multi-select', name: 'Multi Select Deck', cardCount: 2 })],
})

/** Serve a synthetic two-card deck for the public-site multi-select tests. */
export async function mockPublicSiteDeckForMultiSelect(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_MULTISELECT_INDEX)
  await fulfillJson(page, '**/decks/test-multi-select.json', MOCK_MULTISELECT_DECK)
}

// Two decks for cross-list selection tests. Deck A holds printing-pinned cards;
// deck B holds a single name-only card (no set/collector number) so adding it to
// a trade has to prompt for a printing. The cards carry a non-empty image (the
// tiny data-URL PNG) so the modal's hover preview has something to show (these
// decks use Scryfall URLs).
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
} satisfies DeckDetail

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
} satisfies DeckDetail

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
} satisfies DeckDetail

const MOCK_MS_INDEX = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'ms-a', name: 'MS Deck A', cardCount: 2 }),
    makeDeckSummary({ slug: 'ms-b', name: 'MS Deck B', cardCount: 1 }),
    makeDeckSummary({ slug: 'ms-qty', name: 'MS Deck Qty', cardCount: 4 }),
  ],
  useScryfallImgUrls: true,
})

/** Serve two synthetic decks (one with a name-only card) for cross-list selection tests. */
export async function mockPublicSiteMultiSelectLists(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_MS_INDEX)
  await fulfillJson(page, '**/decks/ms-a.json', MOCK_MS_DECK_A)
  await fulfillJson(page, '**/decks/ms-b.json', MOCK_MS_DECK_B)
  await fulfillJson(page, '**/decks/ms-qty.json', MOCK_MS_DECK_QTY)
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
} satisfies DeckDetail

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
} satisfies CollectionDetail

const MOCK_CV_INDEX = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'cv-deck', name: 'CV Deck', cardCount: 3, totalPrice: 8 })],
  collections: [
    makeCollectionSummary({ slug: 'cv-box', name: 'CV Box', cardCount: 1, totalPrice: 3 }),
  ],
  useScryfallImgUrls: true,
})

/** Serve a deck + collection for the combined-list-view tests. */
export async function mockPublicSiteCombinedLists(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_CV_INDEX)
  await fulfillJson(page, '**/decks/cv-deck.json', MOCK_CV_DECK)
  await fulfillJson(page, '**/collections/cv-box.json', MOCK_CV_COLLECTION)
}

// ===== Double-faced card deck =====

// A double-faced card whose front is a Creature and back is a Land. Has no
// top-level image_uris (so isDoubleFacedCard() is true) and distinct per-face
// images, exercising both the front-face grouping rule and the flip button.
const MOCK_SCRYFALL_DFC = makeMockScryfallCard({
  id: 'dfc-id',
  name: 'Werewolf Front // Werewolf Back',
  cmc: 3,
  type_line: 'Creature — Human Werewolf // Land',
  image_uris: null,
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
  prices: { usd: '2.00' },
  collector_number: '30',
  rarity: 'rare',
  color_identity: ['G'],
  edhrec_rank: 500,
})

const MOCK_SCRYFALL_PLAIN_LAND = makeMockScryfallCard({
  id: 'land-id',
  name: 'Test Wastes',
  cmc: 0,
  type_line: 'Land',
  image_uris: { normal: 'https://card-images.test/land.svg' },
  prices: { usd: '0.10' },
  collector_number: '31',
  edhrec_rank: 600,
})

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
} satisfies DeckDetail

const MOCK_SITE_INDEX_WITH_DFC_DECK = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'test-dfc-deck', name: 'Test DFC Deck', cardCount: 2 })],
  useScryfallImgUrls: true,
})

/**
 * Mock the public site JSON endpoints with a synthetic deck containing a
 * double-faced card (Creature front / Land back) alongside a plain land, for
 * testing front-face type grouping and the in-place flip button.
 */
export async function mockPublicSiteDeckWithDoubleFacedCard(page: Page): Promise<void> {
  await mockCardImageSvgs(page)
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_DFC_DECK)
  await fulfillJson(page, '**/decks/test-dfc-deck.json', MOCK_DFC_DECK)
}

// ----- Find page -----
// Exercises name-based search across a deck, a collection, and a wanted list,
// including a true double-faced card (front-face-only matching) and a double-art
// printing whose two faces share one name (`Steam Vents // Steam Vents`).
const FIND_BOLT = makeMockScryfallCard({
  id: 'find-bolt',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '1.00' },
  set: 'lea',
  collector_number: '161',
  color_identity: ['R'],
  edhrec_rank: 100,
})

const FIND_RING = makeMockScryfallCard({
  id: 'find-ring',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '1.00' },
  set: 'c19',
  collector_number: '221',
  edhrec_rank: 50,
})

const FIND_STEAM = makeMockScryfallCard({
  id: 'find-steam',
  name: 'Steam Vents',
  cmc: 1,
  type_line: 'Land — Island Mountain',
  prices: { usd: '1.00' },
  set: 'gpt',
  collector_number: '233',
  color_identity: ['U', 'R'],
  edhrec_rank: 200,
})

// A double-art printing: one physical card whose two faces share the same name.
const FIND_STEAM_DOUBLE_ART = {
  ...FIND_STEAM,
  id: 'find-steam-da',
  name: 'Steam Vents // Steam Vents',
  set: 'sld',
  collector_number: '1234',
}

// A true double-faced card: front "Bruce Banner", back "The Incredible Hulk".
const FIND_BRUCE = makeMockScryfallCard({
  id: 'find-bruce',
  name: 'Bruce Banner // The Incredible Hulk',
  cmc: 1,
  type_line: 'Legendary Creature — Human Scientist // Legendary Creature — Monster',
  image_uris: null,
  prices: { usd: '1.00' },
  set: 'mom',
  collector_number: '40',
  color_identity: ['G'],
  edhrec_rank: 300,
  card_faces: [
    {
      name: 'Bruce Banner',
      mana_cost: '{G}',
      type_line: 'Legendary Creature — Human Scientist',
      oracle_text: '',
      image_uris: { normal: 'https://card-images.test/bruce-front.svg' },
    },
    {
      name: 'The Incredible Hulk',
      mana_cost: '',
      type_line: 'Legendary Creature — Monster',
      oracle_text: '',
      image_uris: { normal: 'https://card-images.test/bruce-back.svg' },
    },
  ],
})

const FIND_COUNTER = makeMockScryfallCard({
  id: 'find-counter',
  name: 'Counterspell',
  cmc: 1,
  type_line: 'Instant',
  prices: { usd: '1.00' },
  set: 'lea',
  collector_number: '54',
  color_identity: ['U'],
  edhrec_rank: 150,
})

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
} satisfies DeckDetail

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
} satisfies CollectionDetail

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
} satisfies WantedListDetail

const FIND_INDEX = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'find-deck', name: 'Find Deck', cardCount: 3, totalPrice: 10 })],
  collections: [
    makeCollectionSummary({ slug: 'find-box', name: 'Find Box', cardCount: 2, totalPrice: 8 }),
  ],
  wantedLists: [makeWantedListSummary({ slug: 'find-wanted', name: 'Find Wanted', totalPrice: 1 })],
  useScryfallImgUrls: true,
})

/** Serve a deck + collection + wanted list for the Find page tests. */
export async function mockPublicSiteForFind(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', FIND_INDEX)
  await fulfillJson(page, '**/decks/find-deck.json', FIND_DECK)
  await fulfillJson(page, '**/collections/find-box.json', FIND_COLLECTION)
  await fulfillJson(page, '**/wanted/find-wanted.json', FIND_WANTED)
}
