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
} from '../../../src/list/site-data'
import type { Finish } from '../../../src/card/finish-condition'
import type { ScryfallCard } from '../../../src/scryfall/types'
import type { BuylistQuote } from '../../../src/buylist'
import { DEFAULT_SEARCH_DEBOUNCE_MS } from '../../../src/config/search-debounce'
import { DEFAULT_LOCALE } from '../../../src/i18n/runtime'
import { fulfillJson } from './fulfill'
import { makeCollectionEntry } from '../../fixtures/lists'
import { makeBuylistQuote } from '../../fixtures/cards'
import {
  MOCK_COLLECTION_CARD_PRICED,
  MOCK_COLLECTION_DETAIL,
  MOCK_WANTED_LIST_DETAIL,
  TINY_PNG,
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
    searchDebounceMs: DEFAULT_SEARCH_DEBOUNCE_MS,
    defaultLanguage: 'en',
    uiLocale: DEFAULT_LOCALE,
    availableLocales: [DEFAULT_LOCALE],
    // Cardmarket rides along by default so fixtures that offer EUR keep the
    // currency selectable — a currency is only offered when an enabled store
    // quotes it. Tests about the store list itself pass their own value.
    priceSources: ['tcgplayer', 'cardmarket'],
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

// ===== detail JSON builders =====

/** A deck detail payload; the boilerplate tail defaults to the common single-currency shape. */
export function makeDeckDetail(overrides: Partial<DeckDetail> = {}): DeckDetail {
  return {
    deck: { name: 'Test Deck', sections: [] },
    cards: {},
    printings: {},
    symbolMap: {},
    useScryfallImgUrls: false,
    defaultCurrency: 'usd',
    availableCurrencies: ['usd'],
    missingCards: { usd: [], eur: [], tix: [] },
    ...overrides,
  }
}

/** A collection detail payload, defaulting the boilerplate fields. */
export function makeCollectionDetail(overrides: Partial<CollectionDetail> = {}): CollectionDetail {
  return {
    name: 'Test Collection',
    entries: [],
    cards: {},
    printings: {},
    symbolMap: {},
    useScryfallImgUrls: false,
    totalPrice: 0,
    defaultCurrency: 'usd',
    ...overrides,
  }
}

/** A wanted-list detail payload, defaulting the boilerplate fields. */
export function makeWantedDetail(overrides: Partial<WantedListDetail> = {}): WantedListDetail {
  return {
    name: 'Test Wanted List',
    entries: [],
    cards: {},
    printings: {},
    symbolMap: {},
    useScryfallImgUrls: false,
    totalPrice: 0,
    defaultCurrency: 'usd',
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

const MOCK_DECK_WITH_CHANGELOG = makeDeckDetail({
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
  changelog: [
    {
      timestamp: '2025-01-15T10:00:00.000Z',
      // Typed events, as `parseChangelog` bakes them (the envelope is
      // re-synthesized from the entry header; the values here are arbitrary).
      changes: [
        {
          id: 'e1',
          timestamp: 0,
          action: 'add',
          cardName: 'Test Creature',
          cardId: 1,
          set: 'tst',
          collectorNumber: '1',
        },
        { id: 'e2', timestamp: 0, action: 'remove', cardName: 'Old Card', cardId: 2 },
        { id: 'e3', timestamp: 0, action: 'add', cardName: 'Maybe Card', board: 'Maybeboard' },
        { id: 'e4', timestamp: 0, action: 'remove', cardName: 'Side Card', board: 'Sideboard' },
        { id: 'e5', timestamp: 0, action: 'set-commander', cardName: 'New Commander' },
        { id: 'e6', timestamp: 0, action: 'unset-commander', cardName: 'Old Commander' },
        { id: 'e7', timestamp: 0, action: 'set-finish', cardName: 'Shiny Card', finish: 'foil' },
        {
          id: 'e8',
          timestamp: 0,
          action: 'set-note',
          cardName: 'Noted Card',
          note: 'great vs aggro',
        },
        { id: 'e9', timestamp: 0, action: 'set-note', cardName: 'Plain Card', note: '' },
        { id: 'e10', timestamp: 0, action: 'add-section', section: 'Foils' },
      ],
    },
    {
      timestamp: '2025-01-10T08:00:00.000Z',
      changes: [{ id: 'e0', timestamp: 0, action: 'add', cardName: 'Old Card', cardId: 2 }],
    },
  ],
})

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

const MOCK_DECK_WITH_DESCRIPTION = makeDeckDetail({
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
})

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

/**
 * An alternate printing of Test Creature sold only in foil, so it has a foil
 * price and no nonfoil one. The printings grid must quote it at the finish it
 * actually comes in rather than at a nonfoil price it doesn't have.
 */
const MOCK_SCRYFALL_CREATURE_FOIL_ONLY = makeMockScryfallCard({
  id: 'creature-foil-only-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  mana_cost: '{1}{W}',
  prices: { usd_foil: '12.00' },
  finishes: ['foil'],
  set: 'fyl',
  collector_number: '77',
  color_identity: ['W'],
  edhrec_rank: 1000,
})

/**
 * A third, markedly cheaper printing of Test Creature. The deck pins the $1.00
 * TST printing, so this is what the "Lowest Price" toggle substitutes in — the
 * price gap is how a test tells the toggle actually did something.
 */
const MOCK_SCRYFALL_CREATURE_CHEAP = makeMockScryfallCard({
  id: 'creature-cheap-id',
  name: 'Test Creature',
  cmc: 2,
  type_line: 'Creature — Human',
  mana_cost: '{1}{W}',
  prices: { usd: '0.10' },
  set: 'chp',
  collector_number: '9',
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

const MOCK_MULTI_SECTION_DECK = makeDeckDetail({
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
    'Test Creature': [
      MOCK_SCRYFALL_CREATURE,
      MOCK_SCRYFALL_CREATURE_FOIL_ONLY,
      MOCK_SCRYFALL_CREATURE_CHEAP,
    ],
    'Alpha Creature': [MOCK_SCRYFALL_CREATURE_B],
    'Test Instant': [MOCK_SCRYFALL_INSTANT],
    'Test Artifact': [MOCK_SCRYFALL_ARTIFACT],
  },
  // Present so the "Lowest Price" toolbar toggle renders at all. Only Test
  // Creature has a cheaper printing than the one the deck pins, so it is the
  // one entry whose tile visibly changes when the toggle is on.
  lowestPriceCards: {
    'Test Creature': MOCK_SCRYFALL_CREATURE_CHEAP,
    'Alpha Creature': MOCK_SCRYFALL_CREATURE_B,
    'Test Instant': MOCK_SCRYFALL_INSTANT,
    'Test Artifact': MOCK_SCRYFALL_ARTIFACT,
  },
})

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

const MOCK_SIDEWAYS_DECK = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

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

// ===== Deck with a sideboard and a maybeboard =====

/**
 * A deck whose sections span all three kinds a `.txt` download has to decide
 * about: the main deck, a sideboard (part of the decklist, written under its own
 * marker) and a maybeboard (deck-building scratch space, left out entirely).
 * Separate from `MOCK_MULTI_SECTION_DECK` so the card counts every other spec
 * asserts against that one stay put.
 */
const MOCK_SIDEBOARD_DECK = makeDeckDetail({
  deck: {
    name: 'Test Sideboard Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Test Creature', set: 'tst', collectorNumber: '1', cardId: 1 },
        ],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 2, name: 'Test Instant', set: 'tst', collectorNumber: '2', cardId: 2 }],
      },
      {
        name: 'Maybeboard',
        cards: [
          { quantity: 1, name: 'Test Artifact', set: 'tst', collectorNumber: '3', cardId: 3 },
        ],
      },
    ],
  },
  cards: {
    'Test Creature': MOCK_SCRYFALL_CREATURE,
    'Test Instant': MOCK_SCRYFALL_INSTANT,
    'Test Artifact': MOCK_SCRYFALL_ARTIFACT,
  },
  printings: {
    'Test Creature': [MOCK_SCRYFALL_CREATURE],
    'Test Instant': [MOCK_SCRYFALL_INSTANT],
    'Test Artifact': [MOCK_SCRYFALL_ARTIFACT],
  },
})

const MOCK_SITE_INDEX_WITH_SIDEBOARD_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'test-sideboard-deck',
      name: 'Test Sideboard Deck',
      // Quantity sum (1 + 2 + 1), matching every other fixture in this file.
      cardCount: 4,
    }),
  ],
})

/** Mock the public site with a deck carrying a sideboard and a maybeboard. */
export async function mockPublicSiteDeckWithSideboard(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_SIDEBOARD_DECK)
  await fulfillJson(page, '**/decks/test-sideboard-deck.json', MOCK_SIDEBOARD_DECK)
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
const MOCK_COLLECTION_DUP_DETAIL = makeCollectionDetail({
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
  totalPrice: 7.0,
})

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

// ===== Collections with card labels (sale / trade / keep) =====

/** One synthetic printing per labeled entry, keyed by a unique set:cn. */
function makeLabelCard(name: string, collectorNumber: string): ScryfallCard {
  return makeMockScryfallCard({
    id: `label-${collectorNumber}`,
    name,
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '1.00' },
    set: 'tst',
    collector_number: collectorNumber,
  })
}

