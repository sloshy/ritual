import { describe, expect, test } from 'bun:test'
import { makeBuylistQuote, makeScryfallCard } from '../../../test/test-utils'
import { slugifyListName } from '../../../src/site/details/shared'
import { buildDeckArtifacts, type LoadedDeck } from '../../../src/site/details/deck'
import {
  buildCollectionArtifacts,
  type LoadedCollection,
} from '../../../src/site/details/collection'
import { buildWantedArtifacts, type LoadedWanted } from '../../../src/site/details/wanted'
import type {
  DetailBuylistContext,
  SiteCardData,
  SiteDetailContext,
} from '../../../src/site/details/types'
import type { BuylistQuote, BuylistQuoteRequest } from '../../../src/buylist'
import { quoteKey } from '../../../src/buylist'
import type { ScryfallCard } from '../../../src/types'
import type { CardArtMap, CardArtRef } from '../../../src/card-art'
import type { CollectionEntry } from '../../../src/collection-file'
import type { ListImageRef } from '../../../src/list-image'
import { cardPricelessReason } from '../../../src/site/priceless'
import type { ChangelogPage } from '../../../src/changelog-parser'

type StubContextOptions = {
  cardData?: Partial<SiteCardData>
  printingsByName?: Record<string, ScryfallCard[]>
  canonicalNames?: Record<string, string>
  currencies?: SiteDetailContext['availableCurrencies']
  /** Attach a buylist seam; absent means the builder must bake no `buylist` field. */
  buylist?: DetailBuylistContext
  /** Art files the build could not deploy; those references must not be baked. */
  missingArtFiles?: ReadonlySet<string>
}

type StubContext = {
  ctx: SiteDetailContext
  shipped: ScryfallCard[]
  warnings: string[]
}

function makeContext(options: StubContextOptions = {}): StubContext {
  const shipped: ScryfallCard[] = []
  const warnings: string[] = []
  const printingsByName = options.printingsByName ?? {}
  const canonicalNames = options.canonicalNames ?? {}
  const ctx: SiteDetailContext = {
    ...(options.buylist ? { buylist: options.buylist } : {}),
    ...(options.missingArtFiles ? { missingArtFiles: options.missingArtFiles } : {}),
    cardData: {
      cards: {},
      printings: {},
      cheapest: {},
      missing: {},
      ...options.cardData,
    },
    resolveCardName: (name) => Promise.resolve(canonicalNames[name] ?? null),
    getPrintings: (name) => Promise.resolve(printingsByName[name] ?? []),
    bannedPrintings: new Set(),
    symbolMap: { '{W}': 'images/symbols/W.svg' },
    useScryfallImgUrls: true,
    defaultCurrency: 'usd',
    availableCurrencies: options.currencies ?? ['usd', 'eur', 'tix'],
    pricesDate: '2026-07-24T00:00:00.000Z',
    onCardShipped: (card) => {
      shipped.push(card)
      return Promise.resolve()
    },
    warn: (message) => warnings.push(message),
  }
  return { ctx, shipped, warnings }
}

function imageUris(url: string): NonNullable<ScryfallCard['image_uris']> {
  return { small: url, normal: url, large: url, png: url, art_crop: url, border_crop: url }
}

const bolt = makeScryfallCard({
  id: 'bolt-lea',
  name: 'Lightning Bolt',
  set: 'lea',
  collector_number: '161',
  released_at: '1993-08-05',
  prices: { usd: '100.00', eur: '90.00', tix: '1.50' },
  image_uris: imageUris('https://img/bolt.jpg'),
})
const boltCheap = makeScryfallCard({
  id: 'bolt-m10',
  name: 'Lightning Bolt',
  set: 'm10',
  collector_number: '146',
  released_at: '2009-07-17',
  prices: { usd: '1.00', eur: '0.90', tix: '0.05' },
  image_uris: imageUris('https://img/bolt-m10.jpg'),
})
const angel = makeScryfallCard({
  id: 'angel-fdn',
  name: 'Serra Angel',
  set: 'fdn',
  collector_number: '35',
  released_at: '2024-11-15',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '0.50', usd_foil: '1.20', eur: '0.40', tix: '0.02' },
  image_uris: imageUris('https://img/angel.jpg'),
})

/** A `<list>.art.json` map from a plain `{cardId: ref}` literal. */
const artMap = (entries: Record<number, CardArtRef>): CardArtMap =>
  new Map(Object.entries(entries).map(([id, ref]) => [Number(id), ref]))

describe('slugifyListName', () => {
  test('lowercases and collapses punctuation runs to single dashes', () => {
    expect(slugifyListName("Jace's Big Deck!")).toBe('jace-s-big-deck')
  })

  test('trims leading and trailing dashes', () => {
    expect(slugifyListName('...Edge Case...')).toBe('edge-case')
  })
})

