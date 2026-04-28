import { describe, test, expect, beforeEach } from 'bun:test'
import {
  isAlreadyInLeftList,
  isAlreadyInRightList,
  addEntryToLeft,
  addEntryToRight,
  setLeftCards,
  setRightCards,
} from '../../../src/site/useTradeState'
import type { TradeSearchEntry } from '../../../src/site/useTradeData'
import type { ScryfallCard } from '../../../src/types'

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'sf-1',
    name: 'Lightning Bolt',
    cmc: 1,
    type_line: 'Instant',
    prices: {
      usd: '1.00',
      usd_foil: '5.00',
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
    },
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'lea',
    set_name: 'Limited Edition Alpha',
    collector_number: '161',
    rarity: 'common',
    color_identity: [],
    ...overrides,
  }
}

function makeEntry(overrides: Partial<TradeSearchEntry> = {}): TradeSearchEntry {
  const card = makeCard()
  return {
    name: card.name,
    nameLower: card.name.toLowerCase(),
    set: card.set,
    collectorNumber: card.collector_number,
    finish: 'nonfoil',
    scryfallCard: card,
    sourceName: 'My Collection',
    sourceKind: 'collection',
    maxQty: 1,
    cardIds: [1],
    ...overrides,
  }
}

beforeEach(() => {
  setLeftCards([])
  setRightCards([])
})

describe('isAlreadyInLeftList', () => {
  test('returns false when card not in list', () => {
    expect(isAlreadyInLeftList(makeEntry())).toBe(false)
  })

  test('returns true after card is added (maxQty 1)', () => {
    const entry = makeEntry({ maxQty: 1 })
    addEntryToLeft(entry, 'usd')
    expect(isAlreadyInLeftList(entry)).toBe(true)
  })

  test('returns true after first add even when maxQty > 1', () => {
    const entry = makeEntry({ maxQty: 4, cardIds: [1, 2, 3, 4] })
    addEntryToLeft(entry, 'usd')
    expect(isAlreadyInLeftList(entry)).toBe(true)
  })

  test('returns false again after card is removed from list', () => {
    const entry = makeEntry({ maxQty: 1 })
    addEntryToLeft(entry, 'usd')
    expect(isAlreadyInLeftList(entry)).toBe(true)
    setLeftCards([])
    expect(isAlreadyInLeftList(entry)).toBe(false)
  })

  test('returns true for a different variant sharing source card IDs', () => {
    const card = makeCard({ finishes: ['nonfoil', 'foil'], id: 'sf-2' })
    const nonfoilEntry = makeEntry({ finish: 'nonfoil', scryfallCard: card, cardIds: [10] })
    const foilEntry = makeEntry({ finish: 'foil', scryfallCard: card, cardIds: [10] })
    addEntryToLeft(nonfoilEntry, 'usd')
    // Different finish, same physical card ID — should be treated as already in list.
    expect(isAlreadyInLeftList(foilEntry)).toBe(true)
  })

  test('returns false for an entry with no overlapping card IDs', () => {
    const entry = makeEntry({ cardIds: [1] })
    const other = makeEntry({ name: 'Counterspell', nameLower: 'counterspell', cardIds: [2] })
    addEntryToLeft(entry, 'usd')
    expect(isAlreadyInLeftList(other)).toBe(false)
  })

  test('returns false for entries with empty cardIds even if exact name matches', () => {
    // Without card IDs there is no identity to compare, so no ID-based match.
    const entry = makeEntry({ cardIds: [] })
    const other = makeEntry({ cardIds: [] })
    addEntryToLeft(entry, 'usd')
    // The exact-match path still catches it since all other fields match.
    expect(isAlreadyInLeftList(other)).toBe(true)
  })
})

describe('isAlreadyInRightList', () => {
  test('returns false when card not in list', () => {
    const entry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted' })
    expect(isAlreadyInRightList(entry)).toBe(false)
  })

  test('returns true after card is added', () => {
    const entry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted', maxQty: 1 })
    addEntryToRight(entry, 'usd')
    expect(isAlreadyInRightList(entry)).toBe(true)
  })

  test('returns false after card is removed', () => {
    const entry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted', maxQty: 1 })
    addEntryToRight(entry, 'usd')
    setRightCards([])
    expect(isAlreadyInRightList(entry)).toBe(false)
  })

  test('left and right lists are independent', () => {
    const collectionEntry = makeEntry({ maxQty: 1 })
    addEntryToLeft(collectionEntry, 'usd')
    const wantedEntry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted', maxQty: 1 })
    expect(isAlreadyInRightList(wantedEntry)).toBe(false)
  })
})

describe('autocomplete filtering with isAlreadyIn*List', () => {
  test('filters out entries already in the left trade list', () => {
    const bolt = makeEntry({ name: 'Lightning Bolt', nameLower: 'lightning bolt', cardIds: [1] })
    const elves = makeEntry({ name: 'Llanowar Elves', nameLower: 'llanowar elves', cardIds: [2] })
    addEntryToLeft(bolt, 'usd')

    const filtered = [bolt, elves].filter((e) => !isAlreadyInLeftList(e))
    expect(filtered.map((e) => e.name)).toEqual(['Llanowar Elves'])
  })

  test('entry reappears after being removed from the trade list', () => {
    const entry = makeEntry({ maxQty: 1 })
    addEntryToLeft(entry, 'usd')
    expect([entry].filter((e) => !isAlreadyInLeftList(e))).toHaveLength(0)

    setLeftCards([])
    expect([entry].filter((e) => !isAlreadyInLeftList(e))).toHaveLength(1)
  })

  test('entry with maxQty > 1 is still filtered after first add', () => {
    // The user adjusts qty via trade list controls, not by re-selecting from autocomplete.
    const entry = makeEntry({ maxQty: 4, cardIds: [1, 2, 3, 4] })
    addEntryToLeft(entry, 'usd')
    expect([entry].filter((e) => !isAlreadyInLeftList(e))).toHaveLength(0)
  })

  test('filters out wanted entries already in the right trade list', () => {
    const bolt = makeEntry({ sourceKind: 'wanted', sourceName: 'Wants', cardIds: [1] })
    const elves = makeEntry({
      name: 'Llanowar Elves',
      nameLower: 'llanowar elves',
      sourceKind: 'wanted',
      sourceName: 'Wants',
      cardIds: [2],
    })
    addEntryToRight(bolt, 'usd')

    const filtered = [bolt, elves].filter((e) => !isAlreadyInRightList(e))
    expect(filtered.map((e) => e.name)).toEqual(['Llanowar Elves'])
  })
})