function makeLabelEntry(
  name: string,
  collectorNumber: string,
  fileOrder: number,
  labels?: CollectionDetail['labels'],
): CollectionCardEntry {
  return makeCollectionEntry({
    name,
    collectorNumber,
    labels,
    price: 1.0,
    fileOrder,
    cardId: fileOrder + 1,
  })
}

// Every chip is testable on one page: each label appears as an override, plus
// one unlabeled card. No list default, so every badge here is an override.
const MOCK_LABEL_BINDER_DETAIL = makeCollectionDetail({
  name: 'Label Binder',
  entries: [
    makeLabelEntry('Sale Card', '1', 0, ['sale']),
    makeLabelEntry('Trade Card', '2', 1, ['trade']),
    makeLabelEntry('Keep Card', '3', 2, ['keep']),
    makeLabelEntry('Plain Card', '4', 3),
  ],
  cards: {
    'tst:1': makeLabelCard('Sale Card', '1'),
    'tst:2': makeLabelCard('Trade Card', '2'),
    'tst:3': makeLabelCard('Keep Card', '3'),
    'tst:4': makeLabelCard('Plain Card', '4'),
  },
  totalPrice: 4.0,
})

// A list-level default (`sale, trade`) with one keep override — proves the
// default resolves end-to-end and that tiles badge overrides only.
const MOCK_SALE_BINDER_DETAIL = makeCollectionDetail({
  name: 'Sale Binder',
  labels: ['sale', 'trade'],
  entries: [makeLabelEntry('Default Card', '5', 0), makeLabelEntry('Keeper', '6', 1, ['keep'])],
  cards: {
    'tst:5': makeLabelCard('Default Card', '5'),
    'tst:6': makeLabelCard('Keeper', '6'),
  },
  totalPrice: 2.0,
})

const MOCK_SITE_INDEX_FOR_LABELS = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'label-binder',
      name: 'Label Binder',
      cardCount: 4,
      totalPrice: 4.0,
    }),
    makeCollectionSummary({
      slug: 'sale-binder',
      name: 'Sale Binder',
      cardCount: 2,
      totalPrice: 2.0,
      labels: ['sale', 'trade'],
    }),
  ],
})

/** Mock two labeled collections for the labels filter / badge / index-dropdown tests. */
export async function mockPublicSiteCollectionsForLabels(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_LABELS)
  await fulfillJson(page, '**/collections/label-binder.json', MOCK_LABEL_BINDER_DETAIL)
  await fulfillJson(page, '**/collections/sale-binder.json', MOCK_SALE_BINDER_DETAIL)
}

// ===== Collection with card tags =====

/** One synthetic printing per tagged entry, keyed by a unique set:cn. */
function makeTagCard(name: string, collectorNumber: string): ScryfallCard {
  return makeMockScryfallCard({
    id: `tag-${collectorNumber}`,
    name,
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '1.00' },
    set: 'tst',
    collector_number: collectorNumber,
  })
}

function makeTagEntry(
  name: string,
  collectorNumber: string,
  fileOrder: number,
  tags?: CollectionCardEntry['tags'],
): CollectionCardEntry {
  return makeCollectionEntry({
    name,
    collectorNumber,
    tags,
    price: 1.0,
    fileOrder,
    cardId: fileOrder + 1,
  })
}

// Every tag-set shape on one page: single tags, a two-tag set, and an untagged card.
const MOCK_TAG_BINDER_DETAIL = makeCollectionDetail({
  name: 'Tag Binder',
  entries: [
    makeTagEntry('Ramp Rock', '1', 0, ['ramp']),
    makeTagEntry('Staple Rock', '2', 1, ['ramp', 'staple']),
    makeTagEntry('Draw Spell', '3', 2, ['Card Draw']),
    makeTagEntry('Plain Card', '4', 3),
  ],
  cards: {
    'tst:1': makeTagCard('Ramp Rock', '1'),
    'tst:2': makeTagCard('Staple Rock', '2'),
    'tst:3': makeTagCard('Draw Spell', '3'),
    'tst:4': makeTagCard('Plain Card', '4'),
  },
  totalPrice: 4.0,
})

const MOCK_SITE_INDEX_FOR_TAGS = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'tag-binder',
      name: 'Tag Binder',
      cardCount: 4,
      totalPrice: 4.0,
    }),
  ],
})

/** Mock one tagged collection for the tags grouping / sort / modal / editor tests. */
export async function mockPublicSiteCollectionWithTags(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_TAGS)
  await fulfillJson(page, '**/collections/tag-binder.json', MOCK_TAG_BINDER_DETAIL)
}

// ===== Collection with card categories =====

function makeCategoryEntry(
  name: string,
  collectorNumber: string,
  fileOrder: number,
  categories?: string[],
): CollectionCardEntry {
  return makeCollectionEntry({
    name,
    collectorNumber,
    ...(categories ? { categories } : {}),
    price: 1.0,
    fileOrder,
    cardId: fileOrder + 1,
  })
}

// Every shape the two groupings have to render: a single-category card, a
// two-category card (which the "Categories" grouping shows twice, dimmed under
// its non-primary one), a card in a third category, and an uncategorized card.
const MOCK_CATEGORY_BINDER_DETAIL = makeCollectionDetail({
  name: 'Category Binder',
  entries: [
    makeCategoryEntry('Ramp Rock', '1', 0, ['Ramp']),
    makeCategoryEntry('Signet Rock', '2', 1, ['Ramp', 'Artifacts']),
    makeCategoryEntry('Draw Spell', '3', 2, ['Draw']),
    makeCategoryEntry('Plain Card', '4', 3),
  ],
  cards: {
    'tst:1': makeTagCard('Ramp Rock', '1'),
    'tst:2': makeTagCard('Signet Rock', '2'),
    'tst:3': makeTagCard('Draw Spell', '3'),
    'tst:4': makeTagCard('Plain Card', '4'),
  },
  categories: {
    order: ['Ramp', 'Draw', 'Artifacts'],
    cards: {
      'Ramp Rock': ['Ramp'],
      'Signet Rock': ['Ramp', 'Artifacts'],
      'Draw Spell': ['Draw'],
    },
  },
  totalPrice: 4.0,
})

/**
 * The configured vocabulary baked into `index.json`. `Board Wipes` is
 * deliberately a name the list itself never uses, so the dialog offering it
 * proves the bake reached the editor's suggestions.
 */
export const MOCK_SITE_DEFAULT_CATEGORY = 'Board Wipes'

const MOCK_SITE_INDEX_FOR_CATEGORIES = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'category-binder',
      name: 'Category Binder',
      cardCount: 4,
      totalPrice: 4.0,
    }),
  ],
  defaultCategories: [MOCK_SITE_DEFAULT_CATEGORY],
})

/** Mock one categorized collection for the categories grouping / filter / editor tests. */
export async function mockPublicSiteCollectionWithCategories(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_CATEGORIES)
  await fulfillJson(page, '**/collections/category-binder.json', MOCK_CATEGORY_BINDER_DETAIL)
}

// Two lines of ONE card name, so a removal that leaves the other line behind can
// be told apart from the one that takes the list's last line of that name — the
// name-keyed `set-categories` fold the editors run.
const MOCK_DUPLICATE_CATEGORY_BINDER_DETAIL = makeCollectionDetail({
  name: 'Duplicate Binder',
  entries: [
    makeCategoryEntry('Ramp Rock', '1', 0, ['Ramp']),
    makeCategoryEntry('Ramp Rock', '2', 1, ['Ramp']),
    makeCategoryEntry('Draw Spell', '3', 2, ['Draw']),
  ],
  cards: {
    'tst:1': makeTagCard('Ramp Rock', '1'),
    'tst:2': makeTagCard('Ramp Rock', '2'),
    'tst:3': makeTagCard('Draw Spell', '3'),
  },
  categories: {
    order: ['Ramp', 'Draw'],
    cards: { 'Ramp Rock': ['Ramp'], 'Draw Spell': ['Draw'] },
  },
  totalPrice: 3.0,
})

const MOCK_SITE_INDEX_FOR_DUPLICATE_CATEGORIES = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'duplicate-binder',
      name: 'Duplicate Binder',
      cardCount: 3,
      totalPrice: 3.0,
    }),
  ],
  defaultCategories: [MOCK_SITE_DEFAULT_CATEGORY],
})

/** Mock the two-lines-of-one-name collection used by the fold spec. */
export async function mockPublicSiteCollectionWithDuplicateNames(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_DUPLICATE_CATEGORIES)
  await fulfillJson(
    page,
    '**/collections/duplicate-binder.json',
    MOCK_DUPLICATE_CATEGORY_BINDER_DETAIL,
  )
}

// A deck whose mainboard AND sideboard both hold categorized cards: only the
// mainboard is grouped by category (the boards are partitioned before grouping),
// so the sideboard must stay its own ungrouped section.
const MOCK_CATEGORY_DECK_DETAIL = makeDeckDetail({
  deck: {
    name: 'Category Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Ramp Rock', set: 'tst', collectorNumber: '1', cardId: 1 },
          { quantity: 1, name: 'Plain Card', set: 'tst', collectorNumber: '4', cardId: 2 },
        ],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Draw Spell', set: 'tst', collectorNumber: '3', cardId: 3 }],
      },
    ],
  },
  cards: {
    'Ramp Rock': makeTagCard('Ramp Rock', '1'),
    'Plain Card': makeTagCard('Plain Card', '4'),
    'Draw Spell': makeTagCard('Draw Spell', '3'),
  },
  printings: {},
  categories: {
    order: ['Ramp', 'Draw'],
    cards: { 'Ramp Rock': ['Ramp'], 'Draw Spell': ['Draw'] },
  },
})

