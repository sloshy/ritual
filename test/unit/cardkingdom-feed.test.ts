import { describe, expect, test } from 'bun:test'
import {
  buildCardKingdomIndex,
  lookupSkuPrinting,
  normalizeCollectorNumber,
  parseCardKingdomFeed,
  parseSkuPrinting,
  productFinish,
  productUrl,
} from '../../src/cardkingdom'
import { makeCardKingdomProduct } from '../test-utils'

/** A raw feed row as Card Kingdom serves it (string-encoded bools and prices). */
function rawProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    sku: 'TST-0001',
    scryfall_id: 'sf-1',
    url: 'mtg/test-set/test-card',
    name: 'Test Card',
    variation: '',
    edition: 'Test Set',
    is_foil: 'false',
    price_retail: '1.00',
    qty_retail: 3,
    price_buy: '0.50',
    qty_buying: 10,
    condition_values: {},
    ...overrides,
  }
}

function rawFeed(products: unknown[]): Record<string, unknown> {
  return {
    meta: { created_at: '2026-08-04 06:06:09', base_url: 'https://www.cardkingdom.com/' },
    data: products,
  }
}

/** A parsed (trimmed) product for index tests. */
const product = makeCardKingdomProduct

describe('parseCardKingdomFeed', () => {
  test('parses a well-formed feed, decoding string bools and prices', () => {
    const parsed = parseCardKingdomFeed(rawFeed([rawProduct()]))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.warnings).toEqual([])
    expect(parsed.feed.createdAt).toBe('2026-08-04 06:06:09')
    expect(parsed.feed.baseUrl).toBe('https://www.cardkingdom.com/')
    expect(parsed.feed.products).toEqual([
      {
        id: 1,
        sku: 'TST-0001',
        scryfallId: 'sf-1',
        url: 'mtg/test-set/test-card',
        name: 'Test Card',
        variation: '',
        edition: 'Test Set',
        finish: 'nonfoil',
        priceRetail: 1,
        priceBuy: 0.5,
        qtyBuying: 10,
      },
    ])
  })

  test('rejects a payload without the meta/data envelope', () => {
    expect(parseCardKingdomFeed(null)).toStartWith('Invalid Card Kingdom feed')
    expect(parseCardKingdomFeed({ data: [] })).toBe(
      'Invalid Card Kingdom feed: missing meta object',
    )
    expect(parseCardKingdomFeed({ meta: {} })).toBe('Invalid Card Kingdom feed: missing data array')
  })

  test('rejects a feed with no readable products', () => {
    expect(parseCardKingdomFeed(rawFeed([]))).toBe(
      'Invalid Card Kingdom feed: no readable products',
    )
  })

  test('skips malformed rows with a warning instead of failing the feed', () => {
    const parsed = parseCardKingdomFeed(
      rawFeed([rawProduct(), rawProduct({ id: 'nope' }), rawProduct({ price_buy: 'abc' })]),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.feed.products).toHaveLength(1)
    expect(parsed.warnings).toHaveLength(2)
    expect(parsed.warnings[0]).toContain('data[1]')
    expect(parsed.warnings[1]).toContain('data[2]')
  })

  test('collapses row warnings past the cap into a count', () => {
    const rows = [rawProduct(), ...Array.from({ length: 12 }, () => rawProduct({ id: 'nope' }))]
    const parsed = parseCardKingdomFeed(rawFeed(rows))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.warnings).toHaveLength(11)
    expect(parsed.warnings[10]).toBe('Skipped 2 more malformed Card Kingdom products')
  })

  test('missing scryfall_id and null variation degrade to empty strings', () => {
    const parsed = parseCardKingdomFeed(
      rawFeed([rawProduct({ scryfall_id: undefined, variation: null })]),
    )
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.feed.products[0]?.scryfallId).toBe('')
    expect(parsed.feed.products[0]?.variation).toBe('')
  })
})

describe('productFinish', () => {
  test('splits nonfoil / foil / etched', () => {
    expect(productFinish(false, '')).toBe('nonfoil')
    expect(productFinish(true, '')).toBe('foil')
    expect(productFinish(true, 'Foil Etched')).toBe('etched')
    expect(productFinish(true, '0001 - Foil Etched')).toBe('etched')
    // An "Etched" note on a nonfoil product is not a finish claim.
    expect(productFinish(false, 'Foil Etched')).toBe('nonfoil')
  })
})

