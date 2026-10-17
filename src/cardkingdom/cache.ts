import path from 'node:path'
import { getCacheDir } from '../cache/file-cache'
import { writeFileAtomic } from '../util/atomic-write'
import { isFinish } from '../card/finish-condition'
import { createDefaultFileSystemClient, type FileSystemClient } from '../util/interfaces'
import { hasErrorCode } from '../util/errors'
import { getLogger } from '../util/logger'
import { t } from '../i18n/t'
import { isRecord } from '../util/json'
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

/**
 * A successfully parsed cache file plus warnings for any rows that were
 * dropped, worded in the active locale: they only ever reach the console (a
 * cache that cannot be read is treated as missing, which every surface reports
 * in its own words).
 */
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
  qtyRetail: isNumber,
  priceBuy: isNumber,
  qtyBuying: isNumber,
}

/** Validate one persisted (already-trimmed) product row. */
function isCachedProduct(value: unknown): value is CardKingdomProduct {
  if (!isRecord(value)) return false
  return Object.entries(PRODUCT_FIELD_CHECKS).every(([key, check]) => check(value[key]))
}

/**
 * Validate and parse a persisted {@link CardKingdomCacheFile}. Returns an error
 * string (never throws, worded in the active locale — it is only ever logged)
 * when the envelope is wrong, per the parser conventions
 * in AGENTS.md; malformed product rows are dropped with a warning so a
 * hand-damaged cache degrades instead of crashing deeper in the report.
 */
export function parseCardKingdomCacheFile(json: unknown): ParsedCardKingdomCacheFile | string {
  if (!isRecord(json)) return t('cli.cardKingdom.cacheInvalid.notObject')
  const raw = json
  if (typeof raw['retrievedAt'] !== 'number') {
    return t('cli.cardKingdom.cacheInvalid.noRetrievedAt')
  }
  const feed = raw['feed']
  if (!isRecord(feed)) return t('cli.cardKingdom.cacheInvalid.noFeed')
  const feedRaw = feed
  if (typeof feedRaw['createdAt'] !== 'string') {
    return t('cli.cardKingdom.cacheInvalid.noCreatedAt')
  }
  if (typeof feedRaw['baseUrl'] !== 'string') {
    return t('cli.cardKingdom.cacheInvalid.noBaseUrl')
  }
  const rows = feedRaw['products']
  if (!Array.isArray(rows)) {
    return t('cli.cardKingdom.cacheInvalid.noProductList')
  }

  const products: CardKingdomProduct[] = []
  let dropped = 0
  for (const row of rows) {
    if (isCachedProduct(row)) products.push(row)
    else dropped++
  }
  if (products.length === 0) {
    return t('cli.cardKingdom.cacheInvalid.noProducts')
  }

  const warnings = dropped > 0 ? [t('cli.cardKingdom.cacheDropped', { count: dropped })] : []
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
    getLogger().warn(t('cli.cardKingdom.cacheNotJson'))
    return null
  }
  const parsed = parseCardKingdomCacheFile(json)
  if (typeof parsed === 'string') {
    getLogger().warn(t('cli.cardKingdom.cacheIgnored', { reason: parsed }))
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
  await writeFileAtomic(getCardKingdomCachePath(), JSON.stringify(file), { fs })
}
