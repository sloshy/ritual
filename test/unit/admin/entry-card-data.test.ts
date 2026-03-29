import { describe, test, expect } from 'bun:test'
import {
  entryCardDataReducer,
  initialEntryCardData,
  type EntryCardData,
} from '../../../src/admin/site/hooks/useEntryCardData'
import type { ScryfallCard } from '../../../src/types'

const mockCard = (name: string, set = 'mkm', cn = '1'): ScryfallCard =>
  ({
    name,
    set,
    collector_number: cn,
    prices: { usd: '1.00' },
  }) as unknown as ScryfallCard

describe('entryCardDataReducer', () => {
  test('initialEntryCardData has empty maps', () => {
    expect(initialEntryCardData).toEqual({
      cards: {},
      printings: {},
      symbolMap: {},
    })
  })

  test('LOAD replaces entire state', () => {
    const data: EntryCardData = {
      cards: { Bolt: mockCard('Bolt') },
      printings: { Bolt: [mockCard('Bolt')] },
      symbolMap: { '{R}': 'red.svg' },
    }
    const next = entryCardDataReducer(initialEntryCardData, { type: 'LOAD', data })
    expect(next).toEqual(data)
  })

  test('ADD_CARD with card indexes by name and set:collector_number', () => {
    const card = mockCard('Bolt', 'lea', '141')
    const next = entryCardDataReducer(initialEntryCardData, {
      type: 'ADD_CARD',
      cardName: 'Bolt',
      card,
    })
    expect(next.cards['Bolt']).toBe(card)
    expect(next.cards['lea:141']).toBe(card)
  })

  test('ADD_CARD with printings indexes each printing by set:collector_number', () => {
    const p1 = mockCard('Bolt', 'lea', '141')
    const p2 = mockCard('Bolt', '2xm', '42')
    const next = entryCardDataReducer(initialEntryCardData, {
      type: 'ADD_CARD',
      cardName: 'Bolt',
      printings: [p1, p2],
    })
    expect(next.printings['Bolt']).toEqual([p1, p2])
    expect(next.cards['lea:141']).toBe(p1)
    expect(next.cards['2xm:42']).toBe(p2)
  })

  test('ADD_CARD without card or printings returns unchanged data', () => {
    const prev: EntryCardData = {
      ...initialEntryCardData,
      cards: { Existing: mockCard('Existing') },
    }
    const next = entryCardDataReducer(prev, {
      type: 'ADD_CARD',
      cardName: 'New',
    })
    expect(next.cards).toEqual(prev.cards)
    expect(next.printings).toEqual(prev.printings)
  })

  test('SET_PRICES with representative updates cards map', () => {
    const rep = mockCard('Path', 'mm3', '25')
    const next = entryCardDataReducer(initialEntryCardData, {
      type: 'SET_PRICES',
      cardName: 'Path',
      representative: rep,
    })
    expect(next.cards['Path']).toBe(rep)
  })

  test('SET_PRICES with printings indexes by set:collector_number', () => {
    const p1 = mockCard('Bolt', 'lea', '141')
    const p2 = mockCard('Bolt', '2xm', '42')
    const next = entryCardDataReducer(initialEntryCardData, {
      type: 'SET_PRICES',
      cardName: 'Bolt',
      printings: [p1, p2],
    })
    expect(next.printings['Bolt']).toEqual([p1, p2])
    expect(next.cards['lea:141']).toBe(p1)
    expect(next.cards['2xm:42']).toBe(p2)
  })

  test('SET_PRICES without representative does not modify cards by name', () => {
    const prev: EntryCardData = {
      ...initialEntryCardData,
      cards: { Bolt: mockCard('Bolt') },
    }
    const next = entryCardDataReducer(prev, {
      type: 'SET_PRICES',
      cardName: 'Bolt',
    })
    expect(next.cards['Bolt']).toBe(prev.cards['Bolt'])
  })

  test('symbolMap is preserved by ADD_CARD and SET_PRICES', () => {
    const prev: EntryCardData = {
      cards: {},
      printings: {},
      symbolMap: { '{R}': 'red.svg' },
    }
    const next1 = entryCardDataReducer(prev, {
      type: 'ADD_CARD',
      cardName: 'Bolt',
      card: mockCard('Bolt'),
    })
    expect(next1.symbolMap).toEqual({ '{R}': 'red.svg' })

    const next2 = entryCardDataReducer(prev, {
      type: 'SET_PRICES',
      cardName: 'Bolt',
      representative: mockCard('Bolt'),
    })
    expect(next2.symbolMap).toEqual({ '{R}': 'red.svg' })
  })
})
