import type { Finish } from '../types'

/**
 * Card Kingdom's public bulk pricelist feed (`api.cardkingdom.com/api/v2/pricelist`),
 * trimmed to the fields the sell report uses. Full research notes, including
 * verified field semantics and join-key coverage statistics, live in
 * `research/cardkingdom-buylist-api.md`.
 */

/** One MTG single from Card Kingdom's pricelist feed. */
export interface CardKingdomProduct {
  /** Card Kingdom's product id. */
  id: number
  /** CK sku, e.g. `DSK-0136` or `FFDN-0294` (variant letters prefix the set code). */
  sku: string
  /** Scryfall card UUID CK links this product to; empty when CK has none. */
  scryfallId: string
  /** Product page path relative to the feed's base URL. */
  url: string
  name: string
  /** CK's variant note, e.g. `0294 - Borderless` or `Foil Etched`; empty when none. */
  variation: string
  /** CK's edition display name, e.g. `Foundations Variants`. */
  edition: string
  finish: Finish
  /** CK's retail (sell-to-you) price in USD, for reference. */
  priceRetail: number
  /** CK's buylist cash quote in USD for a Near Mint copy. */
  priceBuy: number
  /** Copies CK is currently buying; 0 means not buying regardless of price. */
  qtyBuying: number
}

/** The parsed pricelist feed. */
export interface CardKingdomFeed {
  /** CK's feed generation stamp, verbatim (e.g. `2026-08-04 06:06:09`). */
  createdAt: string
  /** Base URL product `url` paths are relative to. */
  baseUrl: string
  products: CardKingdomProduct[]
}

/** A successfully parsed feed plus warnings for any rows that were skipped. */
export type ParsedCardKingdomFeed = {
  feed: CardKingdomFeed
  warnings: string[]
}

/** How many per-row warnings are itemized before collapsing into a count. */
const MAX_ROW_WARNINGS = 10

/**
 * Derive the Ritual finish of a CK product. Etched printings are separate
 * products flagged foil with an "Etched" variation (`Foil Etched`); everything
 * else splits on the foil flag.
 */
export function productFinish(isFoil: boolean, variation: string): Finish {
  if (isFoil && /etched/i.test(variation)) return 'etched'
  return isFoil ? 'foil' : 'nonfoil'
}

/** Parse CK's string-encoded booleans (`"true"` / `"false"`). */
function parseFeedBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/** Parse CK's string-encoded prices (`"785.00"`). */
function parseFeedNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** A field that CK sometimes omits or nulls; absent means empty. */
function optionalString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseFeedProduct(entry: unknown): CardKingdomProduct | string {
  if (!entry || typeof entry !== 'object') return 'not an object'
  const raw = entry as Record<string, unknown>

  if (typeof raw['id'] !== 'number') return 'missing numeric id'
  if (typeof raw['sku'] !== 'string') return 'missing string sku'
  if (typeof raw['name'] !== 'string' || raw['name'] === '') return 'missing card name'
  if (typeof raw['edition'] !== 'string' || raw['edition'] === '') return 'missing edition'

  const isFoil = parseFeedBoolean(raw['is_foil'])
  if (isFoil === null) return `unreadable is_foil '${String(raw['is_foil'])}'`
  const priceRetail = parseFeedNumber(raw['price_retail'])
  if (priceRetail === null) return `unreadable price_retail '${String(raw['price_retail'])}'`
  const priceBuy = parseFeedNumber(raw['price_buy'])
  if (priceBuy === null) return `unreadable price_buy '${String(raw['price_buy'])}'`
  const qtyBuying = parseFeedNumber(raw['qty_buying'])
  if (qtyBuying === null) return `unreadable qty_buying '${String(raw['qty_buying'])}'`

  const variation = optionalString(raw['variation'])
  return {
    id: raw['id'],
    sku: raw['sku'],
    scryfallId: optionalString(raw['scryfall_id']),
    url: optionalString(raw['url']),
    name: raw['name'],
    variation,
    edition: raw['edition'],
    finish: productFinish(isFoil, variation),
    priceRetail,
    priceBuy,
    qtyBuying,
  }
}

/**
 * Validate and parse a raw pricelist payload. Returns an error string (never
 * throws) when the envelope is not the expected `{ meta, data }` shape, per the
 * parser conventions in AGENTS.md. Individual malformed rows are skipped and
 * reported as warnings rather than failing the whole feed — one bad row in a
 * 150k-product vendor feed must not make the buylist unusable.
 */
