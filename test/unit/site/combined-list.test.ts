import { describe, expect, test } from 'bun:test'
import {
  encodeCombinedHash,
  listRefKey,
  parseCombinedQuery,
  buildCombinedCards,
  mergeSymbolMaps,
  mergeBakedBuylists,
  mergeCardMaps,
  mergePrintingMaps,
  type LoadedListDetail,
} from '../../../src/site/combined-list'
import { groupAndSortCards } from '../../../src/site/card-sorting'
import type {
  BakedBuylist,
  BakedBuylistQuotes,
  DeckDetail,
  CollectionDetail,
  WantedListDetail,
} from '../../../src/site/data-types'
import type { ScryfallCard } from '../../../src/types'
import { makeBuylistQuote, makeScryfallCard } from '../../test-utils'

const solRing = makeScryfallCard({
  id: 'sol',
  name: 'Sol Ring',
  set: 'c21',
  collector_number: '263',
})
const bolt = makeScryfallCard({
  id: 'bolt',
  name: 'Lightning Bolt',
  type_line: 'Instant',
  set: 'lea',
  collector_number: '161',
  color_identity: ['R'],
})

/**
 * The fields that make a list entry priceless by rule. `hasCustomArt` without a
 * `customArt` URL is the undeployed-file case: the build could not copy the
 * image, so the card shows its real printing and is priceless all the same.
 */
type PricelessEntryOverride = { labels?: string[]; customArt?: string; hasCustomArt?: boolean }

function deckDetail(): Extract<LoadedListDetail, { kind: 'deck' }> {
  const detail = {
    deck: {
      name: 'My Deck',
      sections: [
        {
          name: 'Main',
          cards: [{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 }],
        },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Lightning Bolt', cardId: 2 }] },
      ],
    },
    cards: { 'Sol Ring': solRing, 'Lightning Bolt': bolt },
    printings: { 'Sol Ring': [solRing], 'Lightning Bolt': [bolt] },
    symbolMap: { '{R}': 'images/symbols/R.svg' },
  } as unknown as DeckDetail
  return { ref: { type: 'deck', slug: 'my-deck' }, name: 'My Deck', kind: 'deck', detail }
}

function collectionDetail(): Extract<LoadedListDetail, { kind: 'collection' }> {
  const detail = {
    name: 'My Box',
    entries: [
      {
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '263',
        finish: 'nonfoil',
        condition: 'NM',
        price: 2,
        fileOrder: 0,
        section: 'Main',
        cardId: 1,
      },
    ],
    cards: { 'c21:263': solRing },
    printings: { 'Sol Ring': [solRing] },
    symbolMap: { '{1}': 'images/symbols/1.svg' },
  } as unknown as CollectionDetail
  return { ref: { type: 'collection', slug: 'my-box' }, name: 'My Box', kind: 'collection', detail }
}

function wantedDetail(): Extract<LoadedListDetail, { kind: 'wanted' }> {
  const detail = {
    name: 'My Wants',
    entries: [
      {
        name: 'Lightning Bolt',
        price: 1,
        fileOrder: 0,
        section: 'Main',
        state: 'name-only',
        cardId: 1,
      },
    ],
    cards: { 'Lightning Bolt': bolt },
    printings: { 'Lightning Bolt': [bolt] },
    symbolMap: {},
  } as unknown as WantedListDetail
  return { ref: { type: 'wanted', slug: 'my-wants' }, name: 'My Wants', kind: 'wanted', detail }
}

describe('listRefKey', () => {
  test('is the type and slug joined by a colon', () => {
    expect(listRefKey({ type: 'deck', slug: 'burn' })).toBe('deck:burn')
  })
})

describe('parseCombinedQuery / encodeCombinedHash', () => {
  test('round-trips an explicit list of refs', () => {
    const selection = {
      all: false,
      refs: [
        { type: 'deck' as const, slug: 'my-deck' },
        { type: 'collection' as const, slug: 'red-binder' },
      ],
    }
    const hash = encodeCombinedHash(selection)
    expect(hash).toBe('/combined?lists=deck:my-deck,collection:red-binder')
    expect(parseCombinedQuery('lists=deck:my-deck,collection:red-binder')).toEqual(selection)
  })

  test('round-trips the all selection', () => {
    expect(encodeCombinedHash({ all: true, refs: [] })).toBe('/combined?all')
    expect(parseCombinedQuery('all')).toEqual({ all: true, refs: [] })
  })

  test('round-trips an all-of-one-type selection', () => {
    expect(encodeCombinedHash({ all: true, allType: 'deck', refs: [] })).toBe('/combined?all=deck')
    expect(parseCombinedQuery('all=deck')).toEqual({ all: true, allType: 'deck', refs: [] })
    expect(parseCombinedQuery('all=collection')).toEqual({
      all: true,
      allType: 'collection',
      refs: [],
    })
  })

  test('treats an unknown all type as plain all (every list)', () => {
    expect(parseCombinedQuery('all=bogus')).toEqual({ all: true, refs: [] })
  })

  test('drops unknown list types, empty slugs, and duplicates', () => {
    const parsed = parseCombinedQuery('lists=deck:a,bogus:b,collection:,deck:a,wanted:c')
    expect(parsed).toEqual({
      all: false,
      refs: [
        { type: 'deck', slug: 'a' },
        { type: 'wanted', slug: 'c' },
      ],
    })
  })

  test('empty query yields an empty, non-all selection', () => {
    expect(parseCombinedQuery('')).toEqual({ all: false, refs: [] })
  })
})

