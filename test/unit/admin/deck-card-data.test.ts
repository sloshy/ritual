import { describe, test, expect } from 'bun:test'
import {
  deckCardDataReducer,
  initialDeckCardData,
  type DeckCardData,
} from '../../../src/admin/site/hooks/useDeckCardData'
import type { ScryfallCard } from '../../../src/types'

const mockCard = (name: string, set = 'mkm', cn = '1'): ScryfallCard =>
  ({
    name,
    set,
    collector_number: cn,
    prices: { usd: '1.00' },
  }) as unknown as ScryfallCard

describe('deckCardDataReducer', () => {
  test('initialDeckCardData has empty maps', () => {
    expect(initialDeckCardData).toEqual({
      cards: {},
      printings: {},
      lowestPriceCards: {},
      lowestPriceCardsEur: {},
      lowestPriceCardsTix: {},
      symbolMap: {},
    })
  })

  test('LOAD replaces entire state', () => {
    const data: DeckCardData = {
      cards: { 'Lightning Bolt': mockCard('Lightning Bolt') },
      printings: { 'Lightning Bolt': [mockCard('Lightning Bolt')] },
      lowestPriceCards: { 'Lightning Bolt': mockCard('Lightning Bolt') },
      lowestPriceCardsEur: { 'Lightning Bolt': mockCard('Lightning Bolt') },
      lowestPriceCardsTix: { 'Lightning Bolt': mockCard('Lightning Bolt') },
      symbolMap: { '{R}': 'red.svg' },
    }
    const next = deckCardDataReducer(initialDeckCardData, { type: 'LOAD', data })
    expect(next).toEqual(data)
  })

  test('ADD_CARD with card sets cards and all 3 lowestPrice maps', () => {
    const card = mockCard('Counterspell')
    const next = deckCardDataReducer(initialDeckCardData, {
      type: 'ADD_CARD',
      cardName: 'Counterspell',
      card,
    })
    expect(next.cards['Counterspell']).toBe(card)
    expect(next.lowestPriceCards['Counterspell']).toBe(card)
    expect(next.lowestPriceCardsEur['Counterspell']).toBe(card)
    expect(next.lowestPriceCardsTix['Counterspell']).toBe(card)
  })

  test('ADD_CARD with printings sets printings map', () => {
    const p1 = mockCard('Bolt', 'lea', '1')
    const p2 = mockCard('Bolt', '2xm', '42')
    const next = deckCardDataReducer(initialDeckCardData, {
      type: 'ADD_CARD',
      cardName: 'Bolt',
      printings: [p1, p2],
    })
    expect(next.printings['Bolt']).toEqual([p1, p2])
  })

  test('ADD_CARD without card or printings returns unchanged maps', () => {
    const prev: DeckCardData = {
      ...initialDeckCardData,
      cards: { Existing: mockCard('Existing') },
    }
    const next = deckCardDataReducer(prev, {
      type: 'ADD_CARD',
      cardName: 'New',
    })
    expect(next.cards).toEqual(prev.cards)
    expect(next.printings).toEqual(prev.printings)
  })

  test('SET_PRICES updates lowestPrice maps', () => {
    const cheapUsd = mockCard('Sol Ring', 'c21', '1')
    const cheapEur = mockCard('Sol Ring', 'cmr', '2')
    const cheapTix = mockCard('Sol Ring', 'c19', '3')
    const next = deckCardDataReducer(initialDeckCardData, {
      type: 'SET_PRICES',
      cardName: 'Sol Ring',
      lowestPriceCard: cheapUsd,
      lowestPriceCardEur: cheapEur,
      lowestPriceCardTix: cheapTix,
    })
    expect(next.lowestPriceCards['Sol Ring']).toBe(cheapUsd)
    expect(next.lowestPriceCardsEur['Sol Ring']).toBe(cheapEur)
    expect(next.lowestPriceCardsTix['Sol Ring']).toBe(cheapTix)
  })

  test('SET_PRICES with representative updates cards map', () => {
    const rep = mockCard('Path', 'mm3', '25')
    const next = deckCardDataReducer(initialDeckCardData, {
      type: 'SET_PRICES',
      cardName: 'Path',
      representative: rep,
      lowestPriceCard: null,
      lowestPriceCardEur: null,
      lowestPriceCardTix: null,
    })
    expect(next.cards['Path']).toBe(rep)
  })

  test('SET_PRICES without representative does not change cards', () => {
    const prev: DeckCardData = {
      ...initialDeckCardData,
      cards: { Bolt: mockCard('Bolt') },
    }
    const next = deckCardDataReducer(prev, {
      type: 'SET_PRICES',
      cardName: 'Bolt',
      lowestPriceCard: null,
      lowestPriceCardEur: null,
      lowestPriceCardTix: null,
    })
    expect(next.cards['Bolt']).toBe(prev.cards['Bolt'])
  })

  test('SET_PRICES with printings updates printings map', () => {
    const p = [mockCard('Bolt', 'lea', '1')]
    const next = deckCardDataReducer(initialDeckCardData, {
      type: 'SET_PRICES',
      cardName: 'Bolt',
      printings: p,
      lowestPriceCard: null,
      lowestPriceCardEur: null,
      lowestPriceCardTix: null,
    })
    expect(next.printings['Bolt']).toEqual(p)
  })
})
