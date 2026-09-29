import { describe, expect, test } from 'bun:test'
import { isConfigParseError } from '../../src/config/ritual-config'
import {
  DEFAULT_PRICE_SOURCES,
  isPriceSource,
  parseDefaultPriceSource,
  parsePriceSources,
  resolveDefaultPriceSource,
  withPriceSource,
  resolveSiteStores,
  isSiteStoresError,
  settleCurrency,
  withCardKingdomFeed,
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

describe('resolveSiteStores', () => {
  test('offers the enabled stores in header order, with their currencies derived', () => {
    expect(resolveSiteStores(['cardhoarder', 'cardmarket', 'tcgplayer'], 'cardmarket')).toEqual({
      stores: ['tcgplayer', 'cardmarket', 'cardhoarder'],
      currencies: ['usd', 'eur', 'tix'],
      defaultSource: 'cardmarket',
    })
    // Card Kingdom is USD's second store, grouped beside TCGplayer.
    expect(resolveSiteStores(['tcgplayer', 'cardmarket', 'cardkingdom'], 'cardkingdom')).toEqual({
      stores: ['tcgplayer', 'cardkingdom', 'cardmarket'],
      currencies: ['usd', 'eur'],
      defaultSource: 'cardkingdom',
    })
  })

  test('a configured store the site does not offer falls back to the first offered one', () => {
    expect(resolveSiteStores(['cardmarket'], 'tcgplayer').defaultSource).toBe('cardmarket')
    expect(resolveSiteStores(['tcgplayer'], 'cardkingdom').defaultSource).toBe('tcgplayer')
  })

  test('an absent default reads the first priceSources entry', () => {
    expect(resolveSiteStores(['cardmarket', 'tcgplayer'], undefined).defaultSource).toBe(
      'cardmarket',
    )
  })

  test('an explicit list only narrows, and the default follows it', () => {
    const narrowed = resolveSiteStores(['tcgplayer', 'cardmarket'], 'tcgplayer', [
      'cardmarket',
      'cardhoarder',
    ])
    expect(narrowed).toEqual({
      stores: ['cardmarket'],
      currencies: ['eur'],
      defaultSource: 'cardmarket',
    })
  })

  test('an explicit list keeping no enabled store is an error', () => {
    const result = resolveSiteStores(['tcgplayer'], 'tcgplayer', ['cardhoarder'])
    expect(result).toEqual({ error: 'stores-not-enabled', requested: ['cardhoarder'] })
    expect(isSiteStoresError(result)).toBeTrue()
  })

  test("no stores still bakes the default store's currency", () => {
    expect(resolveSiteStores([], 'cardmarket')).toEqual({
      stores: [],
      currencies: ['eur'],
      defaultSource: 'cardmarket',
    })
  })
})

describe('withCardKingdomFeed', () => {
  const offered = resolveSiteStores(['tcgplayer', 'cardkingdom'], 'cardkingdom')

  test('a Card Kingdom store with a feed stays offered', () => {
    expect(withCardKingdomFeed(offered, true)).toBe(offered)
  })

  test('without a feed it is dropped, and a CK default falls to the next store', () => {
    expect(withCardKingdomFeed(offered, false)).toEqual({
      stores: ['tcgplayer'],
      currencies: ['usd'],
      defaultSource: 'tcgplayer',
    })
  })

  test('a Card Kingdom-only site without a feed offers no store at all', () => {
    const ckOnly = resolveSiteStores(['cardkingdom'], undefined)
    expect(withCardKingdomFeed(ckOnly, false).stores).toEqual([])
  })
})

describe('settleCurrency', () => {
  test('keeps a currency some offered store still prices in', () => {
    expect(settleCurrency('eur', ['tcgplayer', 'cardmarket'], 'tcgplayer')).toBe('eur')
  })

  test("falls to the default store's currency, else the first offered store's", () => {
    expect(settleCurrency('tix', ['tcgplayer', 'cardmarket'], 'cardmarket')).toBe('eur')
    expect(settleCurrency('tix', ['tcgplayer', 'cardmarket'], 'cardhoarder')).toBe('usd')
  })

  test('with nothing offered, the current currency stands', () => {
    expect(settleCurrency('eur', [], 'tcgplayer')).toBe('eur')
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

describe('withPriceSource', () => {
  test('enabling inserts in canonical order, not at the end', () => {
    expect(withPriceSource(['cardkingdom'], 'cardmarket', true)).toEqual([
      'cardmarket',
      'cardkingdom',
    ])
    expect(withPriceSource(['tcgplayer'], 'tcgplayer', true)).toEqual(['tcgplayer'])
  })

  test('disabling removes only that store', () => {
    expect(withPriceSource(['tcgplayer', 'cardmarket'], 'tcgplayer', false)).toEqual(['cardmarket'])
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