describe('buildDeckArtifacts', () => {
  const deck: LoadedDeck = {
    data: {
      name: 'Burn Deck',
      sections: [
        { name: 'Commander', cards: [{ name: 'Serra Angel', quantity: 1 }] },
        { name: 'Mainboard', cards: [{ name: 'Lightning Bolt', quantity: 4 }] },
        { name: 'Maybeboard', cards: [{ name: 'Lightning Bolt', quantity: 1 }] },
      ],
    },
    changelog: [],
    warnings: [],
    fileMtime: '2026-07-01T00:00:00.000Z',
  }

  const cardData: Partial<SiteCardData> = {
    cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
    printings: { 'Lightning Bolt': [bolt, boltCheap], 'Serra Angel': [angel] },
    cheapest: {
      usd: { 'Lightning Bolt': boltCheap, 'Serra Angel': angel },
      eur: { 'Lightning Bolt': boltCheap, 'Serra Angel': angel },
      tix: { 'Lightning Bolt': boltCheap, 'Serra Angel': angel },
    },
  }

  test('builds slug, featured commander, and per-card maps', async () => {
    const { ctx, shipped } = makeContext({ cardData })
    const { slug, detail, summary } = await buildDeckArtifacts(deck, ctx)

    expect(slug).toBe('burn-deck')
    expect(summary.commander).toBe('Serra Angel')
    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(detail.cards['Lightning Bolt']).toBe(bolt)
    expect(detail.printings['Lightning Bolt']).toEqual([bolt, boltCheap])
    expect(detail.lowestPriceCards?.['Lightning Bolt']).toBe(boltCheap)
    expect(summary.lastUpdatedAt).toBe('2026-07-01T00:00:00.000Z')
    // An unpinned commander already has its representative's image cached by
    // the prefetch, so nothing extra is shipped for it.
    expect(shipped).toEqual([])
  })

  test('a commander pinned to a printing features that printing, not the representative', async () => {
    const angelAlt = makeScryfallCard({
      id: 'angel-m10',
      name: 'Serra Angel',
      set: 'm10',
      collector_number: '34',
      released_at: '2009-07-17',
      prices: { usd: '2.00' },
      image_uris: imageUris('https://img/angel-m10.jpg'),
    })
    const { ctx, shipped } = makeContext({
      cardData: {
        ...cardData,
        printings: { ...cardData.printings, 'Serra Angel': [angel, angelAlt] },
      },
    })
    const pinned: LoadedDeck = {
      ...deck,
      data: {
        ...deck.data,
        sections: [
          {
            name: 'Commander',
            cards: [{ name: 'Serra Angel', quantity: 1, set: 'm10', collectorNumber: '34' }],
          },
          ...deck.data.sections.slice(1),
        ],
      },
    }
    const { detail, summary } = await buildDeckArtifacts(pinned, ctx)

    expect(summary.commander).toBe('Serra Angel')
    expect(summary.featuredCardImage).toBe('https://img/angel-m10.jpg')
    // The prefetch only cached the representative's image, so the pinned
    // printing's has to be shipped for the tile to have art locally.
    expect(shipped).toEqual([angelAlt])
    // The pin resolves the tile only — the by-name maps the page reads still
    // carry the representative and the full printings list.
    expect(detail.cards['Serra Angel']).toBe(angel)
    expect(detail.printings['Serra Angel']).toEqual([angel, angelAlt])
  })

  test('a commanderless deck features its priciest line, at that line’s printing', async () => {
    const { ctx, shipped } = makeContext({
      cardData: { ...cardData, cards: { ...cardData.cards, 'Lightning Bolt': boltCheap } },
    })
    const commanderless: LoadedDeck = {
      ...deck,
      data: {
        ...deck.data,
        sections: [
          {
            name: 'Mainboard',
            cards: [
              { name: 'Serra Angel', quantity: 1 },
              // Pinned to the pricey Alpha printing while the deck's
              // representative for the name is the $1 M10 one.
              { name: 'Lightning Bolt', quantity: 4, set: 'lea', collectorNumber: '161' },
            ],
          },
        ],
      },
    }
    const { summary } = await buildDeckArtifacts(commanderless, ctx)

    expect(summary.commander).toBeNull()
    expect(summary.featuredCardImage).toBe('https://img/bolt.jpg')
    expect(shipped).toEqual([bolt])
  })

  test('an unresolved commander still names the deck’s commander', async () => {
    const { ctx } = makeContext({
      cardData: { ...cardData, cards: { 'Lightning Bolt': bolt } },
    })
    const { summary } = await buildDeckArtifacts(deck, ctx)

    // The priciest line supplies the tile's art, but the commander reported is
    // the deck's own — never whatever the tile fell back to.
    expect(summary.featuredCardImage).toBe('https://img/bolt.jpg')
    expect(summary.commander).toBe('Serra Angel')
  })

  test('a pin naming no known printing warns and falls back to the representative', async () => {
    const { ctx, warnings, shipped } = makeContext({ cardData })
    const typo: LoadedDeck = {
      ...deck,
      data: {
        ...deck.data,
        sections: [
          {
            name: 'Commander',
            cards: [{ name: 'Serra Angel', quantity: 1, set: 'zzz', collectorNumber: '1' }],
          },
          ...deck.data.sections.slice(1),
        ],
      },
    }
    const { summary } = await buildDeckArtifacts(typo, ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(shipped).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("Could not find printing for 'Serra Angel' (ZZZ:1)")
  })

  test('totals exclude maybeboard and use cheapest for lowest price', async () => {
    const { ctx } = makeContext({ cardData })
    const { summary } = await buildDeckArtifacts(deck, ctx)

    // 4x Bolt ($100) + 1x Angel ($0.50); the 1x maybeboard Bolt is excluded.
    expect(summary.totalPrice).toBeCloseTo(400.5)
    expect(summary.lowestPrice).toBeCloseTo(4.5)
    expect(summary.missingPriceCount).toBe(0)
  })

  test('unfetched cards get null map entries and count as missing prices', async () => {
    const { ctx } = makeContext({
      cardData: { ...cardData, cards: { 'Serra Angel': angel } },
    })
    const { detail, summary } = await buildDeckArtifacts(deck, ctx)

    expect(detail.cards['Lightning Bolt']).toBeNull()
    expect(summary.missingPriceCount).toBe(4)
  })

  test('deck missing lists only report cards present in the deck', async () => {
    const { ctx } = makeContext({
      cardData: { ...cardData, missing: { usd: ['Other Card', 'Lightning Bolt'] } },
    })
    const { detail } = await buildDeckArtifacts(deck, ctx)

    expect(detail.missingCards).toEqual({ usd: ['Lightning Bolt'] })
  })

  test('changelog-referenced cards are added to the maps via canonical names', async () => {
    // "Dark Ritual" is deliberately NOT in the deck's sections — only the
    // changelog block can put it in the maps, so this proves that path works.
    const ritual = makeScryfallCard({
      id: 'ritual-lea',
      name: 'Dark Ritual',
      set: 'lea',
      collector_number: '98',
      prices: { usd: '2.00' },
    })
    const changelog: ChangelogPage[] = [
      {
        timestamp: '2026-07-20T00:00:00.000Z',
        changes: [{ action: 'Removed', cardName: 'dark ritual' }],
      },
    ]
    const { ctx } = makeContext({
      cardData: {
        ...cardData,
        cards: { ...cardData.cards, 'Dark Ritual': ritual },
        printings: { ...cardData.printings, 'Dark Ritual': [ritual] },
      },
      canonicalNames: { 'dark ritual': 'Dark Ritual' },
    })
    const { detail, summary } = await buildDeckArtifacts({ ...deck, changelog }, ctx)

    expect(detail.cards['Dark Ritual']).toBe(ritual)
    expect(detail.printings['Dark Ritual']).toEqual([ritual])
    expect(detail.changelog).toEqual(changelog)
    expect(summary.lastUpdatedAt).toBe('2026-07-20T00:00:00.000Z')
  })
})

describe('buildCollectionArtifacts', () => {
  const loaded: LoadedCollection = {
    displayName: 'My Binder',
    entries: [
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        finish: 'foil',
        condition: 'LP',
        section: 'Main',
        cardId: 1,
      },
      {
        name: 'Lightning Bolt',
        quantity: 1,
        set: 'bad',
        collectorNumber: '999',
        section: 'Main',
        cardId: 2,
      },
    ],
    sectionOrder: ['Main'],
    warnings: [],
    changelog: [],
    fileMtime: '2026-07-01T00:00:00.000Z',
  }

  test('resolves exact printings, prices by finish, and reports unresolvable printings', async () => {
    const { ctx, shipped, warnings } = makeContext({
      printingsByName: {
        'Serra Angel': [angel],
        'Lightning Bolt': [bolt, boltCheap],
      },
    })
    const { slug, detail, summary } = await buildCollectionArtifacts(loaded, ctx)

    expect(slug).toBe('my-binder')
    expect(detail.cards['fdn:35']).toBe(angel)
    expect(detail.cards['bad:999']).toBeNull()
    expect(detail.entries[0]).toMatchObject({ finish: 'foil', condition: 'LP', price: 1.2 })
    // The unresolvable entry falls back to nonfoil finish and zero price.
    expect(detail.entries[1]).toMatchObject({ finish: 'nonfoil', condition: 'NM', price: 0 })
    expect(summary.totalPrice).toBeCloseTo(1.2)
    expect(summary.missingPriceCount).toBe(1)
    expect(shipped).toEqual([angel])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("'Lightning Bolt' (BAD:999)")
  })

  test('includes changelog-referenced cards under their canonical name', async () => {
    const changelog: ChangelogPage[] = [
      {
        timestamp: '2026-07-21T00:00:00.000Z',
        changes: [{ action: 'Removed', cardName: 'lightning bolt' }],
      },
    ]
    const { ctx } = makeContext({
      printingsByName: {
        'Serra Angel': [angel],
        'Lightning Bolt': [bolt, boltCheap],
      },
      canonicalNames: { 'lightning bolt': 'Lightning Bolt' },
    })
    const { detail } = await buildCollectionArtifacts({ ...loaded, changelog }, ctx)

    // The representative is the newest candidate within 1.5x the candidate
    // median — here the cheap 2009 printing, not the $100 1993 one.
    expect(detail.cards['Lightning Bolt']).toBe(boltCheap)
    expect(detail.printings['Lightning Bolt']).toEqual([bolt, boltCheap])
  })
})

