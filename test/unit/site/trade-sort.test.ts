import { describe, expect, test } from 'bun:test'
import { sortTradeCards } from '../../../src/site/trade-sort'
import type { TradeSortState } from '../../../src/site/trade-sort'
import type { TradeCardEntry } from '../../../src/list/site-data'

function makeEntry(overrides: Partial<TradeCardEntry>): TradeCardEntry {
  return {
    name: 'Card',
    scryfallCard: null,
    source: 'scryfall',
    sourceName: 'scryfall',
    qty: 1,
    ...overrides,
  }
}

const byName = (reverse = false): TradeSortState => ({ by: 'name', reverse })
const byPrice = (reverse = false): TradeSortState => ({ by: 'price', reverse })

describe('sortTradeCards', () => {
  test('sorts by name ascending using locale compare so case-insensitive ordering is honored', () => {
    const cards = [
      makeEntry({ name: 'banana' }),
      makeEntry({ name: 'Apple' }),
      makeEntry({ name: 'cherry' }),
    ]
    const sorted = sortTradeCards(cards, byName())
    expect(sorted.map((c) => c.name)).toEqual(['Apple', 'banana', 'cherry'])
  })

  test('reverse flag inverts the name order', () => {
    const cards = [
      makeEntry({ name: 'Atog' }),
      makeEntry({ name: 'Birds of Paradise' }),
      makeEntry({ name: 'Counterspell' }),
    ]
    const sorted = sortTradeCards(cards, byName(true))
    expect(sorted.map((c) => c.name)).toEqual(['Counterspell', 'Birds of Paradise', 'Atog'])
  })

  test('sorts by price ascending', () => {
    const cards = [
      makeEntry({ name: 'A', price: 5 }),
      makeEntry({ name: 'B', price: 1 }),
      makeEntry({ name: 'C', price: 3 }),
    ]
    const sorted = sortTradeCards(cards, byPrice())
    expect(sorted.map((c) => c.price)).toEqual([1, 3, 5])
  })

  test('treats missing price as 0 when sorting by price', () => {
    const cards = [
      makeEntry({ name: 'A', price: 2 }),
      makeEntry({ name: 'B' }),
      makeEntry({ name: 'C', price: 0.5 }),
    ]
    const sorted = sortTradeCards(cards, byPrice())
    expect(sorted.map((c) => c.name)).toEqual(['B', 'C', 'A'])
  })

  test('returns a new array and leaves the input untouched', () => {
    const cards = [makeEntry({ name: 'B' }), makeEntry({ name: 'A' })]
    const original = cards.map((c) => c.name)
    const sorted = sortTradeCards(cards, byName())
    expect(sorted).not.toBe(cards)
    expect(cards.map((c) => c.name)).toEqual(original)
  })
})