describe('buildCombinedCards', () => {
  const loaded = [deckDetail(), collectionDetail(), wantedDetail()]
  const cards = buildCombinedCards(loaded, 'usd', false)

  test('flattens every entry from every list, never combining across lists', () => {
    // 2 deck entries + 1 collection + 1 wanted = 4 tiles (the deck quantity-2 line is one tile).
    expect(cards).toHaveLength(4)
  })

  test('tags each card with its source list identity', () => {
    expect(cards.map((c) => `${c.sourceKind}:${c.sourceName}`)).toEqual([
      'deck:My Deck',
      'deck:My Deck',
      'collection:My Box',
      'wanted:My Wants',
    ])
    expect(cards[0]!.sourceSlug).toBe('my-deck')
    expect(cards[2]!.sourceSlug).toBe('my-box')
  })

  test('builds globally-namespaced selection keys matching the source list scheme', () => {
    expect(cards[0]!.selectKey).toBe('deck My Deck 0')
    expect(cards[1]!.selectKey).toBe('deck My Deck 1')
    expect(cards[2]!.selectKey).toBe('collection My Box 0')
    expect(cards[3]!.selectKey).toBe('wanted My Wants 0')
    // The prebuilt SelectedCard must carry the same global key.
    for (const c of cards) expect(c.selectedTile.key).toBe(c.selectKey)
  })

  test('preserves deck per-line quantity but uses quantity 1 for flat-list entries', () => {
    expect(cards[0]!.quantity).toBe(2)
    expect(cards[2]!.quantity).toBe(1)
    expect(cards[3]!.quantity).toBe(1)
  })

  test('marks specific vs name-only printings', () => {
    expect(cards[0]!.hasPrinting).toBe(true) // deck Sol Ring pinned
    expect(cards[1]!.hasPrinting).toBe(false) // deck Bolt name-only
    expect(cards[2]!.hasPrinting).toBe(true) // collection always pinned
    expect(cards[3]!.hasPrinting).toBe(false) // wanted name-only
  })

  test('assigns a global running fileOrder across lists in selection order', () => {
    expect(cards.map((c) => c.fileOrder)).toEqual([0, 1, 2, 3])
  })

  test('preserves section names from each source list', () => {
    expect(cards.map((c) => c.section)).toEqual(['Main', 'Sideboard', 'Main', 'Main'])
  })

  test("a wanted entry with no finish token is priced at the printing's default finish", () => {
    // A foil-only printing has no nonfoil price to quote, so reading the entry
    // flatly as nonfoil would report $0 for a card that has a price.
    const foilOnly = makeScryfallCard({
      id: 'foil-only',
      name: 'Shiny Bolt',
      set: 'sld',
      collector_number: '99',
      finishes: ['foil'],
      prices: { usd: null, usd_foil: '12.00' },
    })
    const wanted = {
      ref: { type: 'wanted', slug: 'shiny' },
      name: 'Shiny',
      kind: 'wanted',
      detail: {
        name: 'Shiny',
        entries: [
          {
            name: 'Shiny Bolt',
            set: 'sld',
            collectorNumber: '99',
            price: 0,
            fileOrder: 0,
            section: 'Main',
            state: 'specific',
            cardId: 1,
          },
        ],
        cards: { 'sld:99': foilOnly },
        printings: { 'Shiny Bolt': [foilOnly] },
        symbolMap: {},
      } as unknown as WantedListDetail,
    } satisfies Extract<LoadedListDetail, { kind: 'wanted' }>

    expect(buildCombinedCards([wanted], 'usd', false)[0]!.price).toBe(12)
  })
})