describe('buildWantedArtifacts', () => {
  const loaded: LoadedWanted = {
    displayName: 'Wants',
    entries: [
      { name: 'Lightning Bolt', quantity: 1, section: 'Main', cardId: 1 },
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 2,
      },
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        finish: 'foil',
        section: 'Main',
        cardId: 3,
      },
    ],
    sectionOrder: ['Main'],
    warnings: [],
    changelog: [],
    fileMtime: '2026-07-02T00:00:00.000Z',
  }

  test('prices each entry state correctly (cheapest, default finish, exact finish)', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt },
        cheapest: { usd: { 'Lightning Bolt': boltCheap } },
      },
      printingsByName: { 'Lightning Bolt': [bolt, boltCheap], 'Serra Angel': [angel] },
    })
    const { detail, summary } = await buildWantedArtifacts(loaded, ctx)

    expect(detail.entries[0]).toMatchObject({ state: 'name-only', price: 1 })
    expect(detail.entries[1]).toMatchObject({ state: 'printing', price: 0.5 })
    expect(detail.entries[2]).toMatchObject({ state: 'fully-specified', price: 1.2 })
    expect(summary.totalPrice).toBeCloseTo(2.7)
    // Name-only entries key the card map by both printing key and name.
    expect(detail.cards['m10:146']).toBe(boltCheap)
    expect(detail.cards['Lightning Bolt']).toBe(boltCheap)
    expect(detail.cards['fdn:35']).toBe(angel)
  })

  test('warns and counts missing prices when a printing cannot be found', async () => {
    const { ctx, warnings } = makeContext({ printingsByName: { 'Serra Angel': [angel] } })
    const missingPrinting: LoadedWanted = {
      ...loaded,
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'zzz',
          collectorNumber: '1',
          section: 'Main',
          cardId: 1,
        },
      ],
    }
    const { detail, summary } = await buildWantedArtifacts(missingPrinting, ctx)

    expect(detail.cards['zzz:1']).toBeNull()
    expect(summary.missingPriceCount).toBe(1)
    expect(warnings[0]).toContain("'Serra Angel' (ZZZ:1)")
  })
})

describe('language baking', () => {
  const angelJa = makeScryfallCard({
    id: 'angel-fdn-ja',
    name: 'Serra Angel',
    set: 'fdn',
    collector_number: '35',
    lang: 'ja',
    released_at: '2024-11-15',
    finishes: ['nonfoil', 'foil'],
    // Foreign objects typically carry no prices; pricing must not read this one.
    prices: { usd: null, usd_foil: null, eur: null, tix: null },
    image_uris: imageUris('https://img/angel-ja.jpg'),
  })

  test('collection: a [ja] entry bakes the @ja object beside the default key and ships it', async () => {
    const loaded: LoadedCollection = {
      displayName: 'My Binder',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          finish: 'foil',
          language: 'ja',
          section: 'Main',
          cardId: 1,
        },
      ],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }
    const { ctx, shipped, warnings } = makeContext({
      printingsByName: { 'Serra Angel': [angel, angelJa] },
    })
    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    // The plain key keeps the default-language object; the @ja key holds the scan.
    expect(detail.cards['fdn:35']).toBe(angel)
    expect(detail.cards['fdn:35@ja']).toBe(angelJa)
    // The entry keeps its language and prices from the default object.
    expect(detail.entries[0]).toMatchObject({ language: 'ja', finish: 'foil', price: 1.2 })
    // Both objects ship, so --cache-images downloads the ja scan by its own id.
    expect(shipped).toEqual([angel, angelJa])
    expect(warnings).toHaveLength(0)
  })

  test('collection: a [ja] entry with no ja object warns and leaves the @ja key unwritten', async () => {
    const loaded: LoadedCollection = {
      displayName: 'My Binder',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          language: 'ja',
          section: 'Main',
          cardId: 1,
        },
      ],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }
    const { ctx, warnings } = makeContext({ printingsByName: { 'Serra Angel': [angel] } })
    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    expect(detail.cards['fdn:35']).toBe(angel)
    // No explicit null: lookups must fall through to the default object.
    expect('fdn:35@ja' in detail.cards).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('No ja card object')
    expect(warnings[0]).toContain('FDN:35')
  })

  test('wanted: a pinned [ja] entry bakes the @ja object and keeps default-object pricing', async () => {
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          finish: 'foil',
          language: 'ja',
          section: 'Main',
          cardId: 1,
        },
      ],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }
    const { ctx, shipped } = makeContext({
      printingsByName: { 'Serra Angel': [angel, angelJa] },
    })
    const { detail } = await buildWantedArtifacts(loaded, ctx)

    expect(detail.cards['fdn:35']).toBe(angel)
    expect(detail.cards['fdn:35@ja']).toBe(angelJa)
    expect(detail.entries[0]).toMatchObject({ language: 'ja', price: 1.2 })
    expect(shipped).toEqual([angel, angelJa])
  })
})

/** A recording buylist seam: what the builder asked, and what it was told. */
type StubBuylist = {
  ctx: DetailBuylistContext
  /** Every printing the builder quoted, in the order it asked. */
  asked: BuylistQuoteRequest[]
}

const FEED_CREATED_AT = '2026-08-04 06:06:09'
const FEED_RETRIEVED_AT = 1785850800000

const makeQuote = makeBuylistQuote

/**
 * A seam answering from `catalog` (keyed exactly as the detail keys its baked
 * map) and recording every ask, so the tests can pin *which* printing the
 * builder decided a tile displays — not just what came back. Shared by the
 * buylist-baking and Card Kingdom printing-selection suites, which ask the same
 * question of the same seam.
 */
function stubBuylist(
  catalog: Record<string, BuylistQuote> = {},
  quotePrintings = false,
): StubBuylist {
  const asked: BuylistQuoteRequest[] = []
  return {
    asked,
    ctx: {
      buyer: 'cardkingdom',
      quotePrintings,
      quote: (printing) => {
        asked.push(printing)
        return catalog[quoteKey(printing.set, printing.collectorNumber, printing.finish)] ?? null
      },
      feedCreatedAt: FEED_CREATED_AT,
      feedRetrievedAt: FEED_RETRIEVED_AT,
    },
  }
}

