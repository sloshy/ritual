import { describe, expect, test } from 'bun:test'
import {
  sumStorePrices,
  summaryPriceFields,
  type PricedLine,
  type StoreLinePricing,
} from '../../../src/site-build/summary-prices'

type Line = PricedLine & { usd: number; eur: number }

const lines: Line[] = [
  { quantity: 2, pinned: true, usd: 3, eur: 0 },
  { quantity: 1, pinned: false, usd: 5, eur: 4 },
]

const stores: StoreLinePricing<Line>[] = [
  { source: 'tcgplayer', price: (line) => line.usd, lowest: (line) => line.usd / 2 },
  { source: 'cardmarket', price: (line) => line.eur },
]

describe('sumStorePrices', () => {
  test('sums quantity-weighted totals, missing and estimated copies per store', () => {
    const totals = sumStorePrices(lines, stores)
    expect(totals.get('tcgplayer')).toEqual({ total: 11, lowest: 5.5, missing: 0, estimated: 1 })
    // No EUR price for the pinned pair: missing, and so an estimate too.
    expect(totals.get('cardmarket')).toEqual({ total: 4, lowest: 0, missing: 2, estimated: 3 })
  })
})

describe('summaryPriceFields', () => {
  test('writes each chosen metric under its store-suffixed field, and nothing else', () => {
    const fields = summaryPriceFields(sumStorePrices(lines, stores), ['total', 'missing'])
    expect(fields).toEqual({
      totalPrice: 11,
      missingPriceCount: 0,
      totalPriceEur: 4,
      missingPriceCountEur: 2,
    })
  })
})