describe('source grouping over combined cards', () => {
  test('groups by source list in selection order', () => {
    const cards = buildCombinedCards(
      [deckDetail(), collectionDetail(), wantedDetail()],
      'usd',
      false,
    )
    const groups = groupAndSortCards(cards, 'source', [{ sortBy: 'name', reverse: false }], [])
    expect(groups.map((g) => g.key)).toEqual(['My Deck', 'My Box', 'My Wants'])
    expect(groups[0]!.cards).toHaveLength(2)
  })
})

describe('merge helpers', () => {
  const loaded = [deckDetail(), collectionDetail(), wantedDetail()]

  test('mergeSymbolMaps unions every list symbol map', () => {
    expect(mergeSymbolMaps(loaded)).toEqual({
      '{R}': 'images/symbols/R.svg',
      '{1}': 'images/symbols/1.svg',
    })
  })

  test('mergeCardMaps unions card lookups under their own keys', () => {
    const merged = mergeCardMaps(loaded)
    expect(merged['Sol Ring']).toBe(solRing)
    expect(merged['c21:263']).toBe(solRing)
    expect(merged['Lightning Bolt']).toBe(bolt)
  })

  test('mergePrintingMaps keeps the longest printing list per name', () => {
    const merged = mergePrintingMaps(loaded)
    expect(merged['Sol Ring']).toEqual([solRing])
    expect(merged['Lightning Bolt']).toEqual([bolt])
  })
})

/**
 * The combined view's one source of quotes: every loaded list's baked payload
 * folded into the single store `seedBuylistQuotes` reads.
 */
describe('mergeBakedBuylists', () => {
  const older: BakedBuylistQuotes = {
    quotes: {
      'a:1:nonfoil': makeBuylistQuote({ name: 'A' }),
      'c:3:nonfoil': makeBuylistQuote({ name: 'C (older feed)', priceBuy: 1 }),
    },
    feedCreatedAt: '2026-08-03 06:06:09',
    feedRetrievedAt: 100,
  }
  const newer: BakedBuylistQuotes = {
    quotes: {
      'b:2:nonfoil': makeBuylistQuote({ name: 'B' }),
      'c:3:nonfoil': makeBuylistQuote({ name: 'C (newer feed)', priceBuy: 2 }),
    },
    feedCreatedAt: '2026-08-04 06:06:09',
    feedRetrievedAt: 200,
  }

  /** A loaded list carrying `baked` — or nothing, the way an unquoted build ships. */
  function listWith(baked?: BakedBuylistQuotes): LoadedListDetail {
    const list = collectionDetail()
    const detail = list.detail as unknown as { buylist?: BakedBuylist }
    if (baked) detail.buylist = { cardkingdom: baked }
    else delete detail.buylist
    return list
  }

  test.each([
    ['older first', [older, newer]],
    ['newer first', [newer, older]],
  ] as const)('unions the quotes and keeps the freshest stamp (%s)', (_label, order) => {
    const merged = mergeBakedBuylists(order.map((baked) => listWith(baked)))!

    // Both branches of the stamp comparison, since the merge is order-sensitive
    // in exactly one place: which payload is `existing`.
    expect(merged.cardkingdom?.feedRetrievedAt).toBe(200)
    expect(merged.cardkingdom?.feedCreatedAt).toBe('2026-08-04 06:06:09')
    expect(Object.keys(merged.cardkingdom?.quotes ?? {}).sort()).toEqual([
      'a:1:nonfoil',
      'b:2:nonfoil',
      'c:3:nonfoil',
    ])
    // The newer feed's offer wins the overlap: a combined view must not show a
    // price the freshest list it is displaying has already moved past.
    expect(merged.cardkingdom?.quotes['c:3:nonfoil']).toBe(newer.quotes['c:3:nonfoil'])
  })

  test('a lone payload is reused by identity, because the seed store compares objects', () => {
    const merged = mergeBakedBuylists([listWith(older), listWith()])

    expect(merged?.cardkingdom).toBe(older)
  })

  test('no list quoted at all yields undefined, not an empty payload', () => {
    // What makes "none of these lists was quoted" reach the user as an
    // explanation rather than as a silently priceless sell mode.
    expect(mergeBakedBuylists([listWith(), listWith()])).toBeUndefined()
  })
})

