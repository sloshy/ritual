import { describe, test, expect, beforeEach } from 'bun:test'
import {
  isAlreadyInLeftList,
  isAlreadyInRightList,
  addEntryToLeft,
  addEntryToRight,
  leftCards,
  setLeftCards,
  setRightCards,
} from '../../../src/site/useTradeState'
import type { TradeSearchEntry } from '../../../src/site/useTradeData'
import { normalizeCardName } from '../../../src/term-match'
import { makeScryfallCard } from '../../test-utils'

function makeEntry(overrides: Partial<TradeSearchEntry> = {}): TradeSearchEntry {
  const card = makeScryfallCard()
  return {
    name: card.name,
    nameKey: normalizeCardName(card.name),
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
    const card = makeScryfallCard({ finishes: ['nonfoil', 'foil'], id: 'sf-2' })
    const nonfoilEntry = makeEntry({ finish: 'nonfoil', scryfallCard: card, cardIds: [10] })
    const foilEntry = makeEntry({ finish: 'foil', scryfallCard: card, cardIds: [10] })
    addEntryToLeft(nonfoilEntry, 'usd')
    // Different finish, same physical card ID — should be treated as already in list.
    expect(isAlreadyInLeftList(foilEntry)).toBe(true)
  })

  test('returns false for an entry with no overlapping card IDs', () => {
    const entry = makeEntry({ cardIds: [1] })
    const other = makeEntry({ name: 'Counterspell', nameKey: 'counterspell', cardIds: [2] })
    addEntryToLeft(entry, 'usd')
    expect(isAlreadyInLeftList(other)).toBe(false)
  })

  test('empty-cardIds entries still match via the exact-match path', () => {
    // Without card IDs there is no identity to compare, so no ID-based match.
    const entry = makeEntry({ cardIds: [] })
    const other = makeEntry({ cardIds: [] })
    addEntryToLeft(entry, 'usd')
    // The exact-match path still catches it since all other fields match.
    expect(isAlreadyInLeftList(other)).toBe(true)
  })
})

describe('isAlreadyInRightList', () => {
  // isAlreadyInLeftList and isAlreadyInRightList are one-line delegations to a
  // shared isAlreadyInList differing only in which signal they read — the
  // not-in-list/removed cases are pinned by the left-list describe above.
  test('returns true after card is added', () => {
    const entry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted', maxQty: 1 })
    addEntryToRight(entry, 'usd')
    expect(isAlreadyInRightList(entry)).toBe(true)
  })

  test('left and right lists are independent', () => {
    const collectionEntry = makeEntry({ maxQty: 1 })
    addEntryToLeft(collectionEntry, 'usd')
    const wantedEntry = makeEntry({ sourceKind: 'wanted', sourceName: 'My Wanted', maxQty: 1 })
    expect(isAlreadyInRightList(wantedEntry)).toBe(false)
  })
})

describe('language as a trade variant dimension', () => {
  test('a [ja] entry never merges into its English twin', () => {
    const en = makeEntry({ maxQty: 2, cardIds: [1, 2] })
    const ja = makeEntry({ language: 'ja', maxQty: 2, cardIds: [3, 4] })
    addEntryToLeft(en, 'usd')
    addEntryToLeft(ja, 'usd')
    expect(leftCards()).toHaveLength(2)
    expect(leftCards()[1]).toMatchObject({ language: 'ja', qty: 1 })
  })

  test('an explicit en entry merges with a bare (language-less) one', () => {
    const bare = makeEntry({ maxQty: 3, cardIds: [1, 2, 3] })
    const explicitEn = makeEntry({ language: 'en', maxQty: 3, cardIds: [1, 2, 3] })
    addEntryToLeft(bare, 'usd')
    addEntryToLeft(explicitEn, 'usd')
    expect(leftCards()).toHaveLength(1)
    expect(leftCards()[0]?.qty).toBe(2)
  })
})
