import { afterEach, describe, expect, test } from 'bun:test'
import { resetBuylistQuotes, seedBuylistQuotes } from '../../../src/site/buylist-quotes'
import {
  activeUsdSource,
  currencyHasSource,
  maybeDefaultSellSource,
  maybeRestoreDefaultSource,
  offeredCurrencies,
  offersUsdSourceChoice,
  pricesEnabled,
  resetPriceView,
  selectUsdSource,
  setEnabledPriceSources,
  sitePrice,
  sitePriceForFinish,
  usdSourceChoices,
  usdSourceIsExplicit,
} from '../../../src/site/price-view'
import { makeBuylistQuote, makeScryfallCard } from '../../test-utils'

afterEach(() => {
  resetPriceView()
  resetBuylistQuotes()
})

const card = makeScryfallCard({
  set: 'tst',
  collector_number: '7',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '2.00', usd_foil: '5.00', eur: '1.50' },
})

function seedRetail(key: string, priceRetail: number): void {
  seedBuylistQuotes({
    cardkingdom: {
      quotes: { [key]: makeBuylistQuote({ priceRetail, qtyRetail: 1 }) },
      feedCreatedAt: '2026-08-04 06:06:09',
      feedRetrievedAt: 1,
    },
  })
}

describe('enabled sources and offered currencies', () => {
  test('defaults to TCGplayer only; undefined (an old index) reads as the default', () => {
    setEnabledPriceSources(undefined)
    expect(pricesEnabled()).toBe(true)
    expect(usdSourceChoices()).toEqual(['tcgplayer'])
    expect(offersUsdSourceChoice('usd')).toBe(false)
  })

  test('an empty array disables prices entirely, tix included', () => {
    setEnabledPriceSources([])
    expect(pricesEnabled()).toBe(false)
    expect(offeredCurrencies(['usd', 'eur', 'tix'])).toEqual([])
  })

  test('a currency is offered only when an enabled source quotes it', () => {
    setEnabledPriceSources(['cardmarket'])
    expect(currencyHasSource('usd')).toBe(false)
    expect(currencyHasSource('eur')).toBe(true)
    expect(offeredCurrencies(['usd', 'eur', 'tix'])).toEqual(['eur', 'tix'])
  })

  test('the source choice exists only for USD with both stores enabled', () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    expect(offersUsdSourceChoice('usd')).toBe(true)
    expect(offersUsdSourceChoice('eur')).toBe(false)
    expect(usdSourceChoices()).toEqual(['tcgplayer', 'cardkingdom'])
  })
})

describe('activeUsdSource', () => {
  test('a chosen source that is no longer enabled falls back to TCGplayer', () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    selectUsdSource('cardkingdom')
    expect(activeUsdSource()).toBe('cardkingdom')
    setEnabledPriceSources(['tcgplayer'])
    expect(activeUsdSource()).toBe('tcgplayer')
  })

  test("sell mode's courtesy default engages and disengages, but never overrides a pick", () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    maybeDefaultSellSource()
    expect(activeUsdSource()).toBe('cardkingdom')
    maybeRestoreDefaultSource()
    expect(activeUsdSource()).toBe('tcgplayer')

    selectUsdSource('tcgplayer')
    maybeDefaultSellSource()
    expect(activeUsdSource()).toBe('tcgplayer')

    // The restore is just as deferential: an explicit Card Kingdom pick
    // survives leaving sell mode.
    selectUsdSource('cardkingdom')
    maybeRestoreDefaultSource()
    expect(activeUsdSource()).toBe('cardkingdom')
  })

  test('a cardkingdom-only deployment reads Card Kingdom without any pick', () => {
    setEnabledPriceSources(['cardkingdom'])
    expect(activeUsdSource()).toBe('cardkingdom')
    expect(usdSourceIsExplicit()).toBe(false)
  })

  test('the courtesy default does nothing when Card Kingdom is not enabled', () => {
    setEnabledPriceSources(['tcgplayer'])
    maybeDefaultSellSource()
    expect(activeUsdSource()).toBe('tcgplayer')
  })
})

describe('sitePriceForFinish', () => {
  test('reads Scryfall under the default source, in every currency', () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom', 'cardmarket'])
    expect(sitePriceForFinish(card, 'foil', 'usd')).toBe(5)
    expect(sitePriceForFinish(card, 'nonfoil', 'eur')).toBe(1.5)
    expect(sitePrice(card, 'usd')).toBe(2)
  })

  test('reads CK retail from the quote store under the cardkingdom source — no fallback', () => {
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])
    selectUsdSource('cardkingdom')
    seedRetail('tst:7:nonfoil', 3.75)
    expect(sitePriceForFinish(card, 'nonfoil', 'usd')).toBe(3.75)
    // The no-finish read resolves the printing's default finish (nonfoil here)
    // — the same key the bake requested for the entry.
    expect(sitePrice(card, 'usd')).toBe(3.75)
    // The foil has no CK product: honestly unpriced, never the Scryfall $5.
    expect(sitePriceForFinish(card, 'foil', 'usd')).toBe(0)
    // EUR is untouched by the USD source choice.
    expect(sitePriceForFinish(card, 'nonfoil', 'eur')).toBe(1.5)
  })
})