describe('buildCombinedCards — labels', () => {
  test('collection cards resolve effective labels (override beats the list default)', () => {
    const base = collectionDetail()
    const detail = base.detail as unknown as {
      labels?: string[]
      entries: { labels?: string[]; name: string }[]
    }
    detail.labels = ['sale', 'trade']
    detail.entries.push({
      ...detail.entries[0],
      name: 'Sol Ring',
      labels: ['keep'],
    })

    const cards = buildCombinedCards([base], 'usd', false)
    expect(cards[0]!.labels).toEqual(['sale', 'trade'])
    expect(cards[1]!.labels).toEqual(['keep'])
    // The selection tile carries the same resolution for the trade keep-guard.
    expect(cards[1]!.selectedTile.labels).toEqual(['keep'])
  })

  test('deck cards resolve effective labels; wanted cards are always unlabeled', () => {
    const deck = deckDetail()
    const detail = deck.detail as unknown as {
      deck: { sections: { cards: { labels?: string[] }[] }[] }
    }
    detail.deck.sections[0]!.cards[0]!.labels = ['proxy']

    const cards = buildCombinedCards([deck, wantedDetail()], 'usd', false)
    expect(cards[0]!.labels).toEqual(['proxy'])
    expect(cards[0]!.selectedTile.labels).toEqual(['proxy'])
    // A line with no override on a deck with no default stays unlabeled, as do
    // wanted cards, which carry no labels at all.
    expect(cards[1]!.labels).toEqual([])
    expect(cards[2]!.labels).toEqual([])
  })
})

