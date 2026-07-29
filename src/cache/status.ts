// Imported from the leaf modules rather than the `./index` barrel: the barrel
// rides the index.ts → ensure-cards → scryfall import cycle, where these
// bindings would still be in their temporal dead zone (same idiom as
// refresh-source.ts).
import { cardCache } from './instances'
import { PRICE_MAX_AGE_MS } from './constants'
import { getConfiguredCacheServerAddress } from './config'

/**
 * The card cache's diagnostic report, collected once and rendered by whoever
 * asked: `ritual cache status` prints it, `GET /api/cache/status` returns it.
 * Kept out of `src/commands/` so a route handler can reach it without pulling in
 * commander and the CLI's subcommand registration.
 */

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
}

const ONE_HOUR_MS = 60 * 60 * 1000
const TAG_SAMPLE_SIZE = 25

/**
 * Whether any cached card carries `oracleTags`/`artTags`, checked via `get()`
 * over a bounded sample of at most {@link TAG_SAMPLE_SIZE} keys. Deliberately
 * never `values()`: with `--cache-server` active that would pull the entire
 * cache over HTTP for a yes/no answer.
 */
async function sampleTagsPresent(keys: string[]): Promise<boolean> {
  for (const key of keys.slice(0, TAG_SAMPLE_SIZE)) {
    const printings = await cardCache.get(key)
    if (!printings) continue
    const tagged = printings.some(
      (card) => (card.oracleTags?.length ?? 0) > 0 || (card.artTags?.length ?? 0) > 0,
    )
    if (tagged) return true
  }
  return false
}

/** Collect the card cache's current state. Read-only: nothing here refreshes or writes. */
export async function collectCacheStatus(): Promise<CacheStatusResult> {
  const empty = await cardCache.isEmpty()
  const keys = await cardCache.keys()
  const lastRefreshedAt = await cardCache.getLastRefreshedAt()
  const priceAgeMs = lastRefreshedAt === null ? null : Date.now() - lastRefreshedAt

  return {
    empty,
    cardCount: keys.length,
    lastCardRefresh: lastRefreshedAt === null ? null : new Date(lastRefreshedAt).toISOString(),
    priceAgeHours: priceAgeMs === null ? null : Math.floor(priceAgeMs / ONE_HOUR_MS),
    priceStale: priceAgeMs === null || priceAgeMs > PRICE_MAX_AGE_MS,
    tagsPresent: await sampleTagsPresent(keys),
    source: getConfiguredCacheServerAddress() ? 'cache-server' : 'local',
  }
}