const MOCK_SITE_INDEX_FOR_CATEGORY_DECK = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'category-deck', name: 'Category Deck' })],
  defaultCategories: [MOCK_SITE_DEFAULT_CATEGORY],
})

/** Mock a deck whose mainboard and sideboard both carry categories. */
export async function mockPublicSiteDeckWithCategories(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_CATEGORY_DECK)
  await fulfillJson(page, '**/decks/category-deck.json', MOCK_CATEGORY_DECK_DETAIL)
}

// ===== Deck with a proxy and custom art =====

/** The baked `customArt` of the deck's proxy card — a site-relative art path. */
export const MOCK_DECK_ART_PATH = 'art/proxies/bolt.png'

/** Every deck card carries the same printing price, so the total tells them apart. */
function makeProxyDeckCard(name: string, collectorNumber: string): ScryfallCard {
  return withImage(
    makeMockScryfallCard({
      id: `proxy-deck-${collectorNumber}`,
      name,
      cmc: 1,
      type_line: 'Artifact',
      prices: { usd: '10.00' },
      set: 'tst',
      collector_number: collectorNumber,
    }),
  )
}

const MOCK_PROXY_DECK_REAL = makeProxyDeckCard('Real Ring', '20')
const MOCK_PROXY_DECK_PROXY = makeProxyDeckCard('Proxy Bolt', '21')
const MOCK_PROXY_DECK_PLAIN_PROXY = makeProxyDeckCard('Plain Proxy', '22')

// All three cards price at $10, and only the real one counts: the deck total is
// the observable that separates "the client zeroed the priceless copies" from
// "the bake did", since the tile prices come straight off the printing. Two
// flavours of priceless are present on purpose — `Proxy Bolt` is a proxy that
// also wears custom art (so its marker must read CUSTOM, the winning reason),
// while `Plain Proxy` carries the label alone (PROXY).
const MOCK_PROXY_DECK = makeDeckDetail({
  deck: {
    name: 'Proxy Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Real Ring', set: 'tst', collectorNumber: '20', cardId: 1 },
          {
            quantity: 1,
            name: 'Proxy Bolt',
            set: 'tst',
            collectorNumber: '21',
            cardId: 2,
            labels: ['proxy'],
            customArt: MOCK_DECK_ART_PATH,
          },
          {
            quantity: 1,
            name: 'Plain Proxy',
            set: 'tst',
            collectorNumber: '22',
            cardId: 3,
            labels: ['proxy'],
          },
        ],
      },
    ],
  },
  cards: {
    'Real Ring': MOCK_PROXY_DECK_REAL,
    'Proxy Bolt': MOCK_PROXY_DECK_PROXY,
    'Plain Proxy': MOCK_PROXY_DECK_PLAIN_PROXY,
  },
  printings: { 'Proxy Bolt': [MOCK_PROXY_DECK_PROXY] },
})

const MOCK_SITE_INDEX_WITH_PROXY_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'proxy-deck', name: 'Proxy Deck', cardCount: 3, totalPrice: 10 }),
  ],
})

/**
 * Serve every `art/…` request a real (1×1) PNG, standing in for the files a
 * built site copies into `dist/art/`. Without it the custom-art `<img>` would
 * 404 and the spec could not tell "pointed at the art" from "rendered nothing".
 */
export async function mockCustomArtFiles(page: Page): Promise<void> {
  const body = Buffer.from(TINY_PNG.slice(TINY_PNG.indexOf(',') + 1), 'base64')
  await page.route('**/art/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body }),
  )
}

/**
 * Mock a synthetic deck holding one ordinary card, one `[proxy]` card that also
 * carries custom art, and one plain `[proxy]` — the deck-side label surfaces
 * (badge, chips, the zero-price rule), both priceless markers, and the
 * custom-art image override in one payload.
 */
export async function mockPublicSiteProxyDeck(page: Page): Promise<void> {
  await mockCustomArtFiles(page)
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_PROXY_DECK)
  await fulfillJson(page, '**/decks/proxy-deck.json', MOCK_PROXY_DECK)
}

// ===== Collection whose custom-art file the build could not deploy =====

/**
 * Two identical $10 printings, one of which the art sidecar claims. Only the
 * *claim* is baked (`hasCustomArt`) — no `customArt` URL — which is exactly what
 * a build produces for a reference whose image file it could not copy: the card
 * shows its real printing and is priceless all the same.
 */
const MOCK_GHOST_ART_DETAIL = makeCollectionDetail({
  name: 'Ghost Art Binder',
  entries: [
    makeCollectionEntry({
      name: 'Ghost Art',
      collectorNumber: '30',
      price: 0,
      fileOrder: 0,
      cardId: 1,
      hasCustomArt: true,
    }),
    makeCollectionEntry({
      name: 'Real Card',
      collectorNumber: '31',
      price: 10,
      fileOrder: 1,
      cardId: 2,
    }),
  ],
  cards: {
    'tst:30': makeMockScryfallCard({
      id: 'ghost-30',
      name: 'Ghost Art',
      cmc: 1,
      type_line: 'Artifact',
      prices: { usd: '10.00' },
      set: 'tst',
      collector_number: '30',
    }),
    'tst:31': makeMockScryfallCard({
      id: 'ghost-31',
      name: 'Real Card',
      cmc: 1,
      type_line: 'Artifact',
      prices: { usd: '10.00' },
      set: 'tst',
      collector_number: '31',
    }),
  },
  totalPrice: 10,
})

const MOCK_SITE_INDEX_WITH_GHOST_ART = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'ghost-art-binder',
      name: 'Ghost Art Binder',
      cardCount: 2,
      totalPrice: 10,
    }),
  ],
})

/** Mock a collection holding one card whose custom-art file was never deployed. */
export async function mockPublicSiteCollectionWithUndeployedArt(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_GHOST_ART)
  await fulfillJson(page, '**/collections/ghost-art-binder.json', MOCK_GHOST_ART_DETAIL)
}

// ===== Sell mode (Card Kingdom buylist) =====

/** One synthetic printing per sell-mode entry, keyed by a unique set:cn. */
function makeSellCard(name: string, collectorNumber: string, usd: string): ScryfallCard {
  return makeMockScryfallCard({
    id: `sell-${collectorNumber}`,
    name,
    cmc: 2,
    type_line: 'Artifact',
    prices: { usd },
    set: 'tst',
    collector_number: collectorNumber,
  })
}

function makeSellEntry(
  name: string,
  collectorNumber: string,
  fileOrder: number,
  price: number,
): CollectionCardEntry {
  return makeCollectionEntry({
    name,
    collectorNumber,
    price,
    fileOrder,
    cardId: fileOrder + 1,
  })
}

/**
 * Every quote the stub buyer knows, keyed exactly as a build bakes them.
 * `tst:3` is deliberately absent — a printing the buyer has no product for is
 * omitted, not zero-priced.
 */
const MOCK_BUYLIST_CATALOG: Record<string, BuylistQuote> = {
  'tst:1:nonfoil': makeBuylistQuote({ name: 'Bought Card' }),
  // The paused offer: a published price the buyer is not taking today.
  'tst:2:nonfoil': makeBuylistQuote({
    priceBuy: 9,
    qtyBuying: 0,
    priceRetail: 18,
    qtyRetail: 0,
    buying: false,
    productId: 2,
    name: 'Paused Card',
  }),
}

/**
 * The feed the build quoted against; staleness is derived from it in the
 * browser. `feedRetrievedAt` is relative so the fixture stays *fresh* — a
 * wall-clock literal would make every sell-mode run observe the stale state
 * only, and the gap would widen with time.
 */
const MOCK_BAKED_FEED = {
  feedCreatedAt: '2026-08-04 06:06:09',
  feedRetrievedAt: Date.now() - 60_000,
} as const

/**
 * Three cards covering every buylist outcome the UI must render: an active
 * offer, an offer the buyer has paused (a published price they are not taking
 * today, which reads as "not on the buylist"), and a card the buyer does not
 * stock at all. The paused one is what separates "on the buylist" meaning
 * *actively buying* from the retired "their catalog lists it".
 */
const MOCK_SELL_BINDER_DETAIL = makeCollectionDetail({
  name: 'Sell Binder',
  entries: [
    makeSellEntry('Bought Card', '1', 0, 10),
    makeSellEntry('Paused Card', '2', 1, 20),
    makeSellEntry('Unlisted Card', '3', 2, 30),
  ],
  cards: {
    'tst:1': makeSellCard('Bought Card', '1', '10.00'),
    'tst:2': makeSellCard('Paused Card', '2', '20.00'),
    'tst:3': makeSellCard('Unlisted Card', '3', '30.00'),
  },
  totalPrice: 60.0,
  // The offers a `--sell-mode` build bakes into the list itself. This is the
  // whole fixture: the site below has no backend to ask.
  buylist: { cardkingdom: { quotes: MOCK_BUYLIST_CATALOG, ...MOCK_BAKED_FEED } },
})

