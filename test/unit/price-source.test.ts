import { describe, expect, test } from 'bun:test'
import { isConfigParseError } from '../../src/config/ritual-config'
import {
  DEFAULT_PRICE_SOURCES,
  isPriceRequestConflict,
  isPriceSource,
  parseDefaultPriceSource,
  parsePriceSources,
  resolveDefaultPriceSource,
  resolvePriceRequest,
  resolveSiteCurrencies,
  isSiteCurrenciesError,
  sourceCurrency,
  sourcesForCurrency,
  VALID_PRICE_SOURCES,
} from '../../src/pricing/price-source'

describe('parsePriceSources', () => {
  test('absent falls back to the default (tcgplayer only)', () => {
    // Literal, not DEFAULT_PRICE_SOURCES echoed back: the default itself is
    // the contract ("if the config key is not present it defaults to
    // tcgplayer"), and a self-derived oracle could not catch it changing.
    expect(parsePriceSources(undefined)).toEqual(['tcgplayer'])
    expect(DEFAULT_PRICE_SOURCES).toEqual(['tcgplayer'])
  })

  test('an explicit empty array is preserved — it means "no prices on the sites"', () => {
    expect(parsePriceSources([])).toEqual([])
  })

  test('lowercases and dedupes store names', () => {
    expect(parsePriceSources(['TCGplayer', ' cardkingdom ', 'tcgplayer'])).toEqual([
      'tcgplayer',
      'cardkingdom',
    ])
  })

  test('an unknown store is a parse error naming the vocabulary', () => {
    const parsed = parsePriceSources(['tcgplayer', 'starcity'])
    expect(isConfigParseError(parsed)).toBe(true)
    if (isConfigParseError(parsed)) {
      expect(parsed.error).toContain('starcity')
      expect(parsed.error).toContain('cardmarket')
    }
  })

  test('a non-array (or an array with non-strings) is a parse error', () => {
    expect(isConfigParseError(parsePriceSources('tcgplayer'))).toBe(true)
    expect(isConfigParseError(parsePriceSources([1]))).toBe(true)
  })
})

describe('sourceCurrency', () => {
  test('each store quotes exactly one currency', () => {
    expect(sourceCurrency('tcgplayer')).toBe('usd')
    expect(sourceCurrency('cardkingdom')).toBe('usd')
    expect(sourceCurrency('cardmarket')).toBe('eur')
    expect(sourceCurrency('cardhoarder')).toBe('tix')
  })
})

describe('sourcesForCurrency', () => {
  test('narrows the enabled stores to a currency, in canonical order', () => {
    expect(sourcesForCurrency('usd', [...VALID_PRICE_SOURCES])).toEqual([
      'tcgplayer',
      'cardkingdom',
    ])
    expect(sourcesForCurrency('eur', [...VALID_PRICE_SOURCES])).toEqual(['cardmarket'])
    expect(sourcesForCurrency('tix', [...VALID_PRICE_SOURCES])).toEqual(['cardhoarder'])
    expect(sourcesForCurrency('usd', ['cardkingdom', 'tcgplayer'])).toEqual([
      'tcgplayer',
      'cardkingdom',
    ])
    expect(sourcesForCurrency('usd', ['cardmarket'])).toEqual([])
  })
})