describe('buylist baking', () => {
  /** A foil-only printing: its displayed finish is foil with no `[foil]` token. */
  const foilOnly = makeScryfallCard({
    id: 'angel-etched',
    name: 'Etched Angel',
    set: 'fdn',
    collector_number: '400',
    finishes: ['foil'],
    prices: { usd_foil: '3.00' },
  })

  const binder = (entries: LoadedCollection['entries']): LoadedCollection => ({
    displayName: 'Sell Binder',
    entries,
    sectionOrder: ['Main'],
    warnings: [],
    changelog: [],
  })

  test('a context with no buylist leaves the field off the detail entirely', async () => {
    const { ctx } = makeContext({ printingsByName: { 'Serra Angel': [angel] } })
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 1,
      },
    ])

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    // Absent, not empty: "this list was never quoted" is what tells the client
    // to explain itself rather than report an empty buylist. Asserted through
    // the serializer as well, since the detail ships as JSON and that is where
    // an `undefined` becomes a genuinely absent field.
    expect(detail.buylist).toBeUndefined()
    expect(JSON.parse(JSON.stringify(detail))).not.toHaveProperty('buylist')
  })

  test('a quoted list bakes offers under the displayed finish, with the feed stamps', async () => {
    const buylist = stubBuylist({
      'fdn:35:foil': makeQuote({ priceBuy: 5, name: 'Serra Angel' }),
      'fdn:400:foil': makeQuote({ priceBuy: 2, finish: 'foil', name: 'Etched Angel' }),
    })
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel], 'Etched Angel': [foilOnly] },
      buylist: buylist.ctx,
    })
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        finish: 'foil',
        section: 'Main',
        cardId: 1,
      },
      // No `[foil]` token: a foil-only printing still displays (and quotes) as foil.
      {
        name: 'Etched Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '400',
        section: 'Main',
        cardId: 2,
      },
    ])

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    expect(detail.buylist?.cardkingdom).toMatchObject({
      feedCreatedAt: FEED_CREATED_AT,
      feedRetrievedAt: FEED_RETRIEVED_AT,
    })
    expect(Object.keys(detail.buylist?.cardkingdom?.quotes ?? {}).sort()).toEqual([
      'fdn:35:foil',
      'fdn:400:foil',
    ])
    expect(detail.buylist?.cardkingdom?.quotes['fdn:35:foil']).toMatchObject({ priceBuy: 5 })
    // The scryfall id goes along, so the matcher can join on it rather than
    // guessing from the set code.
    expect(buylist.asked).toEqual([
      { set: 'fdn', collectorNumber: '35', finish: 'foil', scryfallId: 'angel-fdn' },
      { set: 'fdn', collectorNumber: '400', finish: 'foil', scryfallId: 'angel-etched' },
    ])
  })

  test('a quoted list with nothing on the buylist bakes an empty map, not an absent field', async () => {
    const buylist = stubBuylist()
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel] },
      buylist: buylist.ctx,
    })
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 1,
      },
    ])

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    // The distinction the client renders differently: quoted and unwanted vs
    // never quoted at all.
    expect(detail.buylist?.cardkingdom?.quotes).toEqual({})
    expect(buylist.asked).toHaveLength(1)
  })

  test('a paused product is baked, since the map records catalog membership', async () => {
    // The bake keeps what the client's `onBuylist` deliberately does not ask:
    // whether the buyer stocks the printing at all. Dropping paused keys as
    // "payload weight" would erase the difference between "they don't deal in
    // this card" and "they're full on it right now", and would make the baked
    // map disagree with the live `/api/buylist/quotes` response for one key.
    const buylist = stubBuylist({
      'fdn:35:nonfoil': makeQuote({
        name: 'Serra Angel',
        priceBuy: 9,
        qtyBuying: 0,
        buying: false,
      }),
    })
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel] },
      buylist: buylist.ctx,
    })
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 1,
      },
    ])

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    expect(detail.buylist?.cardkingdom?.quotes['fdn:35:nonfoil']).toMatchObject({
      priceBuy: 9,
      buying: false,
    })
  })

  test('a non-English copy is never quoted, and never suppresses its English twin', async () => {
    const angelJa = makeScryfallCard({
      id: 'angel-fdn-ja',
      name: 'Serra Angel',
      set: 'fdn',
      collector_number: '35',
      lang: 'ja',
      finishes: ['nonfoil', 'foil'],
    })
    const buylist = stubBuylist({ 'fdn:35:nonfoil': makeQuote({ name: 'Serra Angel' }) })
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel, angelJa] },
      buylist: buylist.ctx,
    })
    // The [ja] line comes first: a language gate applied after the dedupe would
    // let it claim the shared `fdn:35:nonfoil` key and silently unprice the
    // English copy below it.
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        language: 'ja',
        section: 'Main',
        cardId: 1,
      },
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 2,
      },
    ])

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    expect(buylist.asked).toEqual([
      { set: 'fdn', collectorNumber: '35', finish: 'nonfoil', scryfallId: 'angel-fdn' },
    ])
    expect(detail.buylist?.cardkingdom?.quotes['fdn:35:nonfoil']).toMatchObject({ priceBuy: 4 })
  })

  test('a deck quotes the cheapest printing too, since the Lowest Price toggle displays it', async () => {
    const buylist = stubBuylist({ 'm10:146:nonfoil': makeQuote({ name: 'Lightning Bolt' }) })
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt },
        printings: { 'Lightning Bolt': [bolt, boltCheap] },
        cheapest: { usd: { 'Lightning Bolt': boltCheap } },
      },
      currencies: ['usd'],
      buylist: buylist.ctx,
    })
    const deck: LoadedDeck = {
      data: {
        name: 'Burn Deck',
        sections: [{ name: 'Mainboard', cards: [{ name: 'Lightning Bolt', quantity: 4 }] }],
      },
      changelog: [],
      warnings: [],
    }

    const { detail } = await buildDeckArtifacts(deck, ctx)

    // Both the representative and the cheapest printing are quoted: a baked-only
    // client cannot fetch the quote the toggle would need.
    expect(buylist.asked.map((printing) => printing.collectorNumber).sort()).toEqual(['146', '161'])
    expect(detail.buylist?.cardkingdom?.quotes['m10:146:nonfoil']).toMatchObject({ priceBuy: 4 })
  })

  test('a wanted list bakes its entries, deduplicating a printing two entries share', async () => {
    const buylist = stubBuylist({ 'fdn:35:nonfoil': makeQuote({ name: 'Serra Angel' }) })
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel] },
      buylist: buylist.ctx,
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 1,
        },
        {
          name: 'Serra Angel',
          quantity: 2,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 2,
        },
      ],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }

    const { detail } = await buildWantedArtifacts(loaded, ctx)

    // One ask for the printing both entries display — the map is keyed by
    // printing, so a second lookup would buy nothing.
    expect(buylist.asked).toHaveLength(1)
    expect(detail.buylist?.cardkingdom?.quotes['fdn:35:nonfoil']).toMatchObject({ priceBuy: 4 })
  })

  test('alternate printings are quoted only under quotePrintings, at every finish', async () => {
    const loaded = binder([
      {
        name: 'Serra Angel',
        quantity: 1,
        set: 'fdn',
        collectorNumber: '35',
        section: 'Main',
        cardId: 1,
      },
    ])
    // Two printings of the name, only one of them displayed: the other is what
    // the card modal's grid and the printing pickers offer.
    const printingsByName = { 'Serra Angel': [angel, foilOnly] }

    const off = recordingBuylist()
    await buildCollectionArtifacts(loaded, makeContext({ printingsByName, buylist: off.ctx }).ctx)
    expect(off.asked.map((p) => `${p.set}:${p.collectorNumber}:${p.finish}`)).toEqual([
      'fdn:35:nonfoil',
    ])

    const on = recordingBuylist(true)
    const { detail } = await buildCollectionArtifacts(
      loaded,
      makeContext({ printingsByName, buylist: on.ctx }).ctx,
    )
    // The displayed printing keeps its single ask (the dedupe holds), and the
    // undisplayed one is quoted in each finish it publishes.
    expect(on.asked.map((p) => `${p.set}:${p.collectorNumber}:${p.finish}`)).toEqual([
      'fdn:35:nonfoil',
      'fdn:35:foil',
      'fdn:400:foil',
    ])
    expect(Object.keys(detail.buylist?.cardkingdom?.quotes ?? {})).toContain('fdn:400:foil')
  })
})

/** A buylist seam recording every printing a builder offered a buyer. */
function recordingBuylist(quotePrintings = false): StubBuylist {
  const asked: BuylistQuoteRequest[] = []
  return {
    asked,
    ctx: {
      buyer: 'cardkingdom',
      quotePrintings,
      quote: (printing) => {
        asked.push(printing)
        return makeBuylistQuote({ name: 'Anything' })
      },
      feedCreatedAt: '2026-08-04 06:06:09',
      feedRetrievedAt: 1785850800000,
    },
  }
}