// No `apiBaseUrl`: a plain static build, which is exactly where baked quotes
// have to work. One factory for every sell-binder fixture, so its index
// summary cannot drift between the sell-mode and price-source helpers.
function makeSellBinderIndex(overrides: Partial<SiteIndex> = {}): SiteIndex {
  return makeSiteIndex({
    collections: [
      makeCollectionSummary({
        slug: 'sell-binder',
        name: 'Sell Binder',
        cardCount: 3,
        totalPrice: 60.0,
      }),
    ],
    ...overrides,
  })
}

/**
 * Fail every buylist route: both sell-binder fixtures are static builds whose
 * quotes are baked, so a request reaching the API at all is the regression.
 */
async function stubBuylistApiUnreachable(page: Page, watch?: BuylistApiWatch): Promise<void> {
  await fulfillJson(
    page,
    '**/api/buylist/**',
    (route) => {
      watch?.requests.push(route.request().url())
      return { error: 'the public site must not call the quote API' }
    },
    { status: 500 },
  )
}

// `sellMode: true` is the capability flag the build stamps.
const MOCK_SITE_INDEX_FOR_SELL = makeSellBinderIndex({ sellMode: true })

/**
 * Mock a static site whose config enables **both USD price stores** but not
 * sell mode: the price-source selector must appear on its own, quotes must
 * seed for the Card Kingdom view without the sell toggle, and the buylist
 * routes must stay uncalled. Reuses the sell binder detail — its baked quotes
 * carry `priceRetail` (8 for the bought card, 18 for the paused one; the
 * unlisted card has no quote at all).
 */
export async function mockPublicSiteCollectionForPriceSources(
  page: Page,
  options: { priceSources?: SiteIndex['priceSources'] } = {},
): Promise<void> {
  const index = makeSellBinderIndex({
    priceSources: options.priceSources ?? ['tcgplayer', 'cardkingdom'],
  })
  await fulfillJson(page, '**/index.json', index)
  await fulfillJson(page, '**/collections/sell-binder.json', MOCK_SELL_BINDER_DETAIL)
  await stubBuylistApiUnreachable(page)
}

// ===== Card Kingdom printing picks (deck) =====

/**
 * A deck whose one card names no printing, so the build picks one for it — and
 * the two stores pick differently. Scryfall's pick (`tst:1`, $10) is a printing
 * Card Kingdom does not stock at all; CK's own pick (`ckp:2`) is the printing it
 * sells, at $3 retail.
 *
 * That asymmetry is the whole fixture: under Card Kingdom the row can only read
 * $3.00 if the *printing* swapped with the source. Reading N/A would mean the
 * page kept the TCGplayer pick and priced a card CK never carried.
 */
const MOCK_DECK_CK_SCRYFALL_PICK = withImage(
  makeMockScryfallCard({
    id: 'ck-pick-scryfall',
    name: 'Split Pick',
    set: 'tst',
    collector_number: '1',
    prices: { usd: '10.00' },
  }),
)

const MOCK_DECK_CK_KINGDOM_PICK = withImage(
  makeMockScryfallCard({
    id: 'ck-pick-kingdom',
    name: 'Split Pick',
    set: 'ckp',
    collector_number: '2',
    prices: { usd: '12.00' },
  }),
)

/** CK's *cheapest* printing — a third set, so the Lowest Price map is separately observable. */
const MOCK_DECK_CK_KINGDOM_CHEAPEST = withImage(
  makeMockScryfallCard({
    id: 'ck-pick-cheapest',
    name: 'Split Pick',
    set: 'ckc',
    collector_number: '3',
    prices: { usd: '9.00' },
  }),
)

/**
 * A printing sold in both finishes, so the card modal's grid and the printing
 * pickers have alternate finishes to list underneath the main price — in both
 * stores, at different money.
 */
const MOCK_DECK_CK_DUAL_FINISH = withImage(
  makeMockScryfallCard({
    id: 'ck-pick-dual',
    name: 'Split Pick',
    set: 'dfn',
    collector_number: '4',
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '5.00', usd_foil: '20.00' },
  }),
)

/**
 * One Card Kingdom quote for the price-sources deck, so the fixture's four
 * offers read as four numbers rather than four eleven-line literals. The buyer
 * fields that never vary between them are filled in here.
 */
function ckQuote(fields: {
  productId: number
  edition: string
  finish: Finish
  priceBuy: number
  priceRetail: number
}): BuylistQuote {
  return makeBuylistQuote({ ...fields, qtyBuying: 4, qtyRetail: 4, name: 'Split Pick' })
}

const MOCK_DECK_FOR_PRICE_SOURCES = makeDeckDetail({
  deck: {
    name: 'Split Pick Deck',
    sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Split Pick' }] }],
  },
  cards: { 'Split Pick': MOCK_DECK_CK_SCRYFALL_PICK },
  printings: {
    'Split Pick': [
      MOCK_DECK_CK_SCRYFALL_PICK,
      MOCK_DECK_CK_KINGDOM_PICK,
      MOCK_DECK_CK_KINGDOM_CHEAPEST,
      MOCK_DECK_CK_DUAL_FINISH,
    ],
  },
  cardsCardKingdom: { 'Split Pick': MOCK_DECK_CK_KINGDOM_PICK },
  lowestPriceCards: { 'Split Pick': MOCK_DECK_CK_SCRYFALL_PICK },
  lowestPriceCardsCardKingdom: { 'Split Pick': MOCK_DECK_CK_KINGDOM_CHEAPEST },
  buylist: {
    cardkingdom: {
      quotes: {
        'ckp:2:nonfoil': ckQuote({
          productId: 9,
          edition: 'CK Printing',
          finish: 'nonfoil',
          priceBuy: 1,
          priceRetail: 3,
        }),
        'dfn:4:nonfoil': ckQuote({
          productId: 11,
          edition: 'CK Dual Finish',
          finish: 'nonfoil',
          priceBuy: 2,
          priceRetail: 4,
        }),
        'dfn:4:foil': ckQuote({
          productId: 12,
          edition: 'CK Dual Finish',
          finish: 'foil',
          priceBuy: 8,
          priceRetail: 15,
        }),
        'ckc:3:nonfoil': ckQuote({
          productId: 10,
          edition: 'CK Cheapest Printing',
          finish: 'nonfoil',
          priceBuy: 0.5,
          priceRetail: 1.5,
        }),
      },
      ...MOCK_BAKED_FEED,
    },
  },
})

/**
 * Mock a static site offering both USD stores, whose deck's name-only card has a
 * different representative printing per store.
 */
export async function mockPublicSiteDeckForPriceSources(
  page: Page,
  options: { priceSources?: SiteIndex['priceSources'] } = {},
): Promise<BuylistApiWatch> {
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [makeDeckSummary({ slug: 'split-pick-deck', name: 'Split Pick Deck', cardCount: 1 })],
      priceSources: options.priceSources ?? ['tcgplayer', 'cardkingdom'],
    }),
  )
  await fulfillJson(page, '**/decks/split-pick-deck.json', MOCK_DECK_FOR_PRICE_SOURCES)
  // Returned so a test can assert the count: the printing pickers quote on
  // demand where a backend exists, and a *static* site must instead read the
  // quotes its detail carries baked. A request reaching here is that regression.
  const watch: BuylistApiWatch = { requests: [] }
  await stubBuylistApiUnreachable(page, watch)
  return watch
}

/** Quote-API requests a run made. The public site must make none of them. */
export type BuylistApiWatch = {
  /** URLs of every intercepted request, in order. */
  requests: string[]
}

/** Options for {@link mockPublicSiteCollectionForSell}. */
export type SellMockOptions = {
  /**
   * Whether the collection detail carries a `buylist` field at all. `false`
   * models a site built with sell mode on but no buyer feed available: the
   * toggle is still offered (that is `index.json`'s call), and the page must
   * explain the gap rather than read every card as declined.
   */
  baked?: boolean
}

/**
 * Mock a static, sell-mode-enabled site whose one collection carries baked
 * quotes.
 *
 * Every buylist route is intercepted and failed rather than answered: the
 * public site reads its offers from the detail payload, so a request reaching
 * here at all is the regression this fixture exists to catch — the returned
 * watch is what a test asserts on, and the 500 makes the page visibly wrong if
 * one is ever issued.
 */
export async function mockPublicSiteCollectionForSell(
  page: Page,
  options: SellMockOptions = {},
): Promise<BuylistApiWatch> {
  const watch: BuylistApiWatch = { requests: [] }
  const detail: CollectionDetail = { ...MOCK_SELL_BINDER_DETAIL }
  // Absent, not empty: an empty `quotes` map means the buyer declined every
  // card, which is a different thing to say.
  if (options.baked === false) delete detail.buylist
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_FOR_SELL)
  await fulfillJson(page, '**/collections/sell-binder.json', detail)
  await stubBuylistApiUnreachable(page, watch)
  return watch
}

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

/**
 * Every card name in the filter deck, derived from the fixture so an added card
 * can never leave a spec's "nothing is filtered out" expectation behind.
 * 'Maybe Dragon' is the Maybeboard (extras) card; the rest are mainboard.
 */
