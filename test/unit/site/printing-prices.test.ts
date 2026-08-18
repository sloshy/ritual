import { afterEach, describe, expect, test } from 'bun:test'
import { resetBuylistQuotes, seedBuylistQuotes } from '../../../src/site/buylist-quotes'
import {
  printingFinishPrices,
  printingPriceText,
  printingSortPrice,
} from '../../../src/site/printing-prices'
import { printingQuoteRequests } from '../../../src/site/printing-quotes'
import {
  resetPriceView,
  selectUsdSource,
  setEnabledPriceSources,
} from '../../../src/site/price-view'
import { t } from '../../../src/i18n/t'
import { makeBuylistQuote, makeScryfallCard } from '../../test-utils'

afterEach(() => {
  resetPriceView()
  resetBuylistQuotes()
})

const dual = makeScryfallCard({
  set: 'tst',
  collector_number: '7',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '2.00', usd_foil: '5.00', eur: '1.50' },
})

/**
 * A printing whose finish list does *not* lead with nonfoil. The reorder to the
 * finish the printing is read at is only observable against a card like this —
 * Scryfall lists nonfoil first, so every other fixture would pass unchanged.
 */
const foilFirst = makeScryfallCard({
  set: 'tst',
  collector_number: '6',
  finishes: ['foil', 'nonfoil'],
  prices: { usd: '2.00', usd_foil: '5.00' },
})

const foilOnly = makeScryfallCard({
  set: 'tst',
  collector_number: '8',
  finishes: ['foil'],
  prices: { usd: null, usd_foil: '9.00' },
})

function seedRetail(quotes: Record<string, number>): void {
  seedBuylistQuotes({
    cardkingdom: {
      quotes: Object.fromEntries(
        Object.entries(quotes).map(([key, priceRetail]) => [
          key,
          makeBuylistQuote({ priceRetail, qtyRetail: 1 }),
        ]),
      ),
      feedCreatedAt: '2026-08-04 06:06:09',
      feedRetrievedAt: 1,
    },
  })
}

describe('printingFinishPrices', () => {
  test('leads with the finish the printing is read at, then its alternates', () => {
    expect(printingFinishPrices(dual, 'usd')).toEqual([
      { finish: 'nonfoil', price: 2 },
      { finish: 'foil', price: 5 },
    ])
  })

  test('the read-at finish leads however the printing declares its finishes', () => {
    expect(printingFinishPrices(foilFirst, 'usd')).toEqual([
      { finish: 'nonfoil', price: 2 },
      { finish: 'foil', price: 5 },
    ])
  })

  test('a foil-only printing leads with foil rather than an absent nonfoil', () => {
    expect(printingFinishPrices(foilOnly, 'usd')).toEqual([{ finish: 'foil', price: 9 }])
  })

  test('follows the selected source, quoting Card Kingdom retail per finish', () => {
    // Delegation to `sitePriceForFinish` is what is new here; that function's own
    // rules — no TCGplayer fallback for an unquoted finish, EUR untouched by the
    // USD source — are pinned in price-view.test.ts. The unquoted foil below is
    // asserted for the *row*: a finish the store cannot price still gets one.
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    selectUsdSource('cardkingdom')
    seedRetail({ 'tst:7:nonfoil': 3.5 })
    expect(printingFinishPrices(dual, 'usd')).toEqual([
      { finish: 'nonfoil', price: 3.5 },
      { finish: 'foil', price: 0 },
    ])
  })
})

describe('printingPriceText', () => {
  test('formats a price, and stands in for a missing one from the catalog', () => {
    expect(printingPriceText(t, 4.5, 'usd')).toBe('$4.50')
    // The catalog's value, not a hardcoded literal: `formatPriceOrNA`'s English
    // 'N/A' is exactly what this function exists to keep out of the sites.
    expect(printingPriceText(t, 0, 'usd')).toBe(t('site.printingPrice.na'))
  })
})

describe('printingSortPrice', () => {
  test('is the price at the finish the printing is read at', () => {
    expect(printingSortPrice(dual, 'usd')).toBe(2)
    expect(printingSortPrice(foilOnly, 'usd')).toBe(9)
  })

  test('follows the selected source, so a grid sorts by the money it displays', () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    selectUsdSource('cardkingdom')
    seedRetail({ 'tst:7:nonfoil': 3.5 })
    expect(printingSortPrice(dual, 'usd')).toBe(3.5)
    // A printing the store has no product for sorts as unpriced, not as its
    // TCGplayer price.
    expect(printingSortPrice(foilOnly, 'usd')).toBe(0)
  })
})

describe('printingQuoteRequests', () => {
  test('asks for every finish of every printing', () => {
    expect(
      printingQuoteRequests([dual, foilOnly]).map(
        (r) => `${r.set}:${r.collectorNumber}:${r.finish}`,
      ),
    ).toEqual(['tst:7:nonfoil', 'tst:7:foil', 'tst:8:foil'])
  })

  // The English-only rule itself belongs to `buylistRequestFor`; what is pinned
  // here is that this loop honours its refusal instead of pushing a null.
  test('skips non-English printings, which no buyer quotes', () => {
    const japanese = makeScryfallCard({
      set: 'tst',
      collector_number: '9',
      lang: 'ja',
      finishes: ['nonfoil'],
    })
    expect(printingQuoteRequests([japanese])).toEqual([])
  })
})