export function parseCardKingdomFeed(json: unknown): ParsedCardKingdomFeed | string {
  if (!json || typeof json !== 'object') {
    return 'Invalid Card Kingdom feed: expected a JSON object'
  }
  const raw = json as Record<string, unknown>
  const meta = raw['meta']
  if (!meta || typeof meta !== 'object') {
    return 'Invalid Card Kingdom feed: missing meta object'
  }
  const metaRaw = meta as Record<string, unknown>
  const data = raw['data']
  if (!Array.isArray(data)) {
    return 'Invalid Card Kingdom feed: missing data array'
  }

  const products: CardKingdomProduct[] = []
  const warnings: string[] = []
  let skipped = 0
  for (let i = 0; i < data.length; i++) {
    const product = parseFeedProduct(data[i])
    if (typeof product === 'string') {
      skipped++
      if (warnings.length < MAX_ROW_WARNINGS) {
        warnings.push(`Skipped Card Kingdom product data[${i}]: ${product}`)
      }
      continue
    }
    products.push(product)
  }
  if (skipped > warnings.length) {
    warnings.push(`Skipped ${skipped - warnings.length} more malformed Card Kingdom products`)
  }
  if (products.length === 0) {
    return 'Invalid Card Kingdom feed: no readable products'
  }

  return {
    feed: {
      createdAt: optionalString(metaRaw['created_at']),
      baseUrl: optionalString(metaRaw['base_url']),
      products,
    },
    warnings,
  }
}

/**
 * Collector numbers identify a printing rather than being display text: CK pads
 * with leading zeros (`0136`) where Scryfall does not (`136`), and letter
 * suffixes vary in case. Compare them lowercased with leading zeros stripped.
 */
export function normalizeCollectorNumber(collectorNumber: string): string {
  return collectorNumber.toLowerCase().replace(/^0+(?=.)/, '')
}

/** Lookup key for the sku-derived printing index: set (lowercase) + collector + finish. */
function skuPrintingKey(set: string, collectorNumber: string, finish: Finish): string {
  return `${set.toLowerCase()}:${normalizeCollectorNumber(collectorNumber)}:${finish}`
}

/** A printing reference read out of a CK sku (set lowercase). */
export type SkuPrinting = { set: string; collectorNumber: string }

/**
 * Best-effort printing read of a CK sku. Base skus are
 * `<SETCODE>-<collector>` with variant letters prefixed (`F` foil, `P` promo,
 * `MF` mana foil, ...). Only the plain and single-`F` foil forms are trusted:
 * for a foil product a single leading `F` is stripped, and anything else is
 * left as-is. Returns null for skus without a `-` separator.
 */
export function parseSkuPrinting(sku: string, finish: Finish): SkuPrinting | null {
  const separator = sku.indexOf('-')
  if (separator <= 0 || separator === sku.length - 1) return null
  let prefix = sku.slice(0, separator)
  const collectorNumber = sku.slice(separator + 1)
  if (finish !== 'nonfoil' && (prefix.startsWith('F') || prefix.startsWith('f'))) {
    prefix = prefix.slice(1)
  }
  if (prefix === '') return null
  return { set: prefix.toLowerCase(), collectorNumber }
}

/**
 * Lookup structures over a parsed feed. `byScryfallId` is the primary join key
 * (99.5% product coverage); `bySkuPrinting` and `byName` are fallbacks for the
 * remainder (brand-new sets, promos) and for entries the card cache cannot
 * resolve.
 */
export interface CardKingdomIndex {
  byScryfallId: Map<string, CardKingdomProduct[]>
  /** Keyed by `set:collector:finish` parsed from the sku (lowercase set, zeros stripped). */
  bySkuPrinting: Map<string, CardKingdomProduct[]>
  /** Keyed by lowercased card name — the full CK name and its front face. */
  byName: Map<string, CardKingdomProduct[]>
}

function push<K>(map: Map<K, CardKingdomProduct[]>, key: K, product: CardKingdomProduct): void {
  const existing = map.get(key)
  if (existing) existing.push(product)
  else map.set(key, [product])
}

/** Build the {@link CardKingdomIndex} lookup maps over a feed's products. */
export function buildCardKingdomIndex(products: CardKingdomProduct[]): CardKingdomIndex {
  const byScryfallId = new Map<string, CardKingdomProduct[]>()
  const bySkuPrinting = new Map<string, CardKingdomProduct[]>()
  const byName = new Map<string, CardKingdomProduct[]>()

  for (const product of products) {
    if (product.scryfallId !== '') {
      push(byScryfallId, product.scryfallId, product)
    }
    const printing = parseSkuPrinting(product.sku, product.finish)
    if (printing) {
      push(
        bySkuPrinting,
        skuPrintingKey(printing.set, printing.collectorNumber, product.finish),
        product,
      )
    }
    const fullName = product.name.toLowerCase()
    push(byName, fullName, product)
    const frontFace = fullName.split(' // ')[0]
    if (frontFace !== undefined && frontFace !== fullName) {
      push(byName, frontFace, product)
    }
  }

  return { byScryfallId, bySkuPrinting, byName }
}

/** Look up feed products by a printing's set + collector number + finish. */
export function lookupSkuPrinting(
  index: CardKingdomIndex,
  set: string,
  collectorNumber: string,
  finish: Finish,
): CardKingdomProduct[] {
  return index.bySkuPrinting.get(skuPrintingKey(set, collectorNumber, finish)) ?? []
}

/** The absolute product page URL for a feed product, when the feed carries one. */
export function productUrl(
  feed: Pick<CardKingdomFeed, 'baseUrl'>,
  product: CardKingdomProduct,
): string | undefined {
  if (product.url === '') return undefined
  const base = feed.baseUrl === '' ? 'https://www.cardkingdom.com/' : feed.baseUrl
  return `${base.endsWith('/') ? base : `${base}/`}${product.url.replace(/^\//, '')}`
}
