import { describe, expect, test } from 'bun:test'
import { buildCandidates, totalQuantityByName } from '../../../src/site/quick-switch-candidates'
import type { CollectionDetail, CollectionCardEntry, DeckDetail } from '../../../src/list/site-data'
import type { DeckSection } from '../../../src/list/deck'
import type { ScryfallCard } from '../../../src/scryfall/types'
import { makeCollectionEntry, makeScryfallCard } from '../../test-utils'

function makeCollectionDetail(
  entries: CollectionCardEntry[],
  cards: Record<string, ScryfallCard | null>,
): CollectionDetail {
  return {
    name: 'Test Binder',
    entries,
    cards,
    printings: {},
    symbolMap: {},
    useScryfallImgUrls: false,
    totalPrice: 0,
    defaultCurrency: 'usd',
  }
}

function makeEntry(
  name: string,
  set: string,
  collectorNumber: string,
  fileOrder: number,
  language?: CollectionCardEntry['language'],
): CollectionCardEntry {
  return makeCollectionEntry({ name, set, collectorNumber, language, fileOrder })
}

function makeDeckDetail(
  sections: DeckSection[],
  lookup: Record<string, ScryfallCard | null>,
): DeckDetail {
  return {
    deck: { name: 'Test Deck', sections },
    cards: lookup,
    printings: {},
    symbolMap: {},
    useScryfallImgUrls: false,
    defaultCurrency: 'usd',
    availableCurrencies: ['usd'],
  }
}

const SOL_RING_A = makeScryfallCard({
  id: 'sol-a',
  name: 'Sol Ring',
  set: 'c16',
  collector_number: '234',
})
const SOL_RING_B = makeScryfallCard({
  id: 'sol-b',
  name: 'Sol Ring',
  set: 'lgn',
  collector_number: '303',
})

