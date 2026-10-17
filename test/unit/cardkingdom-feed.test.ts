import { describe, expect, test } from 'bun:test'
import {
  buildCardKingdomIndex,
  lookupSkuPrinting,
  normalizeCollectorNumber,
  parseCardKingdomFeed,
  parseSkuPrinting,
  productFinish,
  productUrl,
  type ParsedCardKingdomFeed,
} from '../../src/cardkingdom'
import {
  isRenderable,
  isSyncMessage,
  nestSync,
  renderSyncMessage,
  type SyncMessage,
} from '../../src/sync/message'
import { MAX_ROW_WARNINGS } from '../../src/cardkingdom/feed'
import { keyedMessage } from '../helpers/api-message'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocale } from '../helpers/sync-text'
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

/** The parsed feed, after asserting the parser accepted it. */
function parsedFeed(json: unknown): ParsedCardKingdomFeed {
  const parsed = parseCardKingdomFeed(json)
  if (isSyncMessage(parsed)) throw new Error(parsed.message)
  return parsed
}

/** The parser's refusal, after asserting it refused and that its English agrees with its key. */
function feedRefusal(json: unknown): SyncMessage {
  const parsed = parseCardKingdomFeed(json)
  if (!isSyncMessage(parsed)) throw new Error('expected the feed to be refused')
  keyedMessage(parsed)
  return parsed
}

describe('parseCardKingdomFeed', () => {
  test('parses a well-formed feed, decoding string bools and prices', () => {
    const parsed = parsedFeed(rawFeed([rawProduct()]))
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
        qtyRetail: 3,
        priceBuy: 0.5,
        qtyBuying: 10,
      },
    ])
  })

  test('rejects a payload without the meta/data envelope, keyed', () => {
    expect(feedRefusal(null).messageKey).toBe('domain.cache.cardKingdom.feed.notObject')
    expect(feedRefusal({ data: [] })).toEqual({
      message: 'Invalid Card Kingdom feed: missing meta object',
      messageKey: 'domain.cache.cardKingdom.feed.noMeta',
    })
    expect(feedRefusal({ meta: {} })).toEqual({
      message: 'Invalid Card Kingdom feed: missing data array',
      messageKey: 'domain.cache.cardKingdom.feed.noData',
    })
  })

  test('rejects a feed with no readable products', () => {
    expect(feedRefusal(rawFeed([])).message).toBe('Invalid Card Kingdom feed: no readable products')
  })

  test('skips malformed rows with a warning that nests the row’s reason', () => {
    const parsed = parsedFeed(
      rawFeed([rawProduct(), rawProduct({ id: 'nope' }), rawProduct({ price_buy: 'abc' })]),
    )
    expect(parsed.feed.products).toHaveLength(1)
    expect(parsed.warnings).toEqual([
      {
        message: 'Skipped Card Kingdom product data[1]: missing numeric id',
        messageKey: 'domain.cache.cardKingdom.feed.productSkipped',
        messageParams: {
          index: 1,
          reason: { messageKey: 'domain.cache.cardKingdom.product.noId' },
        },
      },
      {
        message: "Skipped Card Kingdom product data[2]: unreadable price_buy 'abc'",
        messageKey: 'domain.cache.cardKingdom.feed.productSkipped',
        messageParams: {
          index: 2,
          reason: {
            messageKey: 'domain.cache.cardKingdom.product.unreadable',
            messageParams: { field: 'price_buy', value: 'abc' },
          },
        },
      },
    ])
  })

  /**
   * One malformed row per reason the parser can give — the code → key mapping
   * a translated warning depends on. Each warning must agree with its key in
   * English, render whole (no raw key, no unfilled `{token}`) in a locale where
   * every message changes, and actually change there.
   */
  const MALFORMED_ROWS: Record<string, unknown> = {
    'not an object': 'not a row',
    'missing numeric id': rawProduct({ id: '1' }),
    'missing string sku': rawProduct({ sku: 7 }),
    'missing card name': rawProduct({ name: '' }),
    'missing edition': rawProduct({ edition: undefined }),
    "unreadable is_foil 'maybe'": rawProduct({ is_foil: 'maybe' }),
    "unreadable price_retail 'x'": rawProduct({ price_retail: 'x' }),
    "unreadable qty_retail ''": rawProduct({ qty_retail: '' }),
    "unreadable price_buy 'null'": rawProduct({ price_buy: null }),
    "unreadable qty_buying 'Infinity'": rawProduct({ qty_buying: Infinity }),
  }

  test('every row reason is keyed and renders whole in another language', () => {
    const reasons = Object.keys(MALFORMED_ROWS)
    // Every row must be itemized for the comparison below to see its reason.
    expect(reasons.length).toBeLessThanOrEqual(MAX_ROW_WARNINGS)
    const parsed = parsedFeed(rawFeed([rawProduct(), ...Object.values(MALFORMED_ROWS)]))
    expect(parsed.warnings.map((warning) => keyedMessage(warning))).toEqual(
      reasons.map((reason, i) => `Skipped Card Kingdom product data[${i + 1}]: ${reason}`),
    )
    withSyntheticLocale('en-XA', pseudoCatalog(), (locale) => {
      expectLocaleInForce(locale)
      for (const warning of parsed.warnings) {
        const ref = nestSync(warning)
        if (typeof ref === 'string') throw new Error(`unkeyed warning: ${ref}`)
        expect(isRenderable(ref, locale)).toBe(true)
        expect(renderSyncMessage(warning, locale)).not.toBe(warning.message)
      }
    })
  })

  test('quotes an unreadable value as JSON, capped and on one line', () => {
    const parsed = parsedFeed(
      rawFeed([
        rawProduct(),
        rawProduct({ price_buy: { usd: 1 } }),
        rawProduct({ price_buy: `${'9'.repeat(100)}x` }),
        rawProduct({ price_buy: 'a\nb' }),
        rawProduct({ price_buy: '   ' }),
      ]),
    )
    expect(parsed.warnings.map((warning) => warning.messageParams?.['reason'])).toEqual([
      {
        messageKey: 'domain.cache.cardKingdom.product.unreadable',
        messageParams: { field: 'price_buy', value: '{"usd":1}' },
      },
      {
        messageKey: 'domain.cache.cardKingdom.product.unreadable',
        messageParams: { field: 'price_buy', value: `${'9'.repeat(80)}…` },
      },
      {
        messageKey: 'domain.cache.cardKingdom.product.unreadable',
        messageParams: { field: 'price_buy', value: 'a b' },
      },
      {
        messageKey: 'domain.cache.cardKingdom.product.unreadable',
        messageParams: { field: 'price_buy', value: '   ' },
      },
    ])
  })

  test('a feed whose every row is malformed is refused', () => {
    expect(feedRefusal(rawFeed([rawProduct({ id: 'x' }), 'not a row'])).messageKey).toBe(
      'domain.cache.cardKingdom.feed.noProducts',
    )
  })

  test('collapses row warnings past the cap into a count', () => {
    const rows = [rawProduct(), ...Array.from({ length: 12 }, () => rawProduct({ id: 'nope' }))]
    const parsed = parsedFeed(rawFeed(rows))
    expect(parsed.warnings).toHaveLength(11)
    expect(parsed.warnings[10]).toEqual({
      message: 'Skipped 2 more malformed Card Kingdom products',
      messageKey: 'domain.cache.cardKingdom.feed.moreSkipped',
      messageParams: { count: 2 },
    })
  })

  test('missing scryfall_id and null variation degrade to empty strings', () => {
    const parsed = parsedFeed(rawFeed([rawProduct({ scryfall_id: undefined, variation: null })]))
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