describe('by-rule priceless baking', () => {
  /**
   * A binder holding the $100 Bolt and a 50¢ Angel, with the Bolt made
   * priceless by whichever rule the case names. Every observable below is the
   * same for both rules — that sameness *is* the rule — so they share one table
   * rather than two blocks that drift apart.
   */
  function pricelessBinder(
    boltOverride: Partial<CollectionEntry>,
    art?: CardArtMap,
  ): LoadedCollection {
    return {
      displayName: 'Priceless Binder',
      entries: [
        {
          name: 'Lightning Bolt',
          quantity: 1,
          set: 'lea',
          collectorNumber: '161',
          section: 'Main',
          cardId: 1,
          ...boltOverride,
        },
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 2,
        },
      ],
      sectionOrder: ['Main'],
      art,
      warnings: [],
      changelog: [],
    }
  }

  const proxyBinder = pricelessBinder({ labels: ['proxy'] })
  const artBinder = pricelessBinder({}, new Map([[1, { url: 'https://example.com/art/bolt.png' }]]))

  const printingsByName = { 'Lightning Bolt': [bolt, boltCheap], 'Serra Angel': [angel] }

  const PRICELESS_BINDERS: [string, LoadedCollection][] = [
    ['a proxy', proxyBinder],
    ['a custom-art copy', artBinder],
  ]

  test.each(PRICELESS_BINDERS)(
    '%s bakes at zero, leaves the totals and missing counts alone, and is never quoted',
    async (_label, binder) => {
      const buylist = recordingBuylist()
      const { ctx } = makeContext({ printingsByName, buylist: buylist.ctx })

      const { detail, summary } = await buildCollectionArtifacts(binder, ctx)

      // The $100 Bolt is worth nothing here — and it is not a card whose price
      // is *missing* either, so no count moves.
      expect(detail.entries[0]).toMatchObject({ name: 'Lightning Bolt', price: 0 })
      expect(summary.totalPrice).toBeCloseTo(0.5)
      expect(summary.totalPriceEur).toBeCloseTo(0.4)
      expect(summary.totalPriceTix).toBeCloseTo(0.02)
      expect(summary.missingPriceCount).toBe(0)
      expect(summary.missingPriceCountEur).toBe(0)
      expect(summary.missingPriceCountTix).toBe(0)
      // No buyer is asked about it, so no quote can be baked for its printing.
      expect(buylist.asked.map((printing) => printing.set)).toEqual(['fdn'])
      expect(detail.buylist?.cardkingdom?.quotes).not.toHaveProperty('lea:161:nonfoil')
    },
  )

  test('a list-default proxy label makes an entry with no override a proxy', async () => {
    const { ctx } = makeContext({ printingsByName })
    const inherited: LoadedCollection = {
      ...proxyBinder,
      labels: ['proxy'],
      entries: proxyBinder.entries.map((entry) => ({ ...entry, labels: undefined })),
    }

    const { summary } = await buildCollectionArtifacts(inherited, ctx)

    expect(summary.totalPrice).toBe(0)
    expect(summary.missingPriceCount).toBe(0)
  })

  const proxyDeck: LoadedDeck = {
    data: {
      name: 'Proxy Deck',
      sections: [
        {
          name: 'Mainboard',
          cards: [
            { name: 'Lightning Bolt', quantity: 4, labels: ['proxy'] },
            { name: 'Serra Angel', quantity: 1 },
          ],
        },
      ],
    },
    changelog: [],
    warnings: [],
  }

  const deckCardData: Partial<SiteCardData> = {
    cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
    printings: { 'Lightning Bolt': [bolt, boltCheap], 'Serra Angel': [angel] },
    cheapest: { usd: { 'Lightning Bolt': boltCheap, 'Serra Angel': angel } },
  }

  test('deck totals skip proxies in every currency', async () => {
    const { ctx } = makeContext({ cardData: deckCardData, currencies: ['usd'] })

    const { detail, summary } = await buildDeckArtifacts(proxyDeck, ctx)

    // Only the Angel is real: 4x $100 of proxied Bolt counts for nothing.
    expect(summary.totalPrice).toBeCloseTo(0.5)
    expect(summary.lowestPrice).toBeCloseTo(0.5)
    // The card lines still ship their labels, so the client can badge them.
    expect(detail.deck.sections[0]?.cards[0]?.labels).toEqual(['proxy'])
  })

  test('an unpriced deck proxy is not counted as a missing price', async () => {
    const { ctx } = makeContext({
      cardData: { ...deckCardData, cards: { 'Serra Angel': angel } },
      currencies: ['usd'],
    })

    const { summary } = await buildDeckArtifacts(proxyDeck, ctx)

    expect(summary.missingPriceCount).toBe(0)
  })

  test('a deck proxy is never offered to a buyer, and the deck default applies', async () => {
    const buylist = recordingBuylist()
    const { ctx } = makeContext({
      cardData: deckCardData,
      currencies: ['usd'],
      buylist: buylist.ctx,
    })
    // No per-line override anywhere: the deck's front-matter default proxies
    // every card in it.
    const allProxy: LoadedDeck = {
      ...proxyDeck,
      labels: ['proxy'],
      data: {
        ...proxyDeck.data,
        sections: [
          {
            name: 'Mainboard',
            cards: proxyDeck.data.sections[0]!.cards.map((card) => ({
              ...card,
              labels: undefined,
            })),
          },
        ],
      },
    }

    const { detail, summary } = await buildDeckArtifacts(allProxy, ctx)

    expect(buylist.asked).toHaveLength(0)
    expect(summary.totalPrice).toBe(0)
    // The default is baked so the client resolves the same effective labels.
    expect(detail.labels).toEqual(['proxy'])
  })
})

