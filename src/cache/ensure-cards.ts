import { cardCache } from './index'
import { refreshCardCache } from './refresh-source'
import { getLogger } from '../util/logger'
import { t } from '../i18n/t'
import { BULK_CACHE_MAX_AGE_MS, BULK_FETCH_THRESHOLD } from './constants'
import { firstDownloadNotes } from './download-notes'
import type { BulkRefreshPrompt } from './refresh'
import { flagValue, FLAG } from '../util/cli-tokens'
import type { CacheManager } from '../util/interfaces'
import type { ScryfallCard } from '../scryfall/types'

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
  /**
   * Ask before downloading (`--refresh ask`): the download happens only when
   * this answers yes. Absent, a needed download simply runs (`--refresh auto`,
   * and the admin server's card loaders).
   */
  confirm?: (prompt: BulkRefreshPrompt) => Promise<boolean>
}

/** Why a bulk download is due: never downloaded, over a week old, or too many cards missing. */
type BulkRefreshReason = 'never' | 'stale' | 'missing'

/** The progress line a download that runs without asking announces itself with. */
function refreshingLine(reason: BulkRefreshReason): string {
  switch (reason) {
    case 'never':
      return t('cli.cacheStore.bulkNever')
    case 'stale':
      return t('cli.cacheStore.bulkWeekOld')
    case 'missing':
      return t('cli.cacheStore.manyMissing', { threshold: BULK_FETCH_THRESHOLD })
  }
}

/** The question a download that needs a yes asks. Defaults to yes: the build wants the data. */
function refreshPrompt(reason: BulkRefreshReason): BulkRefreshPrompt {
  switch (reason) {
    case 'never':
      return { message: t('cli.cacheStore.bulkNeverConfirm'), initial: true }
    case 'stale':
      return { message: t('cli.cacheStore.bulkWeekOldConfirm'), initial: true }
    case 'missing':
      return {
        message: t('cli.cacheStore.manyMissingConfirm', { threshold: BULK_FETCH_THRESHOLD }),
        initial: true,
      }
  }
}

/**
 * Whether a bulk download is due for these names, and why: the cache was never
 * bulk-downloaded or is over a week old, or more than
 * {@link BULK_FETCH_THRESHOLD} of them are missing from it.
 */
async function bulkRefreshReason(
  cache: CacheManager<ScryfallCard[]>,
  cardNames: Set<string>,
): Promise<BulkRefreshReason | null> {
  const lastBulkRefresh = await cache.getLastRefreshedAt?.()
  if (lastBulkRefresh == null) return 'never'
  if (Date.now() - lastBulkRefresh > BULK_CACHE_MAX_AGE_MS) return 'stale'

  let missingCount = 0
  for (const name of cardNames) {
    const cached = await cache.get(name)
    if (!cached || cached.length === 0) missingCount++
    // Short-circuit once we know we're over the threshold
    if (missingCount > BULK_FETCH_THRESHOLD) return 'missing'
  }
  return null
}

/**
 * Ensure the card cache is populated before loading a large number of cards.
 *
 * If the bulk cache is older than a week, or if more than {@link BULK_FETCH_THRESHOLD}
 * requested cards are missing from the cache, triggers a full Scryfall bulk data
 * download before returning — after asking, when `options.confirm` is given.
 * Concurrent calls share the same preload promise.
 *
 * When `options.allowBulk` is false (or the question is declined) the bulk
 * download is suppressed; callers fall back to fetching whatever they need
 * per-card.
 */
export async function ensureCacheForCards(
  cardNames: Set<string>,
  deps?: EnsureCacheDeps,
  options?: EnsureCacheOptions,
): Promise<EnsureCacheResult> {
  const cache = deps?.cache ?? cardCache
  const preload = deps?.preload ?? refreshCardCache

  if (options?.allowBulk === false) return { refreshed: false }

  const reason = await bulkRefreshReason(cache, cardNames)
  if (reason === null) return { refreshed: false }

  if (options?.confirm) {
    // Where a first download lands and how big it is, before the question.
    if (reason === 'never') for (const line of firstDownloadNotes()) getLogger().info(line)
    if (!(await options.confirm(refreshPrompt(reason)))) {
      getLogger().info(t('cli.cacheStore.bulkSkipped', { flag: flagValue(FLAG.refresh, 'auto') }))
      return { refreshed: false }
    }
  } else {
    getLogger().info(refreshingLine(reason))
  }
  await runPreload(preload)
  return { refreshed: true }
}

async function runPreload(preload: () => Promise<void>): Promise<void> {
  if (!preloadInProgress) {
    preloadInProgress = preload().finally(() => {
      preloadInProgress = null
    })
  }
  await preloadInProgress
}