export const FILTER_DECK_CARDS = MOCK_FILTER_CARDS.map((card) => card.name)

const MOCK_FILTER_DECK = makeDeckDetail({
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
  availableCurrencies: ['usd', 'eur'],
})

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

// ===== Deck-section pricing fixture =====

/**
 * One card per deck zone, at prices no two of which can be confused for a sum of
 * the others. Only the three "Green" ones match a `green` name filter, so a
 * filtered figure says exactly which zones the page counts:
 *
 * - Commander ($100) is *pinned* — the deck's identity, which filters never touch.
 * - Mainboard is what the filters narrow ($10 green stays, $1 blue goes).
 * - Sideboard ($20 green) is filtered like the mainboard but rendered apart, and
 *   still counts toward the deck's money.
 * - Maybeboard ($1000 green) is an extra: it matches the filter and must *still*
 *   be excluded, which is why its price dwarfs the rest.
 */
const MOCK_ZONE_CARDS = [
  makeMockScryfallCard({
    id: 'zone-commander',
    name: 'Zone Commander',
    cmc: 4,
    type_line: 'Legendary Creature — Elder Dragon',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '20',
    prices: { usd: '100.00' },
  }),
  makeMockScryfallCard({
    id: 'zone-main-green',
    name: 'Zone Main Green',
    cmc: 2,
    type_line: 'Creature — Elf',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '21',
    prices: { usd: '10.00' },
  }),
  makeMockScryfallCard({
    id: 'zone-main-blue',
    name: 'Zone Main Blue',
    cmc: 2,
    type_line: 'Creature — Merfolk',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '22',
    prices: { usd: '1.00' },
  }),
  makeMockScryfallCard({
    id: 'zone-side-green',
    name: 'Zone Side Green',
    cmc: 3,
    type_line: 'Instant',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '23',
    prices: { usd: '20.00' },
  }),
  makeMockScryfallCard({
    id: 'zone-maybe-green',
    name: 'Zone Maybe Green',
    cmc: 6,
    type_line: 'Sorcery',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '24',
    prices: { usd: '1000.00' },
  }),
]

const zoneLine = (card: ScryfallCard, cardId: number) => ({
  quantity: 1,
  name: card.name,
  set: card.set,
  collectorNumber: card.collector_number,
  cardId,
})

const MOCK_ZONE_DECK = makeDeckDetail({
  deck: {
    name: 'Test Zone Deck',
    sections: [
      { name: 'Commander', cards: [zoneLine(MOCK_ZONE_CARDS[0]!, 1)] },
      { name: 'Main', cards: [zoneLine(MOCK_ZONE_CARDS[1]!, 2), zoneLine(MOCK_ZONE_CARDS[2]!, 3)] },
      { name: 'Sideboard', cards: [zoneLine(MOCK_ZONE_CARDS[3]!, 4)] },
      { name: 'Maybeboard', cards: [zoneLine(MOCK_ZONE_CARDS[4]!, 5)] },
    ],
  },
  cards: Object.fromEntries(MOCK_ZONE_CARDS.map((card) => [card.name, card])),
  printings: Object.fromEntries(MOCK_ZONE_CARDS.map((card) => [card.name, [card]])),
})

const MOCK_SITE_INDEX_WITH_ZONE_DECK = makeSiteIndex({
  decks: [
    makeDeckSummary({
      slug: 'test-zone-deck',
      name: 'Test Zone Deck',
      cardCount: MOCK_ZONE_CARDS.length,
    }),
  ],
})

/**
 * Mock the public site with {@link MOCK_ZONE_CARDS}: a deck holding one card in
 * each of the four zones the deck page treats differently when it adds up money.
 */
export async function mockPublicSiteDeckWithZones(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_ZONE_DECK)
  await fulfillJson(page, '**/decks/test-zone-deck.json', MOCK_ZONE_DECK)
}

/**
 * Two printings of one name, each a one-of, one nonfoil and one foil. The three
 * copies match modes give this deck three different answers — 2 copies together
 * under Name, 1 each under Number and Exact — which the filter deck above (one
 * printing per name) cannot express.
 */
const MOCK_COPIES_PRINTINGS = [
  makeMockScryfallCard({
    id: 'copies-bolt-a',
    name: 'Split Bolt',
    cmc: 1,
    type_line: 'Instant',
    mana_cost: '{R}',
    set: 'tsa',
    set_name: 'Test Set A',
    collector_number: '10',
    color_identity: ['R'],
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '1.00' },
  }),
  makeMockScryfallCard({
    id: 'copies-bolt-b',
    name: 'Split Bolt',
    cmc: 1,
    type_line: 'Instant',
    mana_cost: '{R}',
    set: 'tsb',
    set_name: 'Test Set B',
    collector_number: '11',
    color_identity: ['R'],
    finishes: ['nonfoil', 'foil'],
    prices: { usd: '2.00' },
  }),
]

const MOCK_COPIES_DECK = makeDeckDetail({
  deck: {
    name: 'Test Copies Deck',
    sections: [
      {
        name: 'Main',
        cards: MOCK_COPIES_PRINTINGS.map((card, i) => ({
          quantity: 1,
          name: card.name,
          set: card.set,
          collectorNumber: card.collector_number,
          // The second printing is foil, so Exact separates it from the first
          // even when Number has already put them in different buckets.
          finish: i === 0 ? 'nonfoil' : 'foil',
          cardId: i + 1,
        })),
      },
    ],
  },
  cards: { 'Split Bolt': MOCK_COPIES_PRINTINGS[0]! },
  printings: { 'Split Bolt': MOCK_COPIES_PRINTINGS },
})

// ===== Share filters (cross-list) mock data =====

/** One synthetic printing per share-filter card, keyed by a unique tst:cn. */
function makeShareCard(name: string, collectorNumber: string): ScryfallCard {
  return makeMockScryfallCard({
    id: `share-${collectorNumber}`,
    name,
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: '1.00' },
    set: 'tst',
    collector_number: collectorNumber,
  })
}

const MOCK_SHARE_CARD_ONLY = makeShareCard('Only Alpha', '40')
const MOCK_SHARE_CARD_SHARED = makeShareCard('Shared Card', '41')
const MOCK_SHARE_CARD_EXTRA = makeShareCard('Alpha Extra', '42')
// A second printing of "Shared Card" (same name, different collector number),
// held by collection Gamma — so the Name/Printing identity toggle can disagree:
// Gamma matches Alpha's copy by name but not by printing.
const MOCK_SHARE_CARD_SHARED_ALT = makeShareCard('Shared Card', '43')

/** Every card name in the share-filter deck "Alpha", for whole-list assertions. */
export const SHARE_FILTER_DECK_CARDS = [
  MOCK_SHARE_CARD_ONLY.name,
  MOCK_SHARE_CARD_SHARED.name,
  MOCK_SHARE_CARD_EXTRA.name,
]

// The viewed deck: three distinct cards, one of which ("Shared Card") also
// lives in deck "Beta" and collection "Gamma" below.
const MOCK_SHARE_DECK_ALPHA = makeDeckDetail({
  deck: {
    name: 'Alpha',
    sections: [
      {
        name: 'Main',
        cards: [MOCK_SHARE_CARD_ONLY, MOCK_SHARE_CARD_SHARED, MOCK_SHARE_CARD_EXTRA].map(
          (card, i) => ({
            quantity: 1,
            name: card.name,
            set: card.set,
            collectorNumber: card.collector_number,
            cardId: i + 1,
          }),
        ),
      },
    ],
  },
  cards: Object.fromEntries(
    [MOCK_SHARE_CARD_ONLY, MOCK_SHARE_CARD_SHARED, MOCK_SHARE_CARD_EXTRA].map((c) => [c.name, c]),
  ),
})

const MOCK_SHARE_DECK_BETA = makeDeckDetail({
  deck: {
    name: 'Beta',
    sections: [
      {
        name: 'Main',
        cards: [
          {
            quantity: 1,
            name: MOCK_SHARE_CARD_SHARED.name,
            set: MOCK_SHARE_CARD_SHARED.set,
            collectorNumber: MOCK_SHARE_CARD_SHARED.collector_number,
            cardId: 1,
          },
        ],
      },
    ],
  },
  cards: { [MOCK_SHARE_CARD_SHARED.name]: MOCK_SHARE_CARD_SHARED },
})

// Gamma holds "Shared Card" at a DIFFERENT printing (tst:43 vs Alpha's tst:41)
// plus "Alpha Extra" at the very printing Alpha runs (tst:42): excluding Gamma
// under Printing identity keeps Shared Card but still hides Alpha Extra, and
// including Beta+Gamma separates Any (union) from All (intersection).
const MOCK_SHARE_COLLECTION_GAMMA = makeCollectionDetail({
  name: 'Gamma',
  entries: [
    makeCollectionEntry({
      name: MOCK_SHARE_CARD_SHARED_ALT.name,
      collectorNumber: MOCK_SHARE_CARD_SHARED_ALT.collector_number,
      price: 1.0,
      cardId: 1,
    }),
    makeCollectionEntry({
      name: MOCK_SHARE_CARD_EXTRA.name,
      collectorNumber: MOCK_SHARE_CARD_EXTRA.collector_number,
      price: 1.0,
      fileOrder: 1,
      cardId: 2,
    }),
  ],
  cards: { 'tst:43': MOCK_SHARE_CARD_SHARED_ALT, 'tst:42': MOCK_SHARE_CARD_EXTRA },
  totalPrice: 2.0,
})

