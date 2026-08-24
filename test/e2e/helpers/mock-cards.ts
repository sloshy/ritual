import type { ScryfallCard } from '../../../src/types'
import type { CollectionDetail, WantedListDetail } from '../../../src/site/data-types'

// A dedicated e2e card factory (rather than reusing test/test-utils.ts's
// makeScryfallCard) because the site payload mocks share a richer default
// envelope — an all-empty image_uris block and an empty oracle_text, as
// build-site emits — and because test-utils has runtime imports from
// src/cache that the Playwright (Node) process should not load.

/**
 * Overrides for {@link makeMockScryfallCard}. `prices` and `image_uris` may be
 * partial; they are merged over the all-null / all-empty defaults. Pass
 * `image_uris: null` to omit the block entirely (Scryfall omits it for
 * double-faced cards, which is how the site detects them).
 */
export type MockScryfallCardOverrides = Partial<Omit<ScryfallCard, 'prices' | 'image_uris'>> & {
  prices?: Partial<ScryfallCard['prices']>
  image_uris?: Partial<NonNullable<ScryfallCard['image_uris']>> | null
}

const EMPTY_IMAGE_URIS: NonNullable<ScryfallCard['image_uris']> = {
  small: '',
  normal: '',
  large: '',
  png: '',
  art_crop: '',
  border_crop: '',
}

/**
 * A full Scryfall card payload with the neutral defaults every e2e card mock
 * shares. Pass only the fields a spec's assertions rely on.
 */
export function makeMockScryfallCard(overrides: MockScryfallCardOverrides = {}): ScryfallCard {
  const { prices, image_uris, ...rest } = overrides
  const card: ScryfallCard = {
    id: 'test-card-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    oracle_text: '',
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    ...rest,
    prices: {
      usd: null,
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
      ...prices,
    },
  }
  if (image_uris !== null) {
    card.image_uris = { ...EMPTY_IMAGE_URIS, ...image_uris }
  }
  return card
}

// A 1×1 PNG data URL so a mock card's <img> actually loads and gives hover
// previews a non-zero size in tests (a 404 URL would leave them zero-height).
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Copy of `card` whose normal image is a URL that actually loads in tests. */
export function withImage(card: ScryfallCard, normal: string = TINY_PNG): ScryfallCard {
  return { ...card, image_uris: { ...EMPTY_IMAGE_URIS, ...card.image_uris, normal } }
}

// ===== Fixtures shared by the public-site and admin mocks =====

export const MOCK_WANTED_LIST_CARD_BOLT = makeMockScryfallCard({
  id: 'bolt-id',
  name: 'Lightning Bolt',
  cmc: 1,
  type_line: 'Instant',
  oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  mana_cost: '{R}',
  prices: { usd: '2.00', usd_foil: '5.00', eur: '1.50', eur_foil: '4.00', tix: '0.10' },
  finishes: ['nonfoil', 'foil'],
  set: 'a25',
  set_name: 'Masters 25',
  collector_number: '141',
  rarity: 'uncommon',
  color_identity: ['R'],
})

export const MOCK_WANTED_LIST_CARD_SOL = makeMockScryfallCard({
  id: 'sol-id',
  name: 'Sol Ring',
  cmc: 1,
  type_line: 'Artifact',
  oracle_text: '{T}: Add {C}{C}.',
  mana_cost: '{1}',
  prices: { usd: '3.00', usd_foil: '8.00', eur: '2.50', eur_foil: '7.00' },
  finishes: ['nonfoil', 'foil'],
  set: 'c19',
  set_name: 'Commander 2019',
  collector_number: '221',
  rarity: 'uncommon',
})

export const MOCK_WANTED_LIST_CARD_CRYPT = makeMockScryfallCard({
  id: 'crypt-id',
  name: 'Mana Crypt',
  cmc: 0,
  type_line: 'Artifact',
  oracle_text: 'At the beginning of your upkeep, flip a coin...',
  mana_cost: '{0}',
  prices: { usd: '150.00', usd_foil: '200.00', eur: '130.00', eur_foil: '180.00', tix: '5.00' },
  finishes: ['nonfoil', 'foil'],
  set: '2xm',
  set_name: 'Double Masters',
  collector_number: '270',
  rarity: 'mythic',
})

