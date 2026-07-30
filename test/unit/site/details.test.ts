import { describe, expect, test } from 'bun:test'
import { makeScryfallCard } from '../../../test/test-utils'
import { slugifyListName } from '../../../src/site/details/shared'
import { buildDeckArtifacts, type LoadedDeck } from '../../../src/site/details/deck'
import {
  buildCollectionArtifacts,
  type LoadedCollection,
} from '../../../src/site/details/collection'
import { buildWantedArtifacts, type LoadedWanted } from '../../../src/site/details/wanted'
import type { SiteCardData, SiteDetailContext } from '../../../src/site/details/types'
import type { ScryfallCard } from '../../../src/types'
import type { ChangelogPage } from '../../../src/changelog-parser'

type StubContextOptions = {
  cardData?: Partial<SiteCardData>
  printingsByName?: Record<string, ScryfallCard[]>
  canonicalNames?: Record<string, string>
  currencies?: SiteDetailContext['availableCurrencies']
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