// Wanted list "Delta": exercises the share source's wanted-list branch.
const MOCK_SHARE_WANTED_DELTA = makeWantedDetail({
  name: 'Delta',
  entries: [
    {
      name: MOCK_SHARE_CARD_ONLY.name,
      set: MOCK_SHARE_CARD_ONLY.set,
      collectorNumber: MOCK_SHARE_CARD_ONLY.collector_number,
      price: 1.0,
      fileOrder: 0,
      section: 'Main',
      state: 'printing',
      cardId: 1,
    },
  ],
  cards: { 'tst:40': MOCK_SHARE_CARD_ONLY },
  totalPrice: 1.0,
})

/** Options for {@link mockPublicSiteForShareFilters}. */
type ShareFilterMockOptions = {
  /**
   * Also index an (empty) *collection* named "Beta", so the share suggestions
   * offer two lists with the same folded name and must disambiguate by type
   * ("Beta (Deck)" / "Beta (Collection)").
   */
  duplicateBetaCollection?: boolean
}

/**
 * Mock a multi-list site for the cross-list share filters: deck "Alpha" (the
 * viewed page, three cards) plus deck "Beta", collection "Gamma", and wanted
 * list "Delta", each sharing cards with Alpha as documented on the fixtures
 * above. The other lists' detail JSON is served too, since the share filters
 * fetch it lazily on first selection.
 */
export async function mockPublicSiteForShareFilters(
  page: Page,
  options: ShareFilterMockOptions = {},
): Promise<void> {
  const collections = [
    makeCollectionSummary({ slug: 'share-c', name: 'Gamma', cardCount: 2, totalPrice: 2.0 }),
  ]
  if (options.duplicateBetaCollection) {
    collections.push(makeCollectionSummary({ slug: 'share-e', name: 'Beta', cardCount: 0 }))
  }
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [
        makeDeckSummary({ slug: 'share-a', name: 'Alpha', cardCount: 3 }),
        makeDeckSummary({ slug: 'share-b', name: 'Beta', cardCount: 1 }),
      ],
      collections,
      wantedLists: [makeWantedListSummary({ slug: 'share-d', name: 'Delta', cardCount: 1 })],
    }),
  )
  await fulfillJson(page, '**/decks/share-a.json', MOCK_SHARE_DECK_ALPHA)
  await fulfillJson(page, '**/decks/share-b.json', MOCK_SHARE_DECK_BETA)
  await fulfillJson(page, '**/collections/share-c.json', MOCK_SHARE_COLLECTION_GAMMA)
  await fulfillJson(page, '**/wanted/share-d.json', MOCK_SHARE_WANTED_DELTA)
  if (options.duplicateBetaCollection) {
    await fulfillJson(page, '**/collections/share-e.json', makeCollectionDetail({ name: 'Beta' }))
  }
}

/** Mock a deck holding two printings of one card name, for the Copies match modes. */
export async function mockPublicSiteDeckForCopiesModes(page: Page): Promise<void> {
  await fulfillJson(
    page,
    '**/index.json',
    makeSiteIndex({
      decks: [
        makeDeckSummary({ slug: 'test-copies-deck', name: 'Test Copies Deck', cardCount: 2 }),
      ],
      availableCurrencies: ['usd'],
    }),
  )
  await fulfillJson(page, '**/decks/test-copies-deck.json', MOCK_COPIES_DECK)
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

/**
 * Override the printing picker's Scryfall search with a fixed printing list,
 * wrapping it in the search endpoint's list envelope.
 */
export async function mockPickerPrintings(page: Page, printings: ScryfallCard[]): Promise<void> {
  await fulfillJson(page, '**/api.scryfall.com/cards/search**', {
    object: 'list',
    total_cards: printings.length,
    has_more: false,
    data: printings,
  })
}

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

/** An accented name, so trade search can be tested for diacritic-insensitivity. */
const MOCK_TRADE_COLLECTION_CARD_JOTUN = makeMockScryfallCard({
  id: 'trade-jotun-id',
  name: 'Jötun Grunt',
  cmc: 2,
  type_line: 'Creature — Giant Soldier',
  oracle_text:
    'Cumulative upkeep—Put two cards from a single graveyard on the bottom of its owner’s library.',
  prices: { usd: '1.00', eur: '0.80' },
  set: 'csp',
  set_name: 'Coldsnap',
  collector_number: '14',
  rarity: 'uncommon',
  released_at: '2006-07-21',
})

/** Keep-labeled entry backing the trade keep-guard tests. Never label the cards above — existing specs add them freely. */
const MOCK_TRADE_COLLECTION_CARD_GEM = makeMockScryfallCard({
  id: 'trade-gem-id',
  name: 'Guarded Gem',
  cmc: 2,
  type_line: 'Artifact',
  oracle_text: '{T}: Add one mana of any color.',
  prices: { usd: '9.00', eur: '8.00' },
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '42',
  rarity: 'rare',
  released_at: '2020-01-01',
})

/**
 * The two by-rule priceless entries the trade board must mark instead of
 * pricing. Both printings are worth real money, so a row showing a figure is a
 * regression rather than a fixture accident. Named so no existing spec's search
 * query reaches them.
 */
const MOCK_TRADE_COLLECTION_CARD_ALTERED = makeMockScryfallCard({
  id: 'trade-altered-id',
  name: 'Altered Bauble',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '12.00', eur: '10.00' },
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '43',
  rarity: 'rare',
  released_at: '2020-01-01',
})