describe('buildCandidates', () => {
  test('one line per copy: duplicate lines of the same printing collapse to one candidate summing quantity', () => {
    const detail = makeCollectionDetail(
      [makeEntry('Sol Ring', 'c16', '234', 0), makeEntry('Sol Ring', 'c16', '234', 1)],
      { 'c16:234': SOL_RING_A },
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.quantity).toBe(2)
    expect(candidates[0]?.setCollectorKey).toBe('c16:234')
  })

  test('distinct printings of the same card stay separate candidates with their own counts', () => {
    const detail = makeCollectionDetail(
      [
        makeEntry('Sol Ring', 'c16', '234', 0),
        makeEntry('Sol Ring', 'lgn', '303', 1),
        makeEntry('Sol Ring', 'lgn', '303', 2),
      ],
      { 'c16:234': SOL_RING_A, 'lgn:303': SOL_RING_B },
    )
    const candidates = buildCandidates(detail)
    expect(candidates.map((c) => [c.setCollectorKey, c.quantity])).toEqual([
      ['c16:234', 1],
      ['lgn:303', 2],
    ])
  })

  test('deck lines carry their own quantity, summed across sections for the same card', () => {
    const bolt = makeScryfallCard({ id: 'bolt', name: 'Lightning Bolt' })
    const detail = makeDeckDetail(
      [
        { name: 'Main', cards: [{ quantity: 3, name: 'Lightning Bolt' }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'Lightning Bolt' }] },
      ],
      { 'Lightning Bolt': bolt },
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.quantity).toBe(4)
  })

  test('a pinned deck line keeps its declared printing, not the name-keyed representative', () => {
    // Deck card maps are keyed by name only, so the resolved card is a
    // *representative* printing — labeling or deduping by it would show a
    // printing the deck never declared.
    const representative = makeScryfallCard({
      id: 'bolt-m10',
      name: 'Lightning Bolt',
      set: 'm10',
      collector_number: '146',
    })
    const detail = makeDeckDetail(
      [
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }],
        },
      ],
      { 'Lightning Bolt': representative },
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.setCollectorKey).toBe('lea:161')
    expect(candidates[0]?.printing).toEqual({ set: 'lea', collectorNumber: '161' })
    // The representative still supplies the resolved name and thumbnail.
    expect(candidates[0]?.card?.id).toBe('bolt-m10')
  })

  test('a pinned entry is never relabeled by a changelog-only name key of another printing', () => {
    const owned = makeScryfallCard({
      id: 'moon-386',
      name: 'Moonshadow',
      set: 'ecl',
      collector_number: '386',
    })
    const other = makeScryfallCard({
      id: 'moon-110',
      name: 'Moonshadow',
      set: 'ecl',
      collector_number: '110',
    })
    const detail = makeCollectionDetail([makeEntry('Moonshadow', 'ecl', '386', 0)], {
      'ecl:386': owned,
      Moonshadow: other,
    })
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.setCollectorKey).toBe('ecl:386')
    expect(candidates[0]?.card?.id).toBe('moon-386')
  })

  test('the match key folds case while the printing keeps the line’s own spelling', () => {
    const detail = makeCollectionDetail([makeEntry('Mystery Card', 'XYZ', '123A', 0)], {})
    const candidates = buildCandidates(detail)
    expect(candidates[0]?.setCollectorKey).toBe('xyz:123a')
    expect(candidates[0]?.printing).toEqual({ set: 'XYZ', collectorNumber: '123A' })
  })

  test('an unresolved pinned printing keeps its declared key and sums by it', () => {
    const detail = makeCollectionDetail(
      [makeEntry('Mystery Card', 'xyz', '9', 0), makeEntry('Mystery Card', 'xyz', '9', 1)],
      {},
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      cardName: 'Mystery Card',
      setCollectorKey: 'xyz:9',
      printing: { set: 'xyz', collectorNumber: '9' },
      card: null,
      quantity: 2,
    })
  })

  test('an explicitly-null printing key (looked for, not cached) still yields a searchable candidate', () => {
    const detail = makeCollectionDetail([makeEntry('Sol Ring', 'c16', '234', 0)], {
      'c16:234': null,
    })
    const candidates = buildCandidates(detail)
    expect(candidates[0]).toMatchObject({
      setCollectorKey: 'c16:234',
      card: null,
      quantity: 1,
    })
  })

  test('same printing in two languages merges into one candidate summing copies', () => {
    const en = makeScryfallCard({ id: 'neo-1-en', set: 'neo', collector_number: '1' })
    const ja = makeScryfallCard({ id: 'neo-1-ja', set: 'neo', collector_number: '1' })
    const detail = makeCollectionDetail(
      [makeEntry('Test Card', 'neo', '1', 0), makeEntry('Test Card', 'neo', '1', 1, 'ja')],
      { 'neo:1': en, 'neo:1@ja': ja },
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.quantity).toBe(2)
    expect(candidates[0]?.setCollectorKey).toBe('neo:1')
  })

  test('an unresolved name-only deck line dedups case-insensitively by name', () => {
    const detail = makeDeckDetail(
      [
        {
          name: 'Main',
          cards: [
            { quantity: 2, name: 'Shadow Waltz' },
            { quantity: 1, name: 'shadow waltz' },
          ],
        },
      ],
      {},
    )
    const candidates = buildCandidates(detail)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.quantity).toBe(3)
  })

  test('changelog-only card map entries never become candidates', () => {
    const removed = makeScryfallCard({ id: 'removed', name: 'Removed Card' })
    const detail = makeCollectionDetail([makeEntry('Sol Ring', 'c16', '234', 0)], {
      'c16:234': SOL_RING_A,
      'Removed Card': removed,
    })
    const names = buildCandidates(detail).map((c) => c.cardName)
    expect(names).toEqual(['Sol Ring'])
  })
})

describe('totalQuantityByName', () => {
  test('sums copies across printings of the same card, keyed case-insensitively', () => {
    const detail = makeCollectionDetail(
      [
        makeEntry('Sol Ring', 'c16', '234', 0),
        makeEntry('Sol Ring', 'lgn', '303', 1),
        makeEntry('Sol Ring', 'lgn', '303', 2),
      ],
      { 'c16:234': SOL_RING_A, 'lgn:303': SOL_RING_B },
    )
    const totals = totalQuantityByName(buildCandidates(detail))
    expect(totals.get('sol ring')).toBe(3)
  })
})
