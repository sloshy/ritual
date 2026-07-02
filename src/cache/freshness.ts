import { cardCache } from './index'
import { preloadCache } from '../scryfall'
import { BULK_CACHE_MAX_AGE_MS, PRICE_MAX_AGE_MS } from './constants'
import { shouldBulkRefresh, type BulkRefreshPrompt, type RefreshMode } from '../refresh'
import { formatDuration } from '../utils'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

type CacheFreshnessResult = {
  ready: boolean
  cardCount: number
}

/**
 * Prompt to redownload a bulk cache that is older than a week, preloading when
 * the prompt is accepted. Does nothing when the cache is younger than a week.
 */
async function promptStaleCacheRefresh(
  age: number,
  confirm: (prompt: BulkRefreshPrompt) => Promise<boolean>,
  preload: () => Promise<void>,
): Promise<void> {
  if (age <= BULK_CACHE_MAX_AGE_MS) return
  const days = Math.floor(age / ONE_DAY_MS)
  const accepted = await confirm({
    message: `Card cache is ${days} day${days !== 1 ? 's' : ''} old. Would you like to update it?`,
    initial: false,
  })
  if (accepted) await preload()
}

/**
 * Ensure the card cache exists and has been refreshed within the past 7 days.
 *
 * - If the cache is empty, prompts the user to run a preload.
 * - If the cache exists but is older than 7 days, prompts the user to update.
 * - If the cache is fresh, proceeds silently.
 *
 * @param mode How to answer the refresh confirmation. Defaults to `ask`
 *   (interactive); pass an explicit {@link RefreshMode} to answer it in
 *   non-interactive contexts (e.g. `bun run dev`, where the child can't read
 *   stdin). The cache here is populated only by bulk download, so `no-bulk`
 *   behaves like `none` (no preload).
 * @returns Whether the cache is ready for use (has cards) and how many cards are available.
 */
export async function ensureFreshCardCache(
  mode: RefreshMode = 'ask',
): Promise<CacheFreshnessResult> {
  const empty = await cardCache.isEmpty()

  if (empty) {
    console.log('Card cache is empty. A preloaded cache is required for card autocomplete.')
    const shouldPreload = await shouldBulkRefresh(mode, {
      message: 'Would you like to download the card database now?',
      initial: true,
    })

    if (shouldPreload) {
      await preloadCache()
    } else {
      return { ready: false, cardCount: 0 }
    }
  } else {
    const lastRefreshed = await cardCache.getLastRefreshedAt()

    if (lastRefreshed !== null) {
      await promptStaleCacheRefresh(
        Date.now() - lastRefreshed,
        (prompt) => shouldBulkRefresh(mode, prompt),
        preloadCache,
      )
    }
  }

  const keys = await cardCache.keys()
  return { ready: keys.length > 0, cardCount: keys.length }
}

/** The card-cache flags of the interactive card-entry sessions (the `edit` command). */
export type CacheRefreshOptions = {
  /**
   * Commander stores `--no-cache-prompt` as `cachePrompt: false`. When false,
   * the stale-cache (>1 week) update prompt is suppressed and the existing
   * cache is used as-is.
   */
  cachePrompt?: boolean
  /**
   * `--refresh-prices`: redownload the bulk card cache (which carries prices)
   * when its cached prices are more than a day old.
   */
  refreshPrices?: boolean
}

/** The slice of the card cache that {@link refreshCardCacheForSession} reads. */
export type SessionCardCache = {
  isEmpty(): Promise<boolean>
  getLastRefreshedAt(): Promise<number | null>
}

/** Injectable dependencies for {@link refreshCardCacheForSession}. */
export type SessionCacheDeps = {
  cache?: SessionCardCache
  preload?: () => Promise<void>
  confirmStaleRefresh?: (prompt: BulkRefreshPrompt) => Promise<boolean>
}

/**
 * Apply the {@link CacheRefreshOptions} freshness policy before an interactive
 * card-entry session starts.
 *
 * - With `--refresh-prices`, redownloads the bulk cache when its prices are more
 *   than a day old (prices ride along inside the cached cards, so a redownload
 *   is how they are refreshed).
 * - Otherwise, unless `--no-cache-prompt` was passed, prompts to update a bulk
 *   cache older than a week.
 *
 * An empty cache is left untouched here — the commands surface that separately
 * via their own preload warning.
 */
export async function refreshCardCacheForSession(
  options: CacheRefreshOptions,
  deps: SessionCacheDeps = {},
): Promise<void> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? preloadCache
  const confirmStaleRefresh =
    deps.confirmStaleRefresh ?? ((prompt) => shouldBulkRefresh('ask', prompt))

  if (await cache.isEmpty()) return

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed === null) return
  const age = Date.now() - lastRefreshed

  if (options.refreshPrices && age > PRICE_MAX_AGE_MS) {
    console.log('Cached prices are more than a day old. Refreshing the card cache from Scryfall...')
    await preload()
    return
  }

  if (options.cachePrompt === false) return
  await promptStaleCacheRefresh(age, confirmStaleRefresh, preload)
}

/** Whether price data exists at all, and when it was last refreshed. */
export type PriceFreshnessResult = {
  ready: boolean
  lastRefreshedAt: number | null
}

/**
 * Ensure price data exists and is reasonably fresh before a pricing command
 * runs. Prices ride along inside the bulk card cache, so "refreshing prices"
 * means a bulk redownload.
 *
 * - An empty cache prompts to download the card database (default yes);
 *   declining returns `ready: false` since nothing can be priced.
 * - Prices more than a day old are refreshed automatically under
 *   `--refresh-prices`, otherwise the user is prompted (default no) unless
 *   `--no-cache-prompt` suppresses it.
 *
 * The confirm prompt falls back to its default answer when stdin is not a TTY,
 * so non-interactive runs never hang (and never trigger a surprise download).
 */
export async function ensureFreshPriceData(
  options: CacheRefreshOptions,
  deps: SessionCacheDeps = {},
): Promise<PriceFreshnessResult> {
  const cache = deps.cache ?? cardCache
  const preload = deps.preload ?? preloadCache
  const confirmStaleRefresh =
    deps.confirmStaleRefresh ?? ((prompt) => shouldBulkRefresh('ask', prompt))

  if (await cache.isEmpty()) {
    // With prompting suppressed (--no-cache-prompt, or structured output that
    // must stay parseable) an empty cache is simply unusable — never download.
    if (options.cachePrompt === false) return { ready: false, lastRefreshedAt: null }
    console.log('Card cache is empty. Pricing requires the Scryfall card database.')
    const accepted = await confirmStaleRefresh({
      message: 'Would you like to download it now?',
      initial: true,
    })
    if (!accepted) return { ready: false, lastRefreshedAt: null }
    await preload()
    return { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
  }

  const lastRefreshed = await cache.getLastRefreshedAt()
  if (lastRefreshed !== null) {
    const age = Date.now() - lastRefreshed
    if (age > PRICE_MAX_AGE_MS) {
      if (options.refreshPrices) {
        console.log(
          'Cached prices are more than a day old. Refreshing the card cache from Scryfall...',
        )
        await preload()
      } else if (options.cachePrompt !== false) {
        const accepted = await confirmStaleRefresh({
          message: `Prices were last updated ${formatDuration(age)} ago. Update now?`,
          initial: false,
        })
        if (accepted) await preload()
      }
    }
  }
  return { ready: true, lastRefreshedAt: await cache.getLastRefreshedAt() }
}