const MOCK_TRADE_COLLECTION_CARD_FAKE = makeMockScryfallCard({
  id: 'trade-fake-id',
  name: 'Fake Relic',
  cmc: 1,
  type_line: 'Artifact',
  prices: { usd: '15.00', eur: '13.00' },
  set: 'tst',
  set_name: 'Test Set',
  collector_number: '44',
  rarity: 'rare',
  released_at: '2020-01-01',
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

const MOCK_TRADE_COLLECTION_DETAIL = makeCollectionDetail({
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
    {
      name: 'Jötun Grunt',
      set: 'csp',
      collectorNumber: '14',
      finish: 'nonfoil',
      condition: 'NM',
      price: 1.0,
      fileOrder: 4,
      section: 'Main',
      cardId: 5,
    },
    // Keep-labeled: the trade keep-guard specs add this one.
    {
      name: 'Guarded Gem',
      set: 'tst',
      collectorNumber: '42',
      finish: 'nonfoil',
      condition: 'NM',
      labels: ['keep'],
      price: 9.0,
      fileOrder: 5,
      section: 'Main',
      cardId: 6,
    },
    // Priceless by rule, and baked as the site bakes them: price 0, with the
    // reason still readable from the entry. Custom art wins over the label when
    // both apply, which is why the altered copy carries the label too.
    {
      name: 'Altered Bauble',
      set: 'tst',
      collectorNumber: '43',
      finish: 'nonfoil',
      condition: 'NM',
      labels: ['proxy'],
      customArt: MOCK_DECK_ART_PATH,
      price: 0,
      fileOrder: 6,
      section: 'Main',
      cardId: 7,
    },
    {
      name: 'Fake Relic',
      set: 'tst',
      collectorNumber: '44',
      finish: 'nonfoil',
      condition: 'NM',
      labels: ['proxy'],
      price: 0,
      fileOrder: 7,
      section: 'Main',
      cardId: 8,
    },
  ],
  cards: {
    'lea:161': MOCK_TRADE_COLLECTION_CARD_BOLT,
    'c19:221': MOCK_TRADE_COLLECTION_CARD_RING,
    'csp:14': MOCK_TRADE_COLLECTION_CARD_JOTUN,
    'tst:42': MOCK_TRADE_COLLECTION_CARD_GEM,
    'tst:43': MOCK_TRADE_COLLECTION_CARD_ALTERED,
    'tst:44': MOCK_TRADE_COLLECTION_CARD_FAKE,
  },
  printings: {
    'Lightning Bolt': [MOCK_TRADE_COLLECTION_CARD_BOLT],
    'Sol Ring': [MOCK_TRADE_COLLECTION_CARD_RING],
    'Jötun Grunt': [MOCK_TRADE_COLLECTION_CARD_JOTUN],
    'Guarded Gem': [MOCK_TRADE_COLLECTION_CARD_GEM],
    'Altered Bauble': [MOCK_TRADE_COLLECTION_CARD_ALTERED],
    'Fake Relic': [MOCK_TRADE_COLLECTION_CARD_FAKE],
  },
  totalPrice: 20.5,
})

const MOCK_TRADE_WANTED_DETAIL = makeWantedDetail({
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
  totalPrice: 175.0,
})

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

const MOCK_TRADE_DECK_DETAIL = makeDeckDetail({
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
})

const MOCK_SITE_INDEX_FOR_TRADE = makeSiteIndex({
  decks: [makeDeckSummary({ slug: 'trade-deck', name: 'Trade Deck' })],
  collections: [
    makeCollectionSummary({
      slug: 'trade-collection',
      name: 'Trade Collection',
      // The two priceless entries count as cards but contribute nothing to the
      // total, exactly as the bake reports them.
      cardCount: 8,
      totalPrice: 20.5,
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

export type MockTradeOptions = {
  /**
   * Marks the index as hosted, the way `ritual serve --api` does (`''` for
   * same-origin). The trade page's right column then searches the backend's
   * card cache alongside the wanted lists; the caller mocks `api/*` itself.
   */
  apiBaseUrl?: string
}

/**
 * Mock the public site JSON endpoints for the Trade page.
 * Provides one collection (with Lightning Bolt + Sol Ring) and one wanted list (with Mana Crypt).
 * Also mocks the Scryfall autocomplete and search endpoints for right-column Scryfall mode tests.
 */
export async function mockPublicSiteForTrade(
  page: Page,
  options: MockTradeOptions = {},
): Promise<void> {
  const index: SiteIndex =
    options.apiBaseUrl === undefined
      ? MOCK_SITE_INDEX_FOR_TRADE
      : { ...MOCK_SITE_INDEX_FOR_TRADE, apiBaseUrl: options.apiBaseUrl }
  // The collection carries a custom-art entry, so its `art/…` image must resolve
  // the same way a built site's `dist/art/` would.
  await mockCustomArtFiles(page)
  await fulfillJson(page, '**/index.json', index)
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

const MOCK_QUICK_SWITCH_DECK_AZORIUS = makeDeckDetail({
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
})

const MOCK_QUICK_SWITCH_DECK_MONO_RED = makeDeckDetail({
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
})

function binderEntry(
  name: string,
  set: string,
  collectorNumber: string,
  fileOrder: number,
): CollectionCardEntry {
  return makeCollectionEntry({ name, set, collectorNumber, fileOrder })
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

const MOCK_QUICK_SWITCH_COLLECTION_MAIN_BINDER = makeCollectionDetail({
  name: 'Main Binder',
  entries: [
    binderEntry('Lightning Bolt', 'm10', '146', 0),
    binderEntry('Mock Sanity', 'mkm', '42', 1),
    binderEntry('Moonshadow', 'ecl', '386', 2),
    binderEntry('Sol Ring', 'c16', '234', 3),
    binderEntry('Sol Ring', 'lgn', '303', 4),
    // A second copy of the same printing: the quick switch must collapse the
    // duplicate lines into one row whose count reads ×2.
    binderEntry('Lightning Bolt', 'm10', '146', 5),
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
  totalPrice: 1240.75,
})

const MOCK_QUICK_SWITCH_WANTED_HIGH_PRIORITY = makeWantedDetail({
  name: 'High Priority',
  cards: { 'Mana Crypt': null },
  totalPrice: 95,
})

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
const MOCK_MULTISELECT_DECK = makeDeckDetail({
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
})

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

const MOCK_MS_DECK_A = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

const MOCK_MS_DECK_B = makeDeckDetail({
  deck: {
    name: 'MS Deck B',
    sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'Mana Crypt', cardId: 1 }] }],
  },
  cards: { 'Mana Crypt': MS_CRYPT },
  printings: { 'Mana Crypt': [MS_CRYPT] },
  useScryfallImgUrls: true,
})

// A deck with a 4× quantity group, for the per-copy selection tests.
const MOCK_MS_DECK_QTY = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

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
const MOCK_CV_DECK = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

const MOCK_CV_COLLECTION = makeCollectionDetail({
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
  useScryfallImgUrls: true,
  totalPrice: 3,
})

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

const MOCK_DFC_DECK = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

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

const FIND_DECK = makeDeckDetail({
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
  useScryfallImgUrls: true,
})

const FIND_COLLECTION = makeCollectionDetail({
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
  useScryfallImgUrls: true,
  totalPrice: 8,
})

const FIND_WANTED = makeWantedDetail({
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
  useScryfallImgUrls: true,
  totalPrice: 1,
})

// A second deck whose only card matches none of the names the Find specs search,
// so it never changes result counts — it exists to make the scope controls'
// partial (indeterminate) type state reachable (two decks, one excluded).
const FIND_ISLAND = makeMockScryfallCard({
  id: 'find-island',
  name: 'Island',
  cmc: 0,
  type_line: 'Basic Land — Island',
  prices: { usd: '0.10' },
  set: 'lea',
  collector_number: '288',
})

const FIND_ATTIC = makeDeckDetail({
  deck: {
    name: 'Find Attic',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Island', set: 'lea', collectorNumber: '288', cardId: 1 }],
      },
    ],
  },
  cards: { Island: FIND_ISLAND },
  printings: { Island: [FIND_ISLAND] },
  useScryfallImgUrls: true,
})

const FIND_INDEX = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'find-deck', name: 'Find Deck', cardCount: 3, totalPrice: 10 }),
    makeDeckSummary({ slug: 'find-attic', name: 'Find Attic', cardCount: 1, totalPrice: 1 }),
  ],
  collections: [
    makeCollectionSummary({ slug: 'find-box', name: 'Find Box', cardCount: 2, totalPrice: 8 }),
  ],
  wantedLists: [makeWantedListSummary({ slug: 'find-wanted', name: 'Find Wanted', totalPrice: 1 })],
  useScryfallImgUrls: true,
})

/** Serve two decks + a collection + a wanted list for the Find page tests. */
export async function mockPublicSiteForFind(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', FIND_INDEX)
  await fulfillJson(page, '**/decks/find-deck.json', FIND_DECK)
  await fulfillJson(page, '**/decks/find-attic.json', FIND_ATTIC)
  await fulfillJson(page, '**/collections/find-box.json', FIND_COLLECTION)
  await fulfillJson(page, '**/wanted/find-wanted.json', FIND_WANTED)
}

// ----- Find Other Printings modal -----
// A deck with a 2x line (expanded copies), a collection holding a foil
// double-art printing (`Steam Vents // Steam Vents`) plus a nonfoil copy, and
// an unrelated wanted list that must never appear in the results. Cards carry
// loadable images so the list view's hover preview works.
const PRINT_STEAM = withImage(FIND_STEAM)
const PRINT_STEAM_DOUBLE_ART = withImage(FIND_STEAM_DOUBLE_ART)
const PRINT_BOLT = withImage(FIND_BOLT)
const PRINT_RING = withImage(FIND_RING)

const PRINT_DECK = makeDeckDetail({
  deck: {
    name: 'Print Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 2, name: 'Steam Vents', set: 'gpt', collectorNumber: '233', cardId: 1 },
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 2 },
        ],
      },
    ],
  },
  cards: { 'Steam Vents': PRINT_STEAM, 'Lightning Bolt': PRINT_BOLT },
  printings: {
    'Steam Vents': [PRINT_STEAM, PRINT_STEAM_DOUBLE_ART],
    'Lightning Bolt': [PRINT_BOLT],
  },
  useScryfallImgUrls: true,
})

const PRINT_BINDER = makeCollectionDetail({
  name: 'Print Binder',
  entries: [
    {
      name: 'Steam Vents // Steam Vents',
      set: 'sld',
      collectorNumber: '1234',
      finish: 'foil',
      condition: 'NM',
      price: 30,
      fileOrder: 0,
      section: 'Main',
      cardId: 1,
    },
    {
      name: 'Steam Vents',
      set: 'gpt',
      collectorNumber: '233',
      finish: 'nonfoil',
      condition: 'LP',
      price: 12,
      fileOrder: 1,
      section: 'Main',
      cardId: 2,
    },
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      finish: 'nonfoil',
      condition: 'NM',
      price: 3,
      fileOrder: 2,
      section: 'Main',
      cardId: 3,
    },
  ],
  cards: {
    'sld:1234': PRINT_STEAM_DOUBLE_ART,
    'gpt:233': PRINT_STEAM,
    'c19:221': PRINT_RING,
  },
  printings: {
    'Steam Vents': [PRINT_STEAM, PRINT_STEAM_DOUBLE_ART],
    'Sol Ring': [PRINT_RING],
  },
  useScryfallImgUrls: true,
  totalPrice: 45,
})

const PRINT_WANTED: WantedListDetail = { ...FIND_WANTED, name: 'Print Wanted' }

const PRINT_INDEX = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'print-deck', name: 'Print Deck', cardCount: 3, totalPrice: 10 }),
  ],
  collections: [
    makeCollectionSummary({ slug: 'print-binder', name: 'Print Binder', cardCount: 3 }),
  ],
  wantedLists: [makeWantedListSummary({ slug: 'print-wanted', name: 'Print Wanted' })],
  useScryfallImgUrls: true,
})

/** Serve a deck + collection + wanted list for the "Find Other Printings" modal tests. */
export async function mockPublicSiteForFindPrintings(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', PRINT_INDEX)
  await fulfillJson(page, '**/decks/print-deck.json', PRINT_DECK)
  await fulfillJson(page, '**/collections/print-binder.json', PRINT_BINDER)
  await fulfillJson(page, '**/wanted/print-wanted.json', PRINT_WANTED)
}

// ===== Collection with an alternate-language ([ja]) entry =====

/** The default-language (English) object for the language binder's printing. */
export const MOCK_LANG_CARD_EN = makeMockScryfallCard({
  id: 'lang-card-en',
  name: 'Language Card',
  cmc: 2,
  type_line: 'Artifact',
  prices: { usd: '2.00' },
  set: 'tst',
  collector_number: '9',
  image_uris: { normal: 'https://img.test/lang-en.jpg' },
})