describe('buildCombinedCards — proxies and custom art', () => {
  /** The printings the priceless assertions below are measured against. */
  const PRICED_SOL_RING = makeScryfallCard({
    id: 'sol',
    name: 'Sol Ring',
    set: 'c21',
    collector_number: '263',
    prices: { usd: '4.50' },
  })
  const PRICED_BOLT = makeScryfallCard({
    id: 'bolt',
    name: 'Lightning Bolt',
    set: 'lea',
    collector_number: '161',
    prices: { usd: '9.99' },
  })

  /**
   * Fixtures whose cards are worth something, seeded into the map each
   * resolver actually reads: a deck line pinned to a printing resolves through
   * `printings` (`findPrinting`), a name-only wanted line through `cards`, and
   * a collection entry through `cards` under its `set:cn` key. Seeding the
   * wrong map leaves the fixture priced at nothing, which every "prices at 0"
   * assertion would then pass without the rule under test doing anything —
   * hence the control assertion in each case below.
   */
  function pricedDeck(): Extract<LoadedListDetail, { kind: 'deck' }> {
    const deck = deckDetail()
    const detail = deck.detail as unknown as {
      printings: Record<string, ScryfallCard[]>
      cards: Record<string, ScryfallCard>
    }
    detail.printings['Sol Ring'] = [PRICED_SOL_RING]
    detail.cards['Sol Ring'] = PRICED_SOL_RING
    detail.cards['Lightning Bolt'] = PRICED_BOLT
    return deck
  }

  function pricedWanted(): Extract<LoadedListDetail, { kind: 'wanted' }> {
    const wanted = wantedDetail()
    ;(wanted.detail as unknown as { cards: Record<string, ScryfallCard> }).cards['Lightning Bolt'] =
      PRICED_BOLT
    return wanted
  }

  function pricedCollection(): Extract<LoadedListDetail, { kind: 'collection' }> {
    const collection = collectionDetail()
    ;(collection.detail as unknown as { cards: Record<string, ScryfallCard> }).cards['c21:263'] =
      PRICED_SOL_RING
    return collection
  }

  /**
   * The two by-rule priceless entries. They differ only in which field of the
   * same collection entry is overridden, so the pricing pin is one table.
   *
   * Deliberately no buylist assertion here: `buildCombinedCards` runs with sell
   * mode off and no quotes seeded, so `buylistPrice: 0` / `onBuylist: false`
   * would hold for every card in the file and pin nothing. The priceless
   * short-circuit in `buylistFieldsFor` is pinned against a live quote in
   * `test/unit/sell-value.test.ts`.
   */
  const PRICELESS_ENTRY_CASES: [string, PricelessEntryOverride][] = [
    ['a proxy', { labels: ['proxy'] }],
    ['a custom-art copy', { customArt: 'art/sol-ring.jpg', hasCustomArt: true }],
    ['a custom-art copy whose file was not deployed', { hasCustomArt: true }],
  ]

  test('the priced fixtures really are priced, so the assertions below can fail', () => {
    // The control every "prices at 0" case leans on: seed the wrong map and the
    // fixture is worth nothing on its own, which would make the priceless rule
    // untestable through it.
    const cards = buildCombinedCards(
      [pricedCollection(), pricedDeck(), pricedWanted()],
      'usd',
      false,
    )
    expect(cards.map((card) => card.price)).toEqual([4.5, 4.5, 9.99, 9.99])
  })

  test.each(PRICELESS_ENTRY_CASES)(
    '%s prices a collection card at 0, whatever the printing is worth',
    (_label, override) => {
      const collection = pricedCollection()
      const detail = collection.detail as unknown as {
        entries: (PricelessEntryOverride & { price: number })[]
      }
      Object.assign(detail.entries[0]!, override)

      const [card] = buildCombinedCards([collection], 'usd', false)
      expect(card!.price).toBe(0)
      expect(card!.selectedTile.price).toBe(0)
      expect(card!.selectedTile.customArt).toBe(override.customArt)
      // The tile and its selection carry the *fact*, not just the URL: it is
      // what the CUSTOM marker and the selection's own valuation read, and a
      // card whose art file never shipped has nothing else to go on.
      expect(card!.hasCustomArt).toBe(override.hasCustomArt)
      expect(card!.selectedTile.hasCustomArt).toBe(override.hasCustomArt)
    },
  )

  test('an undeployed art file leaves deck and wanted cards priceless too', () => {
    const deck = pricedDeck()
    const deckCards = (
      deck.detail as unknown as { deck: { sections: { cards: { hasCustomArt?: boolean }[] }[] } }
    ).deck.sections[0]!.cards
    deckCards[0]!.hasCustomArt = true

    const wanted = pricedWanted()
    ;(
      wanted.detail as unknown as { entries: { hasCustomArt?: boolean }[] }
    ).entries[0]!.hasCustomArt = true

    const cards = buildCombinedCards([deck, wanted], 'usd', false)
    // No display URL anywhere — the tiles show the printings' own art — and yet
    // neither card is worth anything.
    expect(cards[0]!.customArt).toBeUndefined()
    expect(cards[0]!.price).toBe(0)
    expect(cards[0]!.hasCustomArt).toBe(true)
    expect(cards.at(-1)!.price).toBe(0)
    expect(cards.at(-1)!.hasCustomArt).toBe(true)
  })

  test('a collection default proxy label prices every line at 0', () => {
    const collection = pricedCollection()
    // The *list's* default, with no override on the line: the combined view has
    // to resolve effective labels before asking the priceless rule, exactly as
    // the collection page does.
    ;(collection.detail as unknown as { labels?: string[] }).labels = ['proxy']

    const [card] = buildCombinedCards([collection], 'usd', false)
    expect(card!.labels).toEqual(['proxy'])
    expect(card!.price).toBe(0)
    expect(card!.selectedTile.price).toBe(0)
  })

  test('a deck line inherits the deck-default proxy label and prices at 0', () => {
    const deck = deckDetail()
    const detail = deck.detail as unknown as {
      labels?: string[]
      cards: Record<string, unknown>
    }
    detail.labels = ['proxy']
    detail.cards['Lightning Bolt'] = makeScryfallCard({
      id: 'bolt',
      name: 'Lightning Bolt',
      set: 'lea',
      collector_number: '161',
      prices: { usd: '9.99' },
    })

    const cards = buildCombinedCards([deck], 'usd', false)
    for (const card of cards) {
      expect(card.labels).toEqual(['proxy'])
      expect(card.price).toBe(0)
    }
  })

  test('custom art rides along on the card and its selection tile', () => {
    const collection = collectionDetail()
    const entries = (collection.detail as unknown as { entries: { customArt?: string }[] }).entries
    entries[0]!.customArt = 'art/proxies/sol-ring.jpg'

    const wanted = wantedDetail()
    const wantedEntries = (wanted.detail as unknown as { entries: { customArt?: string }[] })
      .entries
    wantedEntries[0]!.customArt = 'https://example.com/bolt.png'

    const cards = buildCombinedCards([collection, wanted], 'usd', true)
    expect(cards[0]!.customArt).toBe('art/proxies/sol-ring.jpg')
    expect(cards[0]!.selectedTile.image).toBe('art/proxies/sol-ring.jpg')
    expect(cards[1]!.customArt).toBe('https://example.com/bolt.png')
    expect(cards[1]!.selectedTile.image).toBe('https://example.com/bolt.png')
  })

  test('custom art prices deck and wanted cards at 0 as well', () => {
    const deck = pricedDeck()
    const deckCards = (
      deck.detail as unknown as { deck: { sections: { cards: { customArt?: string }[] }[] } }
    ).deck.sections[0]!.cards
    deckCards[0]!.customArt = 'art/sol-ring.jpg'

    const wanted = pricedWanted()
    ;(wanted.detail as unknown as { entries: { customArt?: string }[] }).entries[0]!.customArt =
      'https://example.com/bolt.png'

    const cards = buildCombinedCards([deck, wanted], 'usd', false)
    expect(cards[0]!.price).toBe(0)
    expect(cards.at(-1)!.price).toBe(0)
  })
})