describe('resolveSiteCurrencies', () => {
  test('offers only the currencies the enabled stores quote in — no tix unless opted in', () => {
    expect(resolveSiteCurrencies(['tcgplayer', 'cardkingdom'], 'tcgplayer')).toEqual({
      available: ['usd'],
      defaultSource: 'tcgplayer',
    })
    expect(resolveSiteCurrencies(['cardhoarder', 'cardmarket', 'tcgplayer'], 'cardmarket')).toEqual(
      { available: ['usd', 'eur', 'tix'], defaultSource: 'cardmarket' },
    )
  })

  test('opens on an enabled non-first USD store when it is the configured default', () => {
    expect(resolveSiteCurrencies(['tcgplayer', 'cardkingdom'], 'cardkingdom')).toEqual({
      available: ['usd'],
      defaultSource: 'cardkingdom',
    })
  })

  test('a configured store that is not enabled falls back to the first offered store', () => {
    expect(resolveSiteCurrencies(['cardmarket'], 'tcgplayer')).toEqual({
      available: ['eur'],
      defaultSource: 'cardmarket',
    })
    // Same currency, but the store itself is off: the enabled USD store wins.
    expect(resolveSiteCurrencies(['tcgplayer'], 'cardkingdom')).toEqual({
      available: ['usd'],
      defaultSource: 'tcgplayer',
    })
  })

  test('an explicit list narrows and orders the store-backed set, never adding to it', () => {
    const all = ['tcgplayer', 'cardmarket', 'cardhoarder'] as const
    expect(resolveSiteCurrencies([...all], 'tcgplayer', ['tix', 'eur'])).toEqual({
      available: ['tix', 'eur'],
      defaultSource: 'cardhoarder',
    })
    expect(resolveSiteCurrencies(['tcgplayer'], 'tcgplayer', ['tix', 'usd'])).toEqual({
      available: ['usd'],
      defaultSource: 'tcgplayer',
    })
  })

  test('an explicit list with no store behind any of it is an error', () => {
    const result = resolveSiteCurrencies(['tcgplayer'], 'tcgplayer', ['tix'])
    expect(result).toEqual({ error: 'no-store-for-currencies', requested: ['tix'] })
    expect(isSiteCurrenciesError(result)).toBeTrue()
  })

  test('no stores still bakes the configured default', () => {
    expect(resolveSiteCurrencies([], 'cardmarket')).toEqual({
      available: ['eur'],
      defaultSource: 'cardmarket',
    })
  })
})

describe('resolveDefaultPriceSource', () => {
  test('the configured store wins, even when the sites do not offer it', () => {
    expect(resolveDefaultPriceSource('cardkingdom', ['tcgplayer'])).toBe('cardkingdom')
  })

  test('absent reads the first enabled store, else tcgplayer', () => {
    expect(resolveDefaultPriceSource(undefined, ['cardmarket', 'cardhoarder'])).toBe('cardmarket')
    expect(resolveDefaultPriceSource(undefined, [])).toBe('tcgplayer')
  })
})

describe('resolvePriceRequest', () => {
  test('neither source nor currency reads the default store', () => {
    expect(resolvePriceRequest(undefined, undefined, 'cardkingdom')).toEqual({
      source: 'cardkingdom',
      currency: 'usd',
    })
  })

  test('a currency the default store quotes in keeps the default store', () => {
    expect(resolvePriceRequest(undefined, 'usd', 'cardkingdom')).toEqual({
      source: 'cardkingdom',
      currency: 'usd',
    })
  })

  test("any other currency reads that currency's Scryfall store", () => {
    expect(resolvePriceRequest(undefined, 'eur', 'cardkingdom')).toEqual({
      source: 'cardmarket',
      currency: 'eur',
    })
    expect(resolvePriceRequest(undefined, 'usd', 'cardhoarder')).toEqual({
      source: 'tcgplayer',
      currency: 'usd',
    })
  })

  test('an explicit source implies its currency and overrides the default', () => {
    expect(resolvePriceRequest('cardhoarder', undefined, 'tcgplayer')).toEqual({
      source: 'cardhoarder',
      currency: 'tix',
    })
    expect(resolvePriceRequest('cardkingdom', 'usd', 'cardmarket')).toEqual({
      source: 'cardkingdom',
      currency: 'usd',
    })
  })

  test('an explicit currency that disagrees with an explicit source is a conflict', () => {
    const result = resolvePriceRequest('cardmarket', 'usd', 'tcgplayer')
    expect(result).toEqual({
      error: 'source-currency-conflict',
      source: 'cardmarket',
      implied: 'eur',
    })
    expect(isPriceRequestConflict(result)).toBeTrue()
  })
})

describe('parseDefaultPriceSource', () => {
  test('absent stays absent; a store name is lowercased', () => {
    expect(parseDefaultPriceSource(undefined)).toBeUndefined()
    expect(parseDefaultPriceSource(' CardKingdom ')).toBe('cardkingdom')
  })

  test.each([['usd'], [5]])('rejects %p', (raw) => {
    const parsed = parseDefaultPriceSource(raw)
    expect(isConfigParseError(parsed)).toBeTrue()
  })
})

describe('the store vocabulary', () => {
  test('is pinned, in canonical order', () => {
    // Canonical order is load-bearing: it drives `sourcesForCurrency` and the
    // site's selector/checkbox ordering.
    expect(VALID_PRICE_SOURCES).toEqual(['tcgplayer', 'cardmarket', 'cardkingdom', 'cardhoarder'])
  })

  test('isPriceSource rejects non-store tokens', () => {
    expect(isPriceSource('usd')).toBe(false)
    expect(isPriceSource('')).toBe(false)
  })
})
