import { describe, expect, test } from 'bun:test'
import {
  encodeCombinedHash,
  parseCombinedQuery,
  buildCombinedCards,
  mergeSymbolMaps,
  mergeCardMaps,
  mergePrintingMaps,
  type LoadedListDetail,
} from '../../../src/site/combined-list'
import { groupAndSortCards } from '../../../src/site/card-sorting'
import type { DeckDetail, CollectionDetail, WantedListDetail } from '../../../src/site/data-types'
import { makeScryfallCard } from '../../test-utils'

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

  test('deck and wanted cards are always unlabeled', () => {
    const cards = buildCombinedCards([deckDetail(), wantedDetail()], 'usd', false)
    for (const card of cards) expect(card.labels).toEqual([])
  })
})
