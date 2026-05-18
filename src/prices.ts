import { type Card, type PriceData } from './types'
import { defaultCache, cardCache as globalCardCache } from './cache'
import { type CacheManager, type PricingBackend } from './interfaces'
import { scryfallClient, getCardGames } from './scryfall'
import { isCurrencyAvailableForCard } from './price-currency'
import type { PriceCurrency } from './price-currency'
import { getLogger } from './logger'

// Scryfall Rate Limit: 100ms per request. We launch one request every 2x the
// rate limit (200ms) to be safe, while still running all requests in parallel.
const RATE_LIMIT_DELAY = 100
const REQUEST_INTERVAL = RATE_LIMIT_DELAY * 2

/** Build a currency-keyed cache key. */
export function priceCacheKey(cardName: string, currency: PriceCurrency): string {
  return `${cardName}:${currency}`
}

export type ParsePriceCacheKeyResult =
  | { ok: true; cardName: string; currency: PriceCurrency }
  | { ok: false; error: string }

/** Parse a price cache key back into card name and currency. */
export function parsePriceCacheKey(key: string): ParsePriceCacheKeyResult {
  const lastColon = key.lastIndexOf(':')
  if (lastColon === -1) return { ok: false, error: `Cache key '${key}' is missing currency suffix` }
  const suffix = key.slice(lastColon + 1)
  if (suffix === 'usd' || suffix === 'eur' || suffix === 'tix') {
    return { ok: true, cardName: key.slice(0, lastColon), currency: suffix }
  }
  return { ok: false, error: `Cache key '${key}' has unknown currency suffix '${suffix}'` }
}

// Map of Card Name -> Price Data
export type PricingMap = Map<string, PriceData>

export interface PriceResult {
  totalLatest: number
  totalMin: number
  totalMax: number
  breakdown: PricingMap
  missingCards: string[]
}

export class PriceService {
  constructor(
    private backend: PricingBackend,
    private priceCache: CacheManager<PriceData>,
    private cardCacheForGames: CacheManager<import('./types').ScryfallCard[]>,
  ) {}

  async getDeckPricing(cards: Card[], currency: PriceCurrency = 'usd'): Promise<PriceResult> {
    const uniqueNames = Array.from(new Set(cards.map((c) => c.name)))
    const pricingMap: PricingMap = new Map()
    const missingCards: string[] = []
    const logUpdatedPrice = (name: string) => {
      getLogger().progress('\n')
      getLogger().info(`Updated cached price for '${name}'.`)
    }

    if (uniqueNames.length > 0) {
      getLogger().info(
        `Fetching prices (${currency.toUpperCase()}) for ${uniqueNames.length} cards...`,
      )
      let processed = 0
      getLogger().progress(`Progress: 0/${uniqueNames.length}`)

      // Check game format availability and separate eligible vs ineligible
      const eligibleNames: string[] = []
      for (const name of uniqueNames) {
        const printings = await this.cardCacheForGames.get(name)
        const games = printings ? getCardGames(printings) : []
        if (!isCurrencyAvailableForCard(games, currency)) {
          getLogger().warn(
            `Card '${name}' is not available in ${currency === 'tix' ? 'MTGO' : 'paper'}, skipping ${currency.toUpperCase()} pricing.`,
          )
          missingCards.push(name)
          processed++
          getLogger().progress(`\rProgress: ${processed}/${uniqueNames.length} (${name})`)
          continue
        }
        eligibleNames.push(name)
      }

      // Use currency-keyed cache keys (card-name:currency)
      const cacheKeys = eligibleNames.map((name) => priceCacheKey(name, currency))

      const streamedResults = await this.priceCache.streamGetMany(cacheKeys, (key, data, meta) => {
        const parsed = parsePriceCacheKey(key)
        if (!parsed.ok) {
          getLogger().error(`Skipping cache entry with invalid key '${key}': ${parsed.error}`)
          return
        }
        const { cardName: name } = parsed
        pricingMap.set(name, data)
        if (meta.updated) {
          logUpdatedPrice(name)
        }
        processed++
        getLogger().progress(`\rProgress: ${processed}/${uniqueNames.length} (${name})`)
      })
      const missingCacheKeys = cacheKeys.filter((key) => !(key in streamedResults))
      const missingNames = missingCacheKeys.flatMap((key) => {
        const parsed = parsePriceCacheKey(key)
        return parsed.ok ? [parsed.cardName] : []
      })

      if (missingNames.length > 0) {
        const latestPrices = await this.backend.fetchLatestPrices(missingNames, currency)
        await new Promise<void>((resolve, reject) => {
          let remaining = missingNames.length
          let failed = false

          for (const [index, name] of missingNames.entries()) {
            void (async () => {
              await Bun.sleep(index * REQUEST_INTERVAL)
              const minMax = await this.backend.fetchMinMaxPrice(name, currency)
              const latest = latestPrices.get(name) ?? 0
              const finalLatest = latest > 0 ? latest : (minMax.min ?? 0)

              const data: PriceData = {
                latest: finalLatest,
                min: minMax.min,
                max: minMax.max,
              }

              if (failed) return
              pricingMap.set(name, data)
              await this.priceCache.set(priceCacheKey(name, currency), data)
              logUpdatedPrice(name)

              processed++
              getLogger().progress(`\rProgress: ${processed}/${uniqueNames.length} (${name})`)
            })()
              .then(() => {
                if (failed) return
                remaining--
                if (remaining === 0) {
                  resolve()
                }
              })
              .catch((error: unknown) => {
                if (failed) return
                failed = true
                reject(error instanceof Error ? error : new Error(String(error)))
              })
          }
        })
      }
      getLogger().info('\nDone fetching prices.')
    }

    // Calculate Totals
    let totalLatest = 0
    let totalMin = 0
    let totalMax = 0

    for (const card of cards) {
      const price = pricingMap.get(card.name)
      if (price) {
        totalLatest += price.latest * card.quantity
        totalMin += price.min * card.quantity
        totalMax += price.max * card.quantity
      }
    }

    return {
      totalLatest,
      totalMin,
      totalMax,
      breakdown: pricingMap,
      missingCards,
    }
  }
}

export const priceService = new PriceService(scryfallClient, defaultCache, globalCardCache)

export function getDeckPricing(
  cards: Card[],
  currency: PriceCurrency = 'usd',
): Promise<PriceResult> {
  return priceService.getDeckPricing(cards, currency)
}
