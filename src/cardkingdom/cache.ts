import path from 'node:path'
import { getCacheDir } from '../cache/file-cache'
import { writeFileAtomic } from '../cache/atomic-write'
import { isFinish } from '../finish-condition'
import { createDefaultFileSystemClient, type FileSystemClient } from '../interfaces'
import { hasErrorCode } from '../errors'
import { getLogger } from '../logger'
import type { CardKingdomFeed, CardKingdomProduct } from './feed'

/**
 * On-disk persistence for the Card Kingdom pricelist feed. The feed gets its
 * own file under the cache dir (the `tags.json` precedent) rather than a new
 * `cache.json` section: it is a third-party dataset with its own freshness
 * cadence, and `cache.json` is rewritten whole on every save.
 */

/** `cache/cardkingdom.json` under the current base dir. */
export function getCardKingdomCachePath(): string {
  return path.join(getCacheDir(), 'cardkingdom.json')
}

/** The persisted feed plus when Ritual downloaded it. */
export interface CardKingdomCacheFile {
  retrievedAt: number
  feed: CardKingdomFeed
}

/** A successfully parsed cache file plus warnings for any rows that were dropped. */
export type ParsedCardKingdomCacheFile = {
  file: CardKingdomCacheFile
  warnings: string[]
}

/**
 * One check per {@link CardKingdomProduct} field. Mapped over the interface's
 * own key set, so adding a field without a check is a compile error rather
 * than a validator that silently starts lying about cached rows.
 */
type ProductFieldChecks = { [K in keyof Required<CardKingdomProduct>]: (value: unknown) => boolean }

const isString = (value: unknown): boolean => typeof value === 'string'
const isNumber = (value: unknown): boolean => typeof value === 'number'

const PRODUCT_FIELD_CHECKS: ProductFieldChecks = {
  id: isNumber,
  sku: isString,
  scryfallId: isString,
  url: isString,
  name: isString,
  variation: isString,
  edition: isString,
  finish: (value) => typeof value === 'string' && isFinish(value),
  priceRetail: isNumber,
  priceBuy: isNumber,
  qtyBuying: isNumber,
}

/** Validate one persisted (already-trimmed) product row. */
function isCachedProduct(value: unknown): value is CardKingdomProduct {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return Object.entries(PRODUCT_FIELD_CHECKS).every(([key, check]) => check(raw[key]))
}

/**
 * Validate and parse a persisted {@link CardKingdomCacheFile}. Returns an error
 * string (never throws) when the envelope is wrong, per the parser conventions
 * in AGENTS.md; malformed product rows are dropped with a warning so a
 * hand-damaged cache degrades instead of crashing deeper in the report.
 */
export function parseCardKingdomCacheFile(json: unknown): ParsedCardKingdomCacheFile | string {
  if (!json || typeof json !== 'object') {
    return 'Invalid Card Kingdom cache: expected an object'
  }
  const raw = json as Record<string, unknown>
  if (typeof raw['retrievedAt'] !== 'number') {
    return 'Invalid Card Kingdom cache: missing numeric retrievedAt'
  }
  const feed = raw['feed']
  if (!feed || typeof feed !== 'object') {
    return 'Invalid Card Kingdom cache: missing feed object'
  }
  const feedRaw = feed as Record<string, unknown>
  if (typeof feedRaw['createdAt'] !== 'string') {
    return 'Invalid Card Kingdom cache: missing feed.createdAt'
  }
  if (typeof feedRaw['baseUrl'] !== 'string') {
    return 'Invalid Card Kingdom cache: missing feed.baseUrl'
  }
  const rows = feedRaw['products']
  if (!Array.isArray(rows)) {
    return 'Invalid Card Kingdom cache: missing products array'
  }

  const products: CardKingdomProduct[] = []
  let dropped = 0
  for (const row of rows) {
    if (isCachedProduct(row)) products.push(row)
    else dropped++
  }
  if (products.length === 0) {
    return 'Invalid Card Kingdom cache: no readable products'
  }

  const warnings =
    dropped > 0 ? [`Dropped ${dropped} malformed products from the Card Kingdom cache`] : []
  return {
    file: {
      retrievedAt: raw['retrievedAt'],
      feed: {
        createdAt: feedRaw['createdAt'],
        baseUrl: feedRaw['baseUrl'],
        products,
      },
    },
    warnings,
  }
}

/**
 * Load the cached feed, or null when it is absent. A cache that exists but
 * cannot be read is treated as missing (with a warning) — redownloading is the
 * remedy, not defensive recovery.
 */
export async function loadCardKingdomCache(
  fs: FileSystemClient = createDefaultFileSystemClient(),
): Promise<CardKingdomCacheFile | null> {
  let content: string
  try {
    content = await fs.readFile(getCardKingdomCachePath(), 'utf-8')
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT')) return null
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(content)
  } catch {
    getLogger().warn('Ignoring unreadable Card Kingdom cache (not valid JSON)')
    return null
  }
  const parsed = parseCardKingdomCacheFile(json)
  if (typeof parsed === 'string') {
    getLogger().warn(`Ignoring unreadable Card Kingdom cache: ${parsed}`)
    return null
  }
  for (const warning of parsed.warnings) getLogger().warn(warning)
  return parsed.file
}

/**
 * Persist the feed atomically. Compact JSON: at ~150k products the pretty
 * form roughly doubles a ~20 MB file for no reader benefit.
 */
export async function saveCardKingdomCache(
  file: CardKingdomCacheFile,
  fs: FileSystemClient = createDefaultFileSystemClient(),
): Promise<void> {
  await fs.mkdir(getCacheDir(), { recursive: true })
  await writeFileAtomic(fs, getCardKingdomCachePath(), JSON.stringify(file))
}
