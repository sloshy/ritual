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
import type { ChangelogPage } from '../../../src/changelog-parser'

type StubContextOptions = {
  cardData?: Partial<SiteCardData>
  printingsByName?: Record<string, ScryfallCard[]>
  canonicalNames?: Record<string, string>
  currencies?: SiteDetailContext['availableCurrencies']
  /** Attach a buylist seam; absent means the builder must bake no `buylist` field. */
  buylist?: DetailBuylistContext
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
    const { ctx } = makeContext({ cardData })
    const { slug, detail, summary } = await buildDeckArtifacts(deck, ctx)

    expect(slug).toBe('burn-deck')
    expect(summary.commander).toBe('Serra Angel')
    expect(summary.featuredCardImage).toBe('https://img/angel.jpg')
    expect(detail.cards['Lightning Bolt']).toBe(bolt)
    expect(detail.printings['Lightning Bolt']).toEqual([bolt, boltCheap])
    expect(detail.lowestPriceCards?.['Lightning Bolt']).toBe(boltCheap)
    expect(summary.lastUpdatedAt).toBe('2026-07-01T00:00:00.000Z')
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

describe('buylist baking', () => {
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
   * builder decided a tile displays — not just what came back.
   */
  function stubBuylist(catalog: Record<string, BuylistQuote> = {}): StubBuylist {
    const asked: BuylistQuoteRequest[] = []
    return {
      asked,
      ctx: {
        buyer: 'cardkingdom',
        quote: (printing) => {
          asked.push(printing)
          return catalog[quoteKey(printing.set, printing.collectorNumber, printing.finish)] ?? null
        },
        feedCreatedAt: FEED_CREATED_AT,
        feedRetrievedAt: FEED_RETRIEVED_AT,
      },
    }
  }

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
})
