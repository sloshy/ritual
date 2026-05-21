import { cardCache } from './index'
import { preloadCache } from '../scryfall'
import { BULK_CACHE_MAX_AGE_MS } from './constants'
import { shouldBulkRefresh, type RefreshMode } from '../refresh'

type CacheFreshnessResult = {
  ready: boolean
  cardCount: number
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
      const age = Date.now() - lastRefreshed
      if (age > BULK_CACHE_MAX_AGE_MS) {
        const days = Math.floor(age / (24 * 60 * 60 * 1000))
        const shouldPreload = await shouldBulkRefresh(mode, {
          message: `Card cache is ${days} day${days !== 1 ? 's' : ''} old. Would you like to update it?`,
          initial: false,
        })

        if (shouldPreload) {
          await preloadCache()
        }
      }
    }
  }

  const keys = await cardCache.keys()
  return { ready: keys.length > 0, cardCount: keys.length }
}