describe('custom art baking', () => {
  test('a collection bakes file refs as site paths and URLs verbatim', async () => {
    const { ctx } = makeContext({ printingsByName: { 'Serra Angel': [angel] } })
    const loaded: LoadedCollection = {
      displayName: 'Art Binder',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 1,
        },
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 2,
        },
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 3,
        },
      ],
      sectionOrder: ['Main'],
      art: artMap({
        1: { file: 'proxies/sol ring.jpg' },
        2: { url: 'https://example.com/art/bolt.png' },
      }),
      warnings: [],
      changelog: [],
    }

    const { detail } = await buildCollectionArtifacts(loaded, ctx)

    // Each segment is encoded on its own, so the space survives as one segment.
    expect(detail.entries[0]?.customArt).toBe('art/proxies/sol%20ring.jpg')
    expect(detail.entries[1]?.customArt).toBe('https://example.com/art/bolt.png')
    // A card the sidecar says nothing about keeps its real art.
    expect(detail.entries[2]?.customArt).toBeUndefined()
  })

  test('a file the build could not deploy is left out entirely', async () => {
    const { ctx } = makeContext({
      printingsByName: { 'Serra Angel': [angel] },
      missingArtFiles: new Set(['gone.jpg']),
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 7,
        },
      ],
      sectionOrder: ['Main'],
      art: artMap({ 7: { file: 'gone.jpg' } }),
      warnings: [],
      changelog: [],
    }

    const { detail } = await buildWantedArtifacts(loaded, ctx)

    // Absent, not an `art/gone.jpg` that would render as a broken image.
    expect(detail.entries[0]?.customArt).toBeUndefined()
    expect(JSON.parse(JSON.stringify(detail)).entries[0]).not.toHaveProperty('customArt')
  })

  test('a deck bakes custom art onto the card line, leaving the others untouched', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Lightning Bolt': [bolt] },
      },
      currencies: ['usd'],
    })
    const loaded: LoadedDeck = {
      data: {
        name: 'Art Deck',
        sections: [
          {
            name: 'Mainboard',
            cards: [
              { name: 'Lightning Bolt', quantity: 4, cardId: 1 },
              { name: 'Serra Angel', quantity: 1, cardId: 2 },
            ],
          },
        ],
      },
      art: artMap({ 1: { file: 'bolt.png' } }),
      changelog: [],
      warnings: [],
    }

    const { detail } = await buildDeckArtifacts(loaded, ctx)

    expect(detail.deck.sections[0]?.cards[0]?.customArt).toBe('art/bolt.png')
    expect(detail.deck.sections[0]?.cards[1]?.customArt).toBeUndefined()
  })

  const artDeck = (art: CardArtMap): LoadedDeck => ({
    data: {
      name: 'Art Deck',
      sections: [
        { name: 'Commander', cards: [{ name: 'Serra Angel', quantity: 1, cardId: 1 }] },
        { name: 'Mainboard', cards: [{ name: 'Lightning Bolt', quantity: 4, cardId: 2 }] },
      ],
    },
    art,
    changelog: [],
    warnings: [],
  })

  test('a commander wearing custom art features that art, not its printing', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel] },
      },
    })
    const { summary } = await buildDeckArtifacts(artDeck(artMap({ 1: { file: 'angel.png' } })), ctx)

    expect(summary.featuredCardImage).toBe('art/angel.png')
  })

  test('art on a line the cover does not feature leaves the cover alone', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel] },
      },
    })
    // Art on the mainboard Bolt, while the commander is what the cover shows.
    const { summary } = await buildDeckArtifacts(artDeck(artMap({ 2: { file: 'bolt.png' } })), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
  })

  test('a commanderless deck wears the art of the line its cover features', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel] },
      },
    })
    const loaded: LoadedDeck = {
      data: {
        name: 'Art Deck',
        sections: [
          {
            name: 'Mainboard',
            cards: [
              { name: 'Serra Angel', quantity: 1, cardId: 1 },
              // The priciest line, so the cover's — and it wears custom art.
              { name: 'Lightning Bolt', quantity: 4, cardId: 2 },
            ],
          },
        ],
      },
      art: artMap({ 1: { file: 'angel.png' }, 2: { file: 'bolt.png' } }),
      changelog: [],
      warnings: [],
    }

    const { summary } = await buildDeckArtifacts(loaded, ctx)

    expect(summary.commander).toBeNull()
    expect(summary.featuredCardImage).toBe('art/bolt.png')
  })

  test('art the build could not deploy leaves the tile on the real printing', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel] },
      },
      missingArtFiles: new Set(['angel.png']),
    })
    const { summary } = await buildDeckArtifacts(artDeck(artMap({ 1: { file: 'angel.png' } })), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
  })

  // The Bolt is the priciest line and wears the art; the Angel is there so the
  // cover has a plainer, cheaper rival to pass over.
  const artFlatEntries = [
    {
      name: 'Lightning Bolt',
      quantity: 1,
      set: 'lea',
      collectorNumber: '161',
      section: 'Main',
      cardId: 4,
    },
    {
      name: 'Serra Angel',
      quantity: 1,
      set: 'fdn',
      collectorNumber: '35',
      section: 'Main',
      cardId: 5,
    },
  ]
  const artFlatContext = (): StubContext =>
    makeContext({ printingsByName: { 'Lightning Bolt': [bolt], 'Serra Angel': [angel] } })

  test('a featured collection entry wearing custom art features that art', async () => {
    const loaded: LoadedCollection = {
      displayName: 'Art Binder',
      entries: artFlatEntries,
      sectionOrder: ['Main'],
      art: artMap({ 4: { url: 'https://example.com/art/bolt.png' } }),
      warnings: [],
      changelog: [],
    }

    const { summary } = await buildCollectionArtifacts(loaded, artFlatContext().ctx)

    expect(summary.featuredCardImage).toBe('https://example.com/art/bolt.png')
  })

  test('a featured wanted entry wearing custom art features that art', async () => {
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: artFlatEntries,
      sectionOrder: ['Main'],
      art: artMap({ 4: { url: 'https://example.com/art/bolt.png' } }),
      warnings: [],
      changelog: [],
    }

    const { summary } = await buildWantedArtifacts(loaded, artFlatContext().ctx)

    expect(summary.featuredCardImage).toBe('https://example.com/art/bolt.png')
  })

  test('a flat list’s cover ignores art on an entry it does not feature', async () => {
    const loaded: LoadedCollection = {
      displayName: 'Art Binder',
      entries: artFlatEntries,
      // Art on the Angel, which the cover passes over for the pricier Bolt.
      art: artMap({ 5: { url: 'https://example.com/art/angel.png' } }),
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }

    const { summary } = await buildCollectionArtifacts(loaded, artFlatContext().ctx)

    expect(summary.featuredCardImage).toBe('https://img/bolt.jpg')
  })

  // A collection entry's zero price and missing quote are pinned alongside the
  // proxy label's in the `by-rule priceless baking` table above — same binder,
  // same observables, one rule.

  test('a wanted entry with custom art bakes at zero and is never quoted', async () => {
    const buylist = recordingBuylist()
    const { ctx } = makeContext({
      cardData: { cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel } },
      printingsByName: { 'Lightning Bolt': [bolt], 'Serra Angel': [angel] },
      buylist: buylist.ctx,
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        {
          name: 'Lightning Bolt',
          quantity: 1,
          set: 'lea',
          collectorNumber: '161',
          finish: 'nonfoil',
          section: 'Main',
          cardId: 1,
        },
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          finish: 'nonfoil',
          section: 'Main',
          cardId: 2,
        },
      ],
      sectionOrder: ['Main'],
      art: artMap({ 1: { file: 'bolt.png' } }),
      warnings: [],
      changelog: [],
    }

    const { detail, summary } = await buildWantedArtifacts(loaded, ctx)

    expect(detail.entries[0]).toMatchObject({ name: 'Lightning Bolt', price: 0 })
    expect(summary.totalPrice).toBeCloseTo(0.5)
    expect(summary.missingPriceCount).toBe(0)
    expect(buylist.asked.map((printing) => printing.set)).toEqual(['fdn'])
    // The cover ranks by the printing's own price, not the baked zero, so the
    // custom-art Bolt is still the list's face despite being worth nothing.
    expect(summary.featuredCardImage).toBe('art/bolt.png')
  })

  test('an art file the build could not deploy still prices at nothing', async () => {
    // The sidecar reference is the fact, not the file that came out of the
    // build: `ritual price` and `ritual sell` read the reference, so a bake that
    // priced this card would have the site quoting retail (and a buylist offer)
    // for a copy the CLI reports as CUSTOM.
    const buylist = recordingBuylist()
    const { ctx } = makeContext({
      cardData: { cards: { 'Lightning Bolt': bolt } },
      printingsByName: { 'Lightning Bolt': [bolt] },
      missingArtFiles: new Set(['gone.jpg']),
      buylist: buylist.ctx,
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        {
          name: 'Lightning Bolt',
          quantity: 1,
          set: 'lea',
          collectorNumber: '161',
          finish: 'nonfoil',
          section: 'Main',
          cardId: 1,
        },
      ],
      sectionOrder: ['Main'],
      art: artMap({ 1: { file: 'gone.jpg' } }),
      warnings: [],
      changelog: [],
    }

    const { detail, summary } = await buildWantedArtifacts(loaded, ctx)

    // No image to show — the card falls back to its real art — but the copy
    // still wears custom art, which is what the client's marker reads.
    expect(detail.entries[0]?.customArt).toBeUndefined()
    expect(detail.entries[0]?.hasCustomArt).toBe(true)
    expect(cardPricelessReason(detail.entries[0]!)).toBe('custom-art')
    expect(detail.entries[0]?.price).toBe(0)
    expect(summary.totalPrice).toBe(0)
    expect(summary.missingPriceCount).toBe(0)
    expect(buylist.asked).toEqual([])
  })

  test('a deck card whose art file was not deployed is priceless too', async () => {
    const buylist = recordingBuylist()
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Lightning Bolt': [bolt], 'Serra Angel': [angel] },
        cheapest: { usd: { 'Lightning Bolt': bolt, 'Serra Angel': angel } },
      },
      currencies: ['usd'],
      missingArtFiles: new Set(['gone.jpg']),
      buylist: buylist.ctx,
    })
    const loaded: LoadedDeck = {
      data: {
        name: 'Art Deck',
        sections: [
          {
            name: 'Mainboard',
            cards: [
              { name: 'Lightning Bolt', quantity: 4, cardId: 1 },
              { name: 'Serra Angel', quantity: 1, cardId: 2 },
            ],
          },
        ],
      },
      art: artMap({ 1: { file: 'gone.jpg' } }),
      changelog: [],
      warnings: [],
    }

    const { detail, summary } = await buildDeckArtifacts(loaded, ctx)

    const boltLine = detail.deck.sections[0]?.cards[0]
    expect(boltLine?.customArt).toBeUndefined()
    expect(boltLine?.hasCustomArt).toBe(true)
    expect(cardPricelessReason(boltLine!)).toBe('custom-art')
    // Only the Angel is left in the totals, the missing counts, and the quotes.
    expect(summary.totalPrice).toBeCloseTo(0.5)
    expect(summary.missingPriceCount).toBe(0)
    expect(buylist.asked.map((printing) => printing.set)).toEqual(['fdn'])
  })

  test('deck totals and quotes skip a card with custom art', async () => {
    const buylist = recordingBuylist()
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Lightning Bolt': [bolt], 'Serra Angel': [angel] },
        cheapest: { usd: { 'Lightning Bolt': bolt, 'Serra Angel': angel } },
      },
      currencies: ['usd'],
      buylist: buylist.ctx,
    })
    const loaded: LoadedDeck = {
      data: {
        name: 'Art Deck',
        sections: [
          {
            name: 'Mainboard',
            cards: [
              { name: 'Lightning Bolt', quantity: 4, cardId: 1 },
              { name: 'Serra Angel', quantity: 1, cardId: 2 },
            ],
          },
        ],
      },
      art: artMap({ 1: { file: 'bolt.png' } }),
      changelog: [],
      warnings: [],
    }

    const { summary } = await buildDeckArtifacts(loaded, ctx)

    expect(summary.totalPrice).toBeCloseTo(0.5)
    expect(summary.lowestPrice).toBeCloseTo(0.5)
    expect(summary.missingPriceCount).toBe(0)
    expect(buylist.asked.map((printing) => printing.set)).toEqual(['fdn'])
  })
})

