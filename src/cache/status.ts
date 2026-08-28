// Imported from the leaf modules rather than the `./index` barrel: the barrel
// rides the index.ts → ensure-cards → scryfall import cycle, where these
// bindings would still be in their temporal dead zone (same idiom as
// refresh-source.ts).
import { cardCache } from './instances'
import { PRICE_MAX_AGE_MS } from './constants'
import { getConfiguredCacheServerAddress } from './config'
import { readRecordedCardBulkType } from './bulk-provenance'
import { configuredCardBulkType, type CardBulkType } from '../scryfall/bulk-manifest'
import { getDefaultLanguage } from '../config/ritual-config'
import type { CardLanguage } from '../card/card-language'
import type { ScryfallCard } from '../scryfall/types'

/**
 * The card cache's diagnostic report, collected once and rendered by whoever
 * asked: `ritual cache status` prints it, `GET /api/cache/status` returns it.
 * Kept out of `src/commands/` so a route handler can reach it without pulling in
 * commander and the CLI's subcommand registration.
 */

/**
 * How to fix an empty card cache, phrased for every surface at once.
 *
 * An MCP agent cannot run a CLI command and a CLI user has no `refresh_cache`
 * tool, so naming both beats projecting per client. Composed into each route's
 * own sentence (which says what the empty cache cost *that* caller) rather than
 * being the whole message. Ends without punctuation so a caller can continue it.
 */
export const CACHE_REFRESH_REMEDY =
  'Refresh it first (MCP: the refresh_cache tool; CLI: `ritual cache preload-all`)'

/** Where card data is being read from: the on-disk cache or a configured cache server. */
export type CacheSource = 'local' | 'cache-server'

/** The `cache status` report. Diagnostic only — collecting it never mutates the cache. */
export type CacheStatusResult = {
  /** Whether the card cache holds no cards at all. */
  empty: boolean
  /** Distinct card **names** cached — each name's value is its array of printings. */
  cardCount: number
  /**
   * ISO-8601 time of the last bulk refresh, or null until one has run — only a
   * bulk load stamps the timestamp, so per-set/per-card lookups leave it null.
   */
  lastCardRefresh: string | null
  /** Whole hours since the last bulk refresh (prices ride in the bulk data), or null. */
  priceAgeHours: number | null
  /** True when prices are older than the 24h freshness convention, or their age is unknown. */
  priceStale: boolean
  /** Whether any sampled cached card carries oracle/art tags (bounded sample, not a scan). */
  tagsPresent: boolean
  source: CacheSource
  /** The configured `defaultLanguage` — what decides which Scryfall bulk backs the cache. */
  defaultLanguage: CardLanguage
  /**
   * Which bulk built the card cache (`default_cards` English-only, `all_cards`
   * every language), or null when no bulk ingest has recorded provenance —
   * an empty cache, or one filled before provenance existed (necessarily
   * `default_cards`).
   */
  cardBulkType: CardBulkType | null
  /**
   * True when a non-empty cache's bulk (unrecorded reads as `default_cards`)
   * disagrees with what `defaultLanguage` demands — the cache needs a full
   * refresh, which the freshness gates offer.
   */
  bulkTypeStale: boolean
}

const ONE_HOUR_MS = 60 * 60 * 1000
const TAG_SAMPLE_SIZE = 25

/**
 * Whether any cached card carries `oracleTags`/`artTags`, checked via `get()`
 * over a bounded sample of at most {@link TAG_SAMPLE_SIZE} of the given names.
 * Deliberately never `values()`: with `--cache-server` active that would pull
 * the entire cache over HTTP for a yes/no answer.
 *
 * Also the live server's tag-gate check, where the names sampled are the site's
 * cards rather than the whole cache.
 */
export async function sampleTagsPresent(keys: readonly string[]): Promise<boolean> {
  for (const key of keys.slice(0, TAG_SAMPLE_SIZE)) {
    if ((await cardCache.get(key))?.some(cardHasTags)) return true
  }
  return false
}

/** Whether a card carries any oracle or art tag. */
export function cardHasTags(card: ScryfallCard): boolean {
  return (card.oracleTags?.length ?? 0) > 0 || (card.artTags?.length ?? 0) > 0
}

/** Collect the card cache's current state. Read-only: nothing here refreshes or writes. */
export async function collectCacheStatus(): Promise<CacheStatusResult> {
  const empty = await cardCache.isEmpty()
  const keys = await cardCache.keys()
  const lastRefreshedAt = await cardCache.getLastRefreshedAt()
  // Clamped: a stamp written a hair ahead of this clock (or a clock nudged
  // backwards) would otherwise report a negative age.
  const priceAgeMs = lastRefreshedAt === null ? null : Math.max(0, Date.now() - lastRefreshedAt)
  const cardBulkType = await readRecordedCardBulkType()

  return {
    empty,
    cardCount: keys.length,
    lastCardRefresh: lastRefreshedAt === null ? null : new Date(lastRefreshedAt).toISOString(),
    priceAgeHours: priceAgeMs === null ? null : Math.floor(priceAgeMs / ONE_HOUR_MS),
    priceStale: priceAgeMs === null || priceAgeMs > PRICE_MAX_AGE_MS,
    tagsPresent: await sampleTagsPresent(keys),
    source: getConfiguredCacheServerAddress() ? 'cache-server' : 'local',
    defaultLanguage: getDefaultLanguage(),
    cardBulkType,
    bulkTypeStale: !empty && (cardBulkType ?? 'default_cards') !== configuredCardBulkType(),
  }
}
