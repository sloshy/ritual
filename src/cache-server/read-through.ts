import { type FileCacheManager } from '../cache'
import { isCurrencyAvailableForCard } from '../price-currency'
import { parsePriceCacheKey } from '../prices'
import { ScryfallClient, getCardGames } from '../scryfall'
import { type PriceData, type ScryfallCard } from '../types'
import { shouldForcePriceRefresh } from './helpers'
import { type PriceRefreshScheduler } from './scheduler'
import { type PriceReadThroughResult, type PriceRefreshAction } from './types'

type CacheUpdateLogger = (message: string) => void

export async function resolveCardCacheReadThrough(
  cache: FileCacheManager<'cards'>,
  scryfallClient: ScryfallClient,
  key: string,
  onCacheUpdate: CacheUpdateLogger,
): Promise<ScryfallCard[] | null> {
  const cached = await cache.get(key)
  if (cached) return cached

  const card = await scryfallClient.fetchCardData(key, { silent: true })
  if (!card) return null

  const refreshed = await cache.get(key)
  if (refreshed) {
    onCacheUpdate(`section=cards action=read-through-fill key='${key}'`)
    return refreshed
  }
  onCacheUpdate(`section=cards action=read-through-fill key='${key}'`)
  return [card]
}

export async function refreshPriceCacheEntry(
  cache: FileCacheManager<'prices'>,
  scryfallClient: ScryfallClient,
  key: string,
  onCacheUpdate: CacheUpdateLogger,
  action: PriceRefreshAction,
  cardCache?: FileCacheManager<'cards'>,
): Promise<PriceData | null> {
  const parsed = parsePriceCacheKey(key)
  if (!parsed.ok) return null
  const { cardName, currency } = parsed

  // Check game-format availability before making API calls
  if (cardCache) {
    const printings = await cardCache.get(cardName)
    if (printings) {
      const games = getCardGames(printings)
      if (!isCurrencyAvailableForCard(games, currency)) {
        return null
      }
    }
  }

  const latestByName = await scryfallClient.fetchLatestPrices([cardName], currency)
  const minMax = await scryfallClient.fetchMinMaxPrice(cardName, currency)
  const latest = latestByName.get(cardName) || 0
  const value: PriceData = {
    latest: latest > 0 ? latest : minMax.min || 0,
    min: minMax.min,
    max: minMax.max,
  }
  await cache.set(key, value)
  onCacheUpdate(`section=prices action=${action} key='${key}'`)
  return value
}

export async function resolvePriceCacheReadThrough(
  cache: FileCacheManager<'prices'>,
  scryfallClient: ScryfallClient,
  key: string,
  onCacheUpdate: CacheUpdateLogger,
  priceRefreshScheduler: PriceRefreshScheduler | null,
  cardCache?: FileCacheManager<'cards'>,
): Promise<PriceReadThroughResult> {
  const cached = await cache.get(key)
  if (cached) {
    if (priceRefreshScheduler) {
      await priceRefreshScheduler.ensureScheduledFromTimestamp(key)
      const lastUpdatedAt = await cache.getTimestamp(key)
      const scheduledAt = priceRefreshScheduler.getScheduledRefreshAt(key)
      const shouldForceRefresh = shouldForcePriceRefresh(
        priceRefreshScheduler.getIntervalMs(),
        lastUpdatedAt,
        scheduledAt,
      )

      if (shouldForceRefresh) {
        const refreshed = await priceRefreshScheduler.forceRefreshNow(key)
        if (refreshed) return { value: refreshed, updated: true }
      }
    }

    return { value: cached, updated: false }
  }

  const refreshed = await refreshPriceCacheEntry(
    cache,
    scryfallClient,
    key,
    onCacheUpdate,
    'read-through-fill',
    cardCache,
  )
  if (priceRefreshScheduler) {
    priceRefreshScheduler.scheduleFromNow(key)
  }
  return { value: refreshed, updated: true }
}
