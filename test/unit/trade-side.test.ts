import { describe, expect, test, beforeEach } from 'bun:test'
import type { CollectionCardEntry } from '../../src/list/site-data'
import type { SelectedCard } from '../../src/list-view/useCardSelection'
import { collectionTradeMaxQty, collectionTradeQtyMap } from '../../src/list-view/trade-qty'
import { canAddSelectedCardToTrade, tradeEntryFor } from '../../src/site/useSelectionTrade'
import {
  addEntryToLeft,
  addEntryToRight,
  leftCards,
  rightCards,
  setLeftCards,
  setRightCards,
} from '../../src/site/useTradeState'

/**
 * The trade-side rules behind the per-tile "Add to Trade" button: which column a
 * source kind lands on, and how many copies a tile may hand over. Pinned here
 * rather than through the UI — the board is module-level signals, so these are
 * plain functions over plain data.
 */

const collectionEntry = (over: Partial<CollectionCardEntry> = {}): CollectionCardEntry => ({
  name: 'Sol Ring',
  set: 'c19',
  collectorNumber: '221',
  finish: 'nonfoil',
  condition: 'NM',
  price: 3,
  fileOrder: 0,
  section: 'Main',
  ...over,
})

const selected = (over: Partial<SelectedCard> = {}): SelectedCard => ({
  key: 'k1',
  name: 'Sol Ring',
  set: 'c19',
  collectorNumber: '221',
  finish: 'nonfoil',
  condition: 'NM',
  quantity: 1,
  groupSize: 1,
  scryfallCard: null,
  sourceName: 'Box',
  sourceKind: 'collection',
  maxQty: 1,
  cardIds: [],
  ...over,
})

beforeEach(() => {
  setLeftCards([])
  setRightCards([])
})

describe('collection trade quantities', () => {
  test('counts duplicate lines as one tradable group', () => {
    const map = collectionTradeQtyMap([
      collectionEntry({ cardId: 1 }),
      collectionEntry({ cardId: 2 }),
      collectionEntry({ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 3 }),
    ])
    expect(collectionTradeMaxQty(collectionEntry({ cardId: 1 }), map)).toBe(2)
    expect(
      collectionTradeMaxQty(
        collectionEntry({ name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }),
        map,
      ),
    ).toBe(1)
  })

  test('splits a group by printing variant, so a foil never caps its nonfoil twin', () => {
    const map = collectionTradeQtyMap([
      collectionEntry({ cardId: 1 }),
      collectionEntry({ finish: 'foil', cardId: 2 }),
      collectionEntry({ condition: 'LP', cardId: 3 }),
      collectionEntry({ language: 'ja', cardId: 4 }),
    ])
    for (const entry of [
      collectionEntry(),
      collectionEntry({ finish: 'foil' }),
      collectionEntry({ condition: 'LP' }),
      collectionEntry({ language: 'ja' }),
    ]) {
      expect(collectionTradeMaxQty(entry, map)).toBe(1)
    }
  })

  test('a noted line is its own unit and neither joins nor swells a group', () => {
    const map = collectionTradeQtyMap([
      collectionEntry({ cardId: 1 }),
      collectionEntry({ cardId: 2 }),
      collectionEntry({ note: 'signed', cardId: 3 }),
    ])
    expect(collectionTradeMaxQty(collectionEntry(), map)).toBe(2)
    expect(collectionTradeMaxQty(collectionEntry({ note: 'signed' }), map)).toBe(1)
  })

  test('a set code cased differently by the source still counts into one group', () => {
    const map = collectionTradeQtyMap([
      collectionEntry({ set: 'C19', cardId: 1 }),
      collectionEntry({ set: 'c19', cardId: 2 }),
    ])
    expect(collectionTradeMaxQty(collectionEntry(), map)).toBe(2)
  })
})

describe('canAddSelectedCardToTrade', () => {
  test('stops at the tile cap and counts copies already on the board', () => {
    const card = selected({ maxQty: 2, cardIds: [1] })
    expect(canAddSelectedCardToTrade(card)).toBe(true)

    addEntryToLeft(tradeEntryFor(card), 'usd')
    expect(canAddSelectedCardToTrade(card)).toBe(true)

    addEntryToLeft(tradeEntryFor(card), 'usd')
    expect(canAddSelectedCardToTrade(card)).toBe(false)
  })

  test('two duplicate tiles share one group cap rather than capping each other at one', () => {
    // What the combined view renders for two owned copies: separate tiles, own
    // card IDs, both carrying the group's count.
    const first = selected({ key: 'a', maxQty: 2, cardIds: [1] })
    const second = selected({ key: 'b', maxQty: 2, cardIds: [2] })

    addEntryToLeft(tradeEntryFor(first), 'usd')
    expect(canAddSelectedCardToTrade(second)).toBe(true)

    addEntryToLeft(tradeEntryFor(second), 'usd')
    expect(canAddSelectedCardToTrade(first)).toBe(false)
    expect(leftCards()).toHaveLength(1)
    expect(leftCards()[0]?.qty).toBe(2)
  })

  test('a wanted card is asked about the receiving side, not the offering one', () => {
    const wanted = selected({ sourceKind: 'wanted', sourceName: 'Want', maxQty: 1, cardIds: [9] })

    addEntryToRight(tradeEntryFor(wanted), 'usd')
    expect(rightCards()).toHaveLength(1)
    expect(leftCards()).toHaveLength(0)
    // The receiving side is uncapped — the point of the side split.
    expect(canAddSelectedCardToTrade(wanted)).toBe(true)
  })

  test('a deck copy of a card already offered from a collection is judged separately', () => {
    const fromCollection = selected({ maxQty: 1, cardIds: [1] })
    const fromDeck = selected({
      key: 'd',
      sourceKind: 'deck',
      sourceName: 'Deck',
      maxQty: 1,
      cardIds: [1],
    })

    addEntryToLeft(tradeEntryFor(fromCollection), 'usd')
    expect(canAddSelectedCardToTrade(fromCollection)).toBe(false)
    // Different source list: its own row, its own cap.
    expect(canAddSelectedCardToTrade(fromDeck)).toBe(true)
  })
})
