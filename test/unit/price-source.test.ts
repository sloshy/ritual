import { describe, expect, test } from 'bun:test'
import { isConfigParseError } from '../../src/config/ritual-config'
import {
  DEFAULT_PRICE_SOURCES,
  isPriceSource,
  parsePriceSources,
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
  })
})

describe('sourcesForCurrency', () => {
  test('narrows the enabled stores to a currency, in canonical order', () => {
    expect(sourcesForCurrency('usd', [...VALID_PRICE_SOURCES])).toEqual([
      'tcgplayer',
      'cardkingdom',
    ])
    expect(sourcesForCurrency('eur', [...VALID_PRICE_SOURCES])).toEqual(['cardmarket'])
    expect(sourcesForCurrency('usd', ['cardmarket'])).toEqual([])
  })

  test('tix has no stores by design', () => {
    expect(sourcesForCurrency('tix', [...VALID_PRICE_SOURCES])).toEqual([])
  })
})

describe('the store vocabulary', () => {
  test('is pinned, in canonical order', () => {
    // Canonical order is load-bearing: it drives `sourcesForCurrency` and the
    // site's selector/checkbox ordering.
    expect(VALID_PRICE_SOURCES).toEqual(['tcgplayer', 'cardmarket', 'cardkingdom'])
  })

  test('isPriceSource rejects non-store tokens', () => {
    expect(isPriceSource('usd')).toBe(false)
    expect(isPriceSource('')).toBe(false)
  })
})