describe('Card Kingdom printing selection', () => {
  /**
   * CK's picks: a different representative from Scryfall's, a different
   * cheapest from *both*, and a pick for the pinned card's name that the
   * builders must refuse to key. Three distinct printings is what makes each
   * map's candidate separately observable in the bake's quote asks.
   */
  const boltCkCheapest = makeScryfallCard({
    id: 'bolt-chp',
    name: 'Lightning Bolt',
    set: 'chp',
    collector_number: '9',
    released_at: '2019-01-01',
    prices: { usd: '0.20' },
    image_uris: imageUris('https://img/bolt-chp.jpg'),
  })
  const angelCk = makeScryfallCard({
    id: 'angel-ck',
    name: 'Serra Angel',
    set: 'ckp',
    collector_number: '7',
    released_at: '2023-01-01',
    prices: { usd: '0.60' },
    image_uris: imageUris('https://img/angel-ck.jpg'),
  })

  const cardKingdom = {
    cards: { 'Lightning Bolt': boltCheap, 'Serra Angel': angelCk },
    cheapest: { 'Lightning Bolt': boltCkCheapest, 'Serra Angel': angelCk },
  }

  const deck: LoadedDeck = {
    data: {
      name: 'CK Deck',
      sections: [{ name: 'Mainboard', cards: [{ name: 'Lightning Bolt', quantity: 4 }] }],
    },
    changelog: [],
    warnings: [],
  }

  const deckCardData: Partial<SiteCardData> = {
    cards: { 'Lightning Bolt': bolt },
    printings: { 'Lightning Bolt': [bolt, boltCheap, boltCkCheapest] },
    cheapest: { usd: { 'Lightning Bolt': bolt } },
    cardKingdom,
  }

  test("a deck ships CK's picks beside the Scryfall ones, and quotes both", async () => {
    const buylist = stubBuylist({
      'm10:146:nonfoil': makeBuylistQuote({ priceRetail: 2, name: 'Lightning Bolt' }),
      'chp:9:nonfoil': makeBuylistQuote({ priceRetail: 1, name: 'Lightning Bolt' }),
    })
    const { ctx } = makeContext({
      cardData: deckCardData,
      currencies: ['usd'],
      buylist: buylist.ctx,
    })

    const { detail } = await buildDeckArtifacts(deck, ctx)

    // The Scryfall maps are untouched — the CK maps are an override layer.
    expect(detail.cards['Lightning Bolt']).toBe(bolt)
    expect(detail.cardsCardKingdom?.['Lightning Bolt']).toBe(boltCheap)
    expect(detail.lowestPriceCardsCardKingdom?.['Lightning Bolt']).toBe(boltCkCheapest)
    // Both CK picks are quoted, or the tile that displays one would price at 0 —
    // the whole point of picking it. Asserted through the baked map, not just
    // the ask list, so the quote has to survive into the payload.
    expect(detail.buylist?.cardkingdom?.quotes['m10:146:nonfoil']?.priceRetail).toBe(2)
    expect(detail.buylist?.cardkingdom?.quotes['chp:9:nonfoil']?.priceRetail).toBe(1)
  })

  test('a build with no CK data leaves both fields off the deck detail', async () => {
    const { ctx } = makeContext({
      cardData: { ...deckCardData, cardKingdom: undefined },
      currencies: ['usd'],
    })

    const { detail } = await buildDeckArtifacts(deck, ctx)

    const serialized = JSON.parse(JSON.stringify(detail))
    expect(serialized).not.toHaveProperty('cardsCardKingdom')
    expect(serialized).not.toHaveProperty('lowestPriceCardsCardKingdom')
  })

  test('a build without USD ships no CK picks, however much CK data it holds', async () => {
    // Card Kingdom is a USD store; a EUR-only build has nothing to offer them to.
    const { ctx } = makeContext({
      cardData: { ...deckCardData, cheapest: { eur: { 'Lightning Bolt': boltCheap } } },
      currencies: ['eur'],
    })

    const { detail } = await buildDeckArtifacts(deck, ctx)

    expect(detail.cardsCardKingdom).toBeUndefined()
    expect(detail.lowestPriceCardsCardKingdom).toBeUndefined()
  })

  test("a deck's pinned line keeps its printing, and claims no by-name override", async () => {
    const pinned: LoadedDeck = {
      ...deck,
      data: {
        name: 'CK Deck',
        sections: [
          {
            name: 'Mainboard',
            cards: [{ name: 'Serra Angel', quantity: 1, set: 'fdn', collectorNumber: '35' }],
          },
        ],
      },
    }
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel, angelCk] },
        cheapest: { usd: { 'Serra Angel': angel } },
        cardKingdom,
      },
      currencies: ['usd'],
    })

    const { detail } = await buildDeckArtifacts(pinned, ctx)

    // CK picked a printing for the name, and the bake drops it: the line names
    // its own printing, and a by-name override could only displace it.
    expect(detail.cardsCardKingdom).toBeUndefined()
    // The "Lowest Price" toggle ignores an entry's pin by design, so its map
    // deliberately keeps the name.
    expect(detail.lowestPriceCardsCardKingdom?.['Serra Angel']).toBe(angelCk)
  })

  test('a wanted list overrides only its name-only entries', async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt },
        cheapest: { usd: { 'Lightning Bolt': bolt } },
        cardKingdom,
      },
      printingsByName: {
        'Lightning Bolt': [bolt, boltCheap, boltCkCheapest],
        'Serra Angel': [angel],
      },
      currencies: ['usd'],
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [
        { name: 'Lightning Bolt', quantity: 1, section: 'Main', cardId: 1 },
        {
          name: 'Serra Angel',
          quantity: 1,
          set: 'fdn',
          collectorNumber: '35',
          section: 'Main',
          cardId: 2,
        },
      ],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }

    const { detail } = await buildWantedArtifacts(loaded, ctx)

    // A wanted entry displays the *cheapest* printing, so CK's cheapest is its
    // override — and the pinned entry gets none even though CK picked for it.
    expect(detail.cardsCardKingdom).toEqual({ 'Lightning Bolt': boltCkCheapest })
  })

  test("a wanted list falls back to CK's representative when it has no cheapest", async () => {
    const { ctx } = makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt },
        cheapest: { usd: { 'Lightning Bolt': bolt } },
        cardKingdom: { cards: { 'Lightning Bolt': boltCheap }, cheapest: {} },
      },
      printingsByName: { 'Lightning Bolt': [bolt, boltCheap] },
      currencies: ['usd'],
    })
    const loaded: LoadedWanted = {
      displayName: 'Wants',
      entries: [{ name: 'Lightning Bolt', quantity: 1, section: 'Main', cardId: 1 }],
      sectionOrder: ['Main'],
      warnings: [],
      changelog: [],
    }

    const { detail } = await buildWantedArtifacts(loaded, ctx)

    expect(detail.cardsCardKingdom).toEqual({ 'Lightning Bolt': boltCheap })
  })
})