/**
 * A foil-only printing with no nonfoil price, wanted with no `[finish]` token.
 * Reading such an entry flatly as nonfoil quotes $0 for a card that has a price,
 * so this pins that the entry is read at the printing's default finish.
 */
export const MOCK_WANTED_LIST_CARD_FOIL_ONLY = makeMockScryfallCard({
  id: 'foil-only-id',
  name: 'Gleaming Relic',
  cmc: 2,
  type_line: 'Artifact',
  mana_cost: '{2}',
  prices: { usd: null, usd_foil: '15.00' },
  finishes: ['foil'],
  set: 'sld',
  set_name: 'Secret Lair Drop',
  collector_number: '99',
  rarity: 'rare',
})

/** Wanted-list payload served by both the public wanted page and the admin load API. */
export const MOCK_WANTED_LIST_DETAIL = {
  name: 'Test Wanted List',
  // Past the 200-character collapse threshold, so the toggle appears.
  description:
    'This wanted list has a long description that runs past the 200-character truncation ' +
    'threshold the shared list-description component uses, so the page collapses it behind ' +
    'a Read more link exactly as a deck description is collapsed.',
  entries: [
    { name: 'Lightning Bolt', price: 2.0, fileOrder: 0, section: 'Main', state: 'name-only' },
    {
      name: 'Sol Ring',
      set: 'c19',
      collectorNumber: '221',
      price: 3.0,
      fileOrder: 1,
      section: 'Main',
      state: 'printing',
    },
    {
      name: 'Mana Crypt',
      set: '2xm',
      collectorNumber: '270',
      finish: 'foil',
      price: 200.0,
      fileOrder: 2,
      section: 'Main',
      state: 'fully-specified',
    },
    {
      name: 'Gleaming Relic',
      set: 'sld',
      collectorNumber: '99',
      price: 15.0,
      fileOrder: 3,
      section: 'Main',
      state: 'printing',
    },
  ],
  cards: {
    'Lightning Bolt': MOCK_WANTED_LIST_CARD_BOLT,
    'Sol Ring': MOCK_WANTED_LIST_CARD_SOL,
    'Mana Crypt': MOCK_WANTED_LIST_CARD_CRYPT,
    'Gleaming Relic': MOCK_WANTED_LIST_CARD_FOIL_ONLY,
    'c19:221': MOCK_WANTED_LIST_CARD_SOL,
    '2xm:270': MOCK_WANTED_LIST_CARD_CRYPT,
    'sld:99': MOCK_WANTED_LIST_CARD_FOIL_ONLY,
  },
  printings: {
    'Lightning Bolt': [MOCK_WANTED_LIST_CARD_BOLT],
    'Sol Ring': [MOCK_WANTED_LIST_CARD_SOL],
    'Mana Crypt': [MOCK_WANTED_LIST_CARD_CRYPT],
    'Gleaming Relic': [MOCK_WANTED_LIST_CARD_FOIL_ONLY],
  },
  symbolMap: {},
  useScryfallImgUrls: true,
  totalPrice: 220.0,
  defaultCurrency: 'usd',
} satisfies WantedListDetail

export const MOCK_COLLECTION_CARD_PRICED = makeMockScryfallCard({
  id: 'collection-priced-id',
  name: 'Priced Card',
  cmc: 2,
  type_line: 'Creature — Human',
  mana_cost: '{1}{W}',
  prices: { usd: '3.50', eur: '2.75' },
  collector_number: '10',
  rarity: 'rare',
  color_identity: ['W'],
  edhrec_rank: 5000,
})

export const MOCK_COLLECTION_CARD_UNPRICED = makeMockScryfallCard({
  id: 'collection-unpriced-id',
  name: 'Unpriced Card',
  cmc: 3,
  type_line: 'Artifact',
  mana_cost: '{3}',
  collector_number: '11',
  rarity: 'uncommon',
  edhrec_rank: 10000,
})

/**
 * Collection payload with both a priced and an unpriced card, served by both
 * the public collection page and the admin collection load API (Hide Unpriced).
 */
export const MOCK_COLLECTION_DETAIL = {
  name: 'Test Collection',
  // Short enough to render whole: the page shows it with no Read more toggle.
  description: 'Everything I will trade away.',
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
      name: 'Unpriced Card',
      set: 'tst',
      collectorNumber: '11',
      finish: 'nonfoil',
      condition: 'NM',
      price: 0,
      fileOrder: 1,
      section: 'Main',
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
} satisfies CollectionDetail
