import { describe, expect, test } from 'bun:test'
import { pickedPrintingTradeEntry } from '../../../src/site/useSelectionTrade'
import type { PickedPrintingTradeSource } from '../../../src/site/useSelectionTrade'
import { makeScryfallCard } from '../../test-utils'

const deckSource: PickedPrintingTradeSource = {
  sourceName: 'My Deck',
  sourceKind: 'deck',
  maxQty: 3,
  cardIds: [7],
  currency: 'usd',
  useScryfallImgUrls: false,
}

describe('pickedPrintingTradeEntry', () => {
  test('takes the printing from the pick and the rest from the source line', () => {
    const printing = makeScryfallCard({
      name: "Jace's Archivist",
      set: 'MKM',
      collector_number: '123',
    })
    expect(pickedPrintingTradeEntry(printing, 'foil', deckSource)).toEqual({
      name: "Jace's Archivist",
      nameKey: 'jaces archivist',
      // Lowercased at the boundary, whatever case the printing object carries.
      set: 'mkm',
      collectorNumber: '123',
      finish: 'foil',
      language: undefined,
      scryfallCard: printing,
      sourceName: 'My Deck',
      sourceKind: 'deck',
      maxQty: 3,
      cardIds: [7],
    })
  })

  test('stamps a picked alternate-language printing with its language token', () => {
    const entry = pickedPrintingTradeEntry(
      makeScryfallCard({ name: 'Lightning Bolt', lang: 'ja' }),
      'nonfoil',
      { ...deckSource, sourceKind: 'wanted', maxQty: 1, cardIds: [] },
    )
    expect(entry.language).toBe('ja')
    expect(entry.sourceKind).toBe('wanted')
  })

  test('leaves an English printing unstamped, so it matches an untokened row', () => {
    const entry = pickedPrintingTradeEntry(
      makeScryfallCard({ name: 'Lightning Bolt', lang: 'en' }),
      'nonfoil',
      deckSource,
    )
    expect(entry.language).toBeUndefined()
  })
})