/**
 * A list's `image:` front-matter override — the cover the index tile shows
 * instead of the built-in pick (a deck's commander, a flat list's most
 * expensive printing). The grammar itself is pinned in
 * test/unit/list-image.test.ts; these are the site's *resolution* rules: which
 * image is baked, and which failures warn.
 */
describe('list cover overrides', () => {
  /** Commander Angel (the built-in cover) plus a cheaper mainboard Bolt. */
  const coverDeck = (image: ListImageRef | undefined, art?: CardArtMap): LoadedDeck => ({
    data: {
      name: 'Cover Deck',
      sections: [
        { name: 'Commander', cards: [{ name: 'Serra Angel', quantity: 1, cardId: 1 }] },
        { name: 'Mainboard', cards: [{ name: 'Lightning Bolt', quantity: 4, cardId: 2 }] },
      ],
    },
    ...(image ? { image } : {}),
    ...(art ? { art } : {}),
    changelog: [],
    warnings: [],
  })

  const deckContext = (options: StubContextOptions = {}): StubContext =>
    makeContext({
      cardData: {
        cards: { 'Lightning Bolt': bolt, 'Serra Angel': angel },
        printings: { 'Serra Angel': [angel], 'Lightning Bolt': [bolt] },
      },
      ...options,
    })

  /** The Bolt is the priciest line, so the built-in cover; the Angel is cheaper. */
  const coverEntries: CollectionEntry[] = [
    {
      name: 'Lightning Bolt',
      quantity: 1,
      set: 'lea',
      collectorNumber: '161',
      section: 'Main',
      cardId: 4,
    },
    {
      name: 'Serra Angel',
      quantity: 1,
      set: 'fdn',
      collectorNumber: '35',
      section: 'Main',
      cardId: 5,
    },
  ]

  const coverCollection = (
    image: ListImageRef | undefined,
    art?: CardArtMap,
  ): LoadedCollection => ({
    displayName: 'Cover Binder',
    entries: coverEntries,
    sectionOrder: ['Main'],
    ...(image ? { image } : {}),
    ...(art ? { art } : {}),
    warnings: [],
    changelog: [],
  })

  const flatContext = (options: StubContextOptions = {}): StubContext =>
    makeContext({
      printingsByName: { 'Lightning Bolt': [bolt], 'Serra Angel': [angel] },
      ...options,
    })

  test('a url cover is baked verbatim and never validated', async () => {
    const { ctx, warnings } = deckContext()
    const { summary } = await buildDeckArtifacts(
      coverDeck({ url: 'https://example.com/cover.jpg' }),
      ctx,
    )

    expect(summary.featuredCardImage).toBe('https://example.com/cover.jpg')
    expect(warnings).toEqual([])
  })

  test('a file cover is baked as the site art path', async () => {
    const { ctx } = deckContext()
    const { summary } = await buildDeckArtifacts(coverDeck({ file: 'covers/atraxa.png' }), ctx)

    expect(summary.featuredCardImage).toBe('art/covers/atraxa.png')
  })

  test('a file cover the build could not deploy falls back with no detail-level warning', async () => {
    // `build-site` already prints one art-missing line for the path, so a
    // second message from the detail builder would be a duplicate.
    const { ctx, warnings } = deckContext({ missingArtFiles: new Set(['covers/gone.png']) })
    const { summary } = await buildDeckArtifacts(coverDeck({ file: 'covers/gone.png' }), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(warnings).toEqual([])
  })

  test('a card cover features that line, not the built-in pick', async () => {
    const { ctx, warnings } = deckContext()
    // The Bolt, while the commander Angel is what the deck would feature.
    const { summary } = await buildDeckArtifacts(coverDeck({ card: 2 }), ctx)

    expect(summary.featuredCardImage).toBe('https://img/bolt.jpg')
    expect(warnings).toEqual([])
    // The commander fact is the deck's own and is untouched by the cover.
    expect(summary.commander).toBe('Serra Angel')
  })

  test('a card cover on a line wearing custom art shows the custom art', async () => {
    const { ctx } = deckContext()
    const { summary } = await buildDeckArtifacts(
      coverDeck({ card: 2 }, artMap({ 2: { file: 'bolt.png' } })),
      ctx,
    )

    expect(summary.featuredCardImage).toBe('art/bolt.png')
  })

  test('a card cover naming an id the list no longer has warns once and falls back', async () => {
    const { ctx, warnings } = deckContext()
    const { summary } = await buildDeckArtifacts(coverDeck({ card: 99 }), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(warnings).toHaveLength(1)
    // The raw id, deliberately not resolved to a card name.
    expect(warnings[0]).toContain('&99')
    expect(warnings[0]).toContain('Cover Deck')
  })

  test('a card cover whose printing does not resolve falls back silently', async () => {
    // Deliberate: the unresolvable-printing warning already fired on that
    // entry, and warning again here would double-warn every list holding a pin
    // the cache cannot satisfy.
    const { ctx, warnings } = flatContext({ printingsByName: { 'Serra Angel': [angel] } })
    const { summary } = await buildCollectionArtifacts(coverCollection({ card: 4 }), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    // Exactly one warning — the entry's own unresolvable printing, not a second
    // one about the cover.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Could not find printing')
  })

  test('a collection card cover features that entry', async () => {
    const { ctx, warnings } = flatContext()
    // The Angel, which the price-ranked built-in pick would pass over.
    const { summary } = await buildCollectionArtifacts(coverCollection({ card: 5 }), ctx)

    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(warnings).toEqual([])
  })

  test('the detail bakes the cover reference itself, so a download re-emits it', async () => {
    // The browser rebuilds the front matter of a downloaded `.md` from the
    // baked detail alone: a cover absent from it is a cover the download loses.
    const { ctx } = flatContext()
    const { detail } = await buildCollectionArtifacts(
      coverCollection({ file: 'covers/binder.png' }),
      ctx,
    )

    expect(detail.listImage).toEqual({ file: 'covers/binder.png' })
    const plain = await buildCollectionArtifacts(coverCollection(undefined), ctx)
    expect(plain.detail.listImage).toBeUndefined()
  })

  test('a wanted list honours every mode the same way a collection does', async () => {
    const loaded = (image: ListImageRef): LoadedWanted => ({
      displayName: 'Cover Wants',
      entries: coverEntries,
      sectionOrder: ['Main'],
      image,
      warnings: [],
      changelog: [],
    })

    const byCard = await buildWantedArtifacts(loaded({ card: 5 }), flatContext().ctx)
    expect(byCard.summary.featuredCardImage).toBe('https://img/angel.jpg')

    const byFile = await buildWantedArtifacts(loaded({ file: 'covers/x.png' }), flatContext().ctx)
    expect(byFile.summary.featuredCardImage).toBe('art/covers/x.png')

    const stale = flatContext()
    const byStaleCard = await buildWantedArtifacts(loaded({ card: 99 }), stale.ctx)
    expect(byStaleCard.summary.featuredCardImage).toBe('https://img/bolt.jpg')
    expect(stale.warnings.filter((w) => w.includes('&99'))).toHaveLength(1)
  })

  test('no override leaves every list on the built-in cover', async () => {
    const { summary: deck } = await buildDeckArtifacts(coverDeck(undefined), deckContext().ctx)
    expect(deck.featuredCardImage).toBe('https://img/angel.jpg')

    const { summary: collection } = await buildCollectionArtifacts(
      coverCollection(undefined),
      flatContext().ctx,
    )
    expect(collection.featuredCardImage).toBe('https://img/bolt.jpg')
  })
})