/** The same printing's Japanese card object, baked under `tst:9@ja`. */
export const MOCK_LANG_CARD_JA = makeMockScryfallCard({
  id: 'lang-card-ja',
  name: 'Language Card',
  cmc: 2,
  type_line: 'Artifact',
  lang: 'ja',
  // Foreign objects typically carry no prices; the page must price the entry
  // from the default-language object regardless.
  set: 'tst',
  collector_number: '9',
  image_uris: { normal: 'https://img.test/lang-ja.jpg' },
})

const MOCK_LANG_BINDER_DETAIL = makeCollectionDetail({
  name: 'Lang Binder',
  entries: [
    makeCollectionEntry({
      name: 'Language Card',
      collectorNumber: '9',
      price: 2.0,
      fileOrder: 0,
      cardId: 1,
    }),
    makeCollectionEntry({
      name: 'Language Card',
      collectorNumber: '9',
      language: 'ja',
      price: 2.0,
      fileOrder: 1,
      cardId: 2,
    }),
  ],
  cards: {
    'tst:9': MOCK_LANG_CARD_EN,
    'tst:9@ja': MOCK_LANG_CARD_JA,
  },
  printings: { 'Language Card': [MOCK_LANG_CARD_EN, MOCK_LANG_CARD_JA] },
  totalPrice: 4.0,
})

const MOCK_SITE_INDEX_WITH_LANG_BINDER = makeSiteIndex({
  collections: [
    makeCollectionSummary({
      slug: 'lang-binder',
      name: 'Lang Binder',
      cardCount: 2,
      totalPrice: 4.0,
    }),
  ],
})

/**
 * Mock a collection holding an English and a Japanese copy of one printing,
 * with the ja card object baked under its `set:cn@ja` key — for the language
 * badge / ja-scan-resolution / Set Language tests.
 */
export async function mockPublicSiteCollectionWithLanguages(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', MOCK_SITE_INDEX_WITH_LANG_BINDER)
  await fulfillJson(page, '**/collections/lang-binder.json', MOCK_LANG_BINDER_DETAIL)
}

// ===== Swap Printings wizard =====
// A deck being edited (one pinned Sol Ring, a pinned Arcane Signet and Mind
// Stone nobody else owns, one name-only Lightning Bolt), a binder holding two other Sol Ring
// printings (one priced well above the deck's, one unpriced), a second deck
// holding the deck's own printing (never a candidate), and a wanted list with a
// name-only Sol Ring (the printing-less candidate; wanted sources are off by
// default). Every list's `printings` carries all three Sol Ring printings so the
// deck tile can resolve whichever one a swap pins.

/**
 * Per-printing art for the swap fixture. Every other mock card shares
 * `TINY_PNG`, which cannot tell one card's preview from another's — these are
 * distinct 1x1 images so a hover assertion pins *which* card was previewed.
 */
export const SWAP_ART: Record<string, string> = {
  'swap-ring-c21':
    'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'swap-ring-lea':
    'data:image/gif;base64,R0lGODlhAQABAIAAAAD/AAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'swap-signet-cmr':
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAA/wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
}

/** One Sol Ring printing for the swap fixture, priced (or not) as the test needs. */
function makeSwapRing(set: string, collectorNumber: string, usd: string | null): ScryfallCard {
  const id = `swap-ring-${set}`
  return withImage(
    makeMockScryfallCard({
      id,
      name: 'Sol Ring',
      cmc: 1,
      type_line: 'Artifact',
      prices: { usd },
      set,
      set_name: `Set ${set.toUpperCase()}`,
      collector_number: collectorNumber,
    }),
    SWAP_ART[id],
  )
}

export const SWAP_RING_C21 = makeSwapRing('c21', '263', '1.50')
export const SWAP_RING_LEA = makeSwapRing('lea', '270', '100.00')
export const SWAP_RING_C19 = makeSwapRing('c19', '221', null)
const SWAP_RING_PRINTINGS = [SWAP_RING_C21, SWAP_RING_LEA, SWAP_RING_C19]

const SWAP_SIGNET = withImage(
  makeMockScryfallCard({
    id: 'swap-signet-cmr',
    name: 'Arcane Signet',
    cmc: 2,
    type_line: 'Artifact',
    prices: { usd: '2.00' },
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '329',
  }),
  SWAP_ART['swap-signet-cmr'],
)

const SWAP_STONE = withImage(
  makeMockScryfallCard({
    id: 'swap-stone-cmr',
    name: 'Mind Stone',
    cmc: 2,
    type_line: 'Artifact',
    prices: { usd: '0.50' },
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '318',
  }),
)

const SWAP_BOLT = withImage(
  makeMockScryfallCard({
    id: 'swap-bolt-m10',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    prices: { usd: '1.00' },
    set: 'm10',
    set_name: 'Magic 2010',
    collector_number: '146',
    color_identity: ['R'],
  }),
)

/** A second Lightning Bolt printing, priced apart from M10:146 so pinning it shows on the deck tile. */
export const SWAP_BOLT_LEA = withImage(
  makeMockScryfallCard({
    id: 'swap-bolt-lea',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    prices: { usd: '5.00' },
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    color_identity: ['R'],
  }),
)
export const SWAP_BOLT_PRINTINGS = [SWAP_BOLT, SWAP_BOLT_LEA]

const SWAP_DECK = makeDeckDetail({
  deck: {
    name: 'Swap Deck',
    sections: [
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
          { quantity: 1, name: 'Arcane Signet', set: 'cmr', collectorNumber: '329', cardId: 2 },
          { quantity: 1, name: 'Mind Stone', set: 'cmr', collectorNumber: '318', cardId: 3 },
          { quantity: 1, name: 'Lightning Bolt', cardId: 4 },
        ],
      },
    ],
  },
  cards: {
    'Sol Ring': SWAP_RING_C21,
    'Arcane Signet': SWAP_SIGNET,
    'Mind Stone': SWAP_STONE,
    'Lightning Bolt': SWAP_BOLT,
  },
  printings: {
    'Sol Ring': SWAP_RING_PRINTINGS,
    'Arcane Signet': [SWAP_SIGNET],
    'Mind Stone': [SWAP_STONE],
    'Lightning Bolt': SWAP_BOLT_PRINTINGS,
  },
  useScryfallImgUrls: true,
})

const SWAP_OTHER_DECK = makeDeckDetail({
  deck: {
    name: 'Swap Other',
    sections: [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
      },
    ],
  },
  cards: { 'Sol Ring': SWAP_RING_C21 },
  printings: { 'Sol Ring': SWAP_RING_PRINTINGS },
  useScryfallImgUrls: true,
})

const SWAP_BINDER = makeCollectionDetail({
  name: 'Swap Binder',
  entries: [
    makeCollectionEntry({
      name: 'Sol Ring',
      set: 'lea',
      collectorNumber: '270',
      price: 100,
      fileOrder: 0,
      cardId: 1,
    }),
    makeCollectionEntry({
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      price: 0,
      fileOrder: 1,
      cardId: 2,
    }),
    // The copy the deck's name-only Lightning Bolt can take its printing from.
    makeCollectionEntry({
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      price: 5,
      fileOrder: 2,
      cardId: 3,
    }),
  ],
  cards: { 'lea:270': SWAP_RING_LEA, 'c19:221': SWAP_RING_C19, 'lea:161': SWAP_BOLT_LEA },
  printings: { 'Sol Ring': SWAP_RING_PRINTINGS, 'Lightning Bolt': SWAP_BOLT_PRINTINGS },
  useScryfallImgUrls: true,
  totalPrice: 105,
})

const SWAP_WANTS = makeWantedDetail({
  name: 'Swap Wants',
  entries: [
    { name: 'Sol Ring', price: 1.5, fileOrder: 0, section: 'Main', state: 'name-only', cardId: 1 },
  ],
  cards: { 'Sol Ring': SWAP_RING_C21 },
  printings: { 'Sol Ring': SWAP_RING_PRINTINGS },
  useScryfallImgUrls: true,
  totalPrice: 1.5,
})

const SWAP_INDEX = makeSiteIndex({
  decks: [
    makeDeckSummary({ slug: 'swap-deck', name: 'Swap Deck', cardCount: 4 }),
    makeDeckSummary({ slug: 'swap-other', name: 'Swap Other', cardCount: 1 }),
  ],
  collections: [makeCollectionSummary({ slug: 'swap-binder', name: 'Swap Binder', cardCount: 3 })],
  wantedLists: [makeWantedListSummary({ slug: 'swap-wants', name: 'Swap Wants' })],
  useScryfallImgUrls: true,
})

/** Serve the two decks + binder + wanted list for the Swap Printings wizard tests. */
export async function mockPublicSiteForSwap(page: Page): Promise<void> {
  await fulfillJson(page, '**/index.json', SWAP_INDEX)
  await fulfillJson(page, '**/decks/swap-deck.json', SWAP_DECK)
  await fulfillJson(page, '**/decks/swap-other.json', SWAP_OTHER_DECK)
  await fulfillJson(page, '**/collections/swap-binder.json', SWAP_BINDER)
  await fulfillJson(page, '**/wanted/swap-wants.json', SWAP_WANTS)
}
