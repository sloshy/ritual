import { cardCache } from './index'
import { refreshCardCache } from './refresh-source'
import { getLogger } from '../logger'
import { BULK_CACHE_MAX_AGE_MS, BULK_FETCH_THRESHOLD } from './constants'
import type { CacheManager } from '../interfaces'
import type { ScryfallCard } from '../types'

let preloadInProgress: Promise<void> | null = null

export type EnsureCacheResult = {
  /** Whether a bulk cache refresh was triggered */
  refreshed: boolean
}

export type EnsureCacheDeps = {
  cache: CacheManager<ScryfallCard[]>
  preload: () => Promise<void>
}

export type EnsureCacheOptions = {
  /** When false, never trigger a bulk download (e.g. `--refresh no-bulk`/`--refresh never`). */
  allowBulk?: boolean
}

/**
 * Ensure the card cache is populated before loading a large number of cards.
 *
 * If the bulk cache is older than a week, or if more than {@link BULK_FETCH_THRESHOLD}
 * requested cards are missing from the cache, triggers a full Scryfall bulk data
 * download before returning. Concurrent calls share the same preload promise.
 *
 * When `options.allowBulk` is false the bulk download is suppressed entirely;
 * callers fall back to fetching whatever they need per-card.
 */
export async function ensureCacheForCards(
  cardNames: Set<string>,
  deps?: EnsureCacheDeps,
  options?: EnsureCacheOptions,
): Promise<EnsureCacheResult> {
  const cache = deps?.cache ?? cardCache
  const preload = deps?.preload ?? refreshCardCache

  if (options?.allowBulk === false) return { refreshed: false }

  // Check bulk cache age first — if stale, always refresh
  const lastBulkRefresh = await cache.getLastRefreshedAt?.()
  if (lastBulkRefresh == null || Date.now() - lastBulkRefresh > BULK_CACHE_MAX_AGE_MS) {
    getLogger().info(
      lastBulkRefresh != null
        ? 'Card cache bulk download is more than a week old. Refreshing...'
        : 'Card cache has never been bulk-downloaded. Downloading from Scryfall...',
    )
    await runPreload(preload)
    return { refreshed: true }
  }

  // Count how many requested cards are missing from the cache
  let missingCount = 0
  for (const name of cardNames) {
    const cached = await cache.get(name)
    if (!cached || cached.length === 0) {
      missingCount++
    }
    // Short-circuit once we know we're over the threshold
    if (missingCount > BULK_FETCH_THRESHOLD) break
  }

  if (missingCount > BULK_FETCH_THRESHOLD) {
    getLogger().info(
      `Over ${BULK_FETCH_THRESHOLD} cards not found in cache. Triggering bulk cache refresh...`,
    )
    await runPreload(preload)
    return { refreshed: true }
  }

  return { refreshed: false }
}

async function runPreload(preload: () => Promise<void>): Promise<void> {
  if (!preloadInProgress) {
    preloadInProgress = preload().finally(() => {
      preloadInProgress = null
    })
  }
  await preloadInProgress
}
