import { describe, test, expect } from 'bun:test'
import {
  isPriceCurrency,
  parsePriceCurrencyFlag,
  formatPrice,
  formatPriceOrNA,
  formatPriceWithMissing,
  getCardPrice,
  getCardPriceForFinish,
  isCurrencyAvailableForCard,
  parseCurrenciesFlag,
} from '../../src/price-currency'
import type { ScryfallCard } from '../../src/types'
import { makeScryfallCard } from '../test-utils'

function makeCard(prices: Partial<ScryfallCard['prices']> = {}): ScryfallCard {
  return makeScryfallCard({ prices })
}

describe('isPriceCurrency', () => {
  test('accepts only the known currencies', () => {
    expect(isPriceCurrency('usd')).toBe(true)
    expect(isPriceCurrency('eur')).toBe(true)
    expect(isPriceCurrency('tix')).toBe(true)
    expect(isPriceCurrency('gbp')).toBe(false)
    expect(isPriceCurrency('')).toBe(false)
  })
})

describe('parsePriceCurrencyFlag', () => {
  test('defaults to usd when undefined', () => {
    expect(parsePriceCurrencyFlag(undefined)).toBe('usd')
  })

  test('uses the given fallback when undefined or empty', () => {
    expect(parsePriceCurrencyFlag(undefined, 'eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('', 'tix')).toBe('tix')
    expect(parsePriceCurrencyFlag('usd', 'eur')).toBe('usd')
  })

  test('parses case-insensitively', () => {
    expect(parsePriceCurrencyFlag('USD')).toBe('usd')
    expect(parsePriceCurrencyFlag('usd')).toBe('usd')
    expect(parsePriceCurrencyFlag('Usd')).toBe('usd')
    expect(parsePriceCurrencyFlag('EUR')).toBe('eur')
    expect(parsePriceCurrencyFlag('eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('Eur')).toBe('eur')
    expect(parsePriceCurrencyFlag('TIX')).toBe('tix')
    expect(parsePriceCurrencyFlag('tix')).toBe('tix')
    expect(parsePriceCurrencyFlag('Tix')).toBe('tix')
  })

  test('trims whitespace', () => {
    expect(parsePriceCurrencyFlag('  eur  ')).toBe('eur')
  })

  test('throws on invalid input', () => {
    expect(() => parsePriceCurrencyFlag('gbp')).toThrow(/Invalid price currency/)
    expect(() => parsePriceCurrencyFlag('jpy')).toThrow(/Invalid price currency/)
  })
})

describe('formatPrice', () => {
  test('formats usd with dollar sign', () => {
    expect(formatPrice(12.5, 'usd')).toBe('$12.50')
  })

  test('formats eur with euro sign', () => {
    expect(formatPrice(8, 'eur')).toBe('€8.00')
  })

  test('formats tix with suffix', () => {
    expect(formatPrice(3.25, 'tix')).toBe('3.25 tix')
  })

  test('formats zero', () => {
    expect(formatPrice(0, 'usd')).toBe('$0.00')
  })
})

describe('formatPriceWithMissing', () => {
  test('returns normal format when no cards are missing', () => {
    expect(formatPriceWithMissing(12.5, 'usd', 0)).toBe('$12.50')
  })

  test('returns "At least" format when cards are missing', () => {
    expect(formatPriceWithMissing(10.0, 'usd', 3)).toBe('At least $10.00 (missing 3 cards)')
    expect(formatPriceWithMissing(8.5, 'eur', 2)).toBe('At least €8.50 (missing 2 cards)')
    expect(formatPriceWithMissing(5.0, 'tix', 10)).toBe('At least 5.00 tix (missing 10 cards)')
  })

  test('uses singular "card" when only 1 is missing', () => {
    expect(formatPriceWithMissing(20.0, 'usd', 1)).toBe('At least $20.00 (missing 1 card)')
  })

  test('returns normal format for zero missing with tix', () => {
    expect(formatPriceWithMissing(3.25, 'tix', 0)).toBe('3.25 tix')
  })
})

describe('formatPriceOrNA', () => {
  test('returns formatted price for positive amounts', () => {
    expect(formatPriceOrNA(12.5, 'usd')).toBe('$12.50')
    expect(formatPriceOrNA(8, 'eur')).toBe('€8.00')
    expect(formatPriceOrNA(3.25, 'tix')).toBe('3.25 tix')
  })

  test('returns N/A for zero', () => {
    expect(formatPriceOrNA(0, 'usd')).toBe('N/A')
    expect(formatPriceOrNA(0, 'eur')).toBe('N/A')
    expect(formatPriceOrNA(0, 'tix')).toBe('N/A')
  })
})

describe('getCardPrice', () => {
  test('returns price per currency', () => {
    const card = makeCard({ usd: '12.50', eur: '9.99', tix: '3.00' })
    expect(getCardPrice(card, 'usd')).toBe(12.5)
    expect(getCardPrice(card, 'eur')).toBe(9.99)
    expect(getCardPrice(card, 'tix')).toBe(3)
  })

  test('returns 0 when price is null', () => {
    const card = makeCard()
    expect(getCardPrice(card, 'usd')).toBe(0)
    expect(getCardPrice(card, 'eur')).toBe(0)
    expect(getCardPrice(card, 'tix')).toBe(0)
  })
})

describe('getCardPriceForFinish', () => {
  test('returns nonfoil usd price by default', () => {
    const card = makeCard({ usd: '5.00', usd_foil: '10.00' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'usd')).toBe(5)
  })

  test('returns foil usd price', () => {
    const card = makeCard({ usd: '5.00', usd_foil: '10.00' })
    expect(getCardPriceForFinish(card, 'foil', 'usd')).toBe(10)
  })

  test('returns etched usd price', () => {
    const card = makeCard({ usd_etched: '15.00' })
    expect(getCardPriceForFinish(card, 'etched', 'usd')).toBe(15)
  })

  test('returns eur nonfoil price', () => {
    const card = makeCard({ eur: '7.50' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'eur')).toBe(7.5)
  })

  test('returns eur foil price', () => {
    const card = makeCard({ eur_foil: '20.00' })
    expect(getCardPriceForFinish(card, 'foil', 'eur')).toBe(20)
  })

  test('returns tix price regardless of finish', () => {
    const card = makeCard({ tix: '2.50' })
    expect(getCardPriceForFinish(card, 'nonfoil', 'tix')).toBe(2.5)
    expect(getCardPriceForFinish(card, 'foil', 'tix')).toBe(2.5)
  })

  test('returns 0 when price is null', () => {
    const card = makeCard()
    expect(getCardPriceForFinish(card, 'nonfoil', 'usd')).toBe(0)
    expect(getCardPriceForFinish(card, 'foil', 'eur')).toBe(0)
    expect(getCardPriceForFinish(card, 'nonfoil', 'tix')).toBe(0)
  })
})

describe('isCurrencyAvailableForCard', () => {
  test('usd requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'usd')).toBe(false)
    expect(isCurrencyAvailableForCard(['arena'], 'usd')).toBe(false)
  })

  test('eur requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'eur')).toBe(false)
  })

  test('tix requires mtgo', () => {
    expect(isCurrencyAvailableForCard(['mtgo'], 'tix')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper'], 'tix')).toBe(false)
  })

  test('empty games array returns true (backward compat)', () => {
    expect(isCurrencyAvailableForCard([], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'tix')).toBe(true)
  })

  test('paper+mtgo supports all currencies', () => {
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'tix')).toBe(true)
  })
})

describe('parseCurrenciesFlag', () => {
  test('returns all currencies when undefined', () => {
    expect(parseCurrenciesFlag(undefined)).toEqual(['usd', 'eur', 'tix'])
  })

  test('parses single currency', () => {
    expect(parseCurrenciesFlag('eur')).toEqual(['eur'])
  })

  test('parses comma-separated currencies', () => {
    expect(parseCurrenciesFlag('usd,eur')).toEqual(['usd', 'eur'])
  })

  test('deduplicates currencies', () => {
    expect(parseCurrenciesFlag('usd,usd,eur')).toEqual(['usd', 'eur'])
  })

  test('is case insensitive', () => {
    expect(parseCurrenciesFlag('USD,EUR')).toEqual(['usd', 'eur'])
  })

  test('trims whitespace', () => {
    expect(parseCurrenciesFlag(' usd , tix ')).toEqual(['usd', 'tix'])
  })

  test('throws for invalid currency', () => {
    expect(() => parseCurrenciesFlag('usd,gbp')).toThrow()
  })

  test('returns all currencies for empty string (treated as no input)', () => {
    expect(parseCurrenciesFlag('')).toEqual(['usd', 'eur', 'tix'])
  })
})