describe('normalizeCollectorNumber', () => {
  test('strips leading zeros and lowercases', () => {
    expect(normalizeCollectorNumber('0136')).toBe('136')
    expect(normalizeCollectorNumber('0002A')).toBe('2a')
    expect(normalizeCollectorNumber('0')).toBe('0')
    expect(normalizeCollectorNumber('161')).toBe('161')
  })
})

describe('parseSkuPrinting', () => {
  test('reads set and collector from a base sku', () => {
    expect(parseSkuPrinting('DSK-0136', 'nonfoil')).toEqual({ set: 'dsk', collectorNumber: '0136' })
  })

  test('strips one F prefix for foil products, even on F-initial set codes', () => {
    expect(parseSkuPrinting('FDSK-0374', 'foil')).toEqual({ set: 'dsk', collectorNumber: '0374' })
    expect(parseSkuPrinting('FFDN-0294', 'foil')).toEqual({ set: 'fdn', collectorNumber: '0294' })
    // Nonfoil Foundations keeps its own F.
    expect(parseSkuPrinting('FDN-0294', 'nonfoil')).toEqual({ set: 'fdn', collectorNumber: '0294' })
  })

  test('rejects skus without a separator or with nothing left after F-stripping', () => {
    expect(parseSkuPrinting('NODASH', 'nonfoil')).toBeNull()
    expect(parseSkuPrinting('-0001', 'nonfoil')).toBeNull()
    expect(parseSkuPrinting('TST-', 'nonfoil')).toBeNull()
    expect(parseSkuPrinting('F-0001', 'foil')).toBeNull()
  })
})

describe('buildCardKingdomIndex', () => {
  const nonfoil = product({ id: 1, sku: 'FDN-0294', scryfallId: 'sf-a' })
  const foil = product({ id: 2, sku: 'FFDN-0294', scryfallId: 'sf-a', finish: 'foil' })
  const unlinked = product({ id: 3, sku: 'HBT-0001', scryfallId: '', name: 'Bilbo, Guest' })
  const dfc = product({
    id: 4,
    sku: 'MOM-0012',
    scryfallId: 'sf-b',
    name: 'Elesh Norn // The Argent Etchings',
  })
  const index = buildCardKingdomIndex([nonfoil, foil, unlinked, dfc])

  test('groups products by scryfall id across finishes', () => {
    expect(index.byScryfallId.get('sf-a')).toEqual([nonfoil, foil])
    expect(index.byScryfallId.has('')).toBe(false)
  })

  test('finds products by sku printing at the right finish', () => {
    expect(lookupSkuPrinting(index, 'fdn', '294', 'nonfoil')).toEqual([nonfoil])
    expect(lookupSkuPrinting(index, 'FDN', '0294', 'foil')).toEqual([foil])
    expect(lookupSkuPrinting(index, 'hbt', '1', 'nonfoil')).toEqual([unlinked])
    expect(lookupSkuPrinting(index, 'fdn', '294', 'etched')).toEqual([])
  })

  test('indexes full names and front faces', () => {
    expect(index.byName.get('bilbo, guest')).toEqual([unlinked])
    expect(index.byName.get('elesh norn // the argent etchings')).toEqual([dfc])
    expect(index.byName.get('elesh norn')).toEqual([dfc])
  })
})

describe('productUrl', () => {
  test('joins the base url and product path, defaulting a missing base', () => {
    expect(productUrl({ baseUrl: 'https://www.cardkingdom.com/' }, product())).toBe(
      'https://www.cardkingdom.com/mtg/test-set/test-card',
    )
    // No trailing slash on the base, leading slash on the path: still one '/'.
    expect(productUrl({ baseUrl: 'https://ck.example' }, product({ url: '/mtg/x' }))).toBe(
      'https://ck.example/mtg/x',
    )
    expect(productUrl({ baseUrl: '' }, product())).toBe(
      'https://www.cardkingdom.com/mtg/test-set/test-card',
    )
    expect(productUrl({ baseUrl: '' }, product({ url: '' }))).toBeUndefined()
  })
})
