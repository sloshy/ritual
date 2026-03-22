import prompts from 'prompts'
import { cardCache } from './index'
import { preloadCache } from '../scryfall'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

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
 * @returns Whether the cache is ready for use (has cards) and how many cards are available.
 */
export async function ensureFreshCardCache(): Promise<CacheFreshnessResult> {
  const empty = await cardCache.isEmpty()

  if (empty) {
    console.log('Card cache is empty. A preloaded cache is required for card autocomplete.')
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Would you like to download the card database now?',
      initial: true,
    })

    if (response.value) {
      await preloadCache()
    } else {
      return { ready: false, cardCount: 0 }
    }
  } else {
    const lastRefreshed = await cardCache.getLastRefreshedAt()

    if (lastRefreshed !== null) {
      const age = Date.now() - lastRefreshed
      if (age > SEVEN_DAYS_MS) {
        const days = Math.floor(age / (24 * 60 * 60 * 1000))
        const response = await prompts({
          type: 'confirm',
          name: 'value',
          message: `Card cache is ${days} day${days !== 1 ? 's' : ''} old. Would you like to update it?`,
          initial: false,
        })

        if (response.value) {
          await preloadCache()
        }
      }
    }
  }

  const keys = await cardCache.keys()
  return { ready: keys.length > 0, cardCount: keys.length }
}
