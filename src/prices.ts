import { type Card, type PriceData } from './types'
import { defaultCache } from './cache'
import { type CacheManager, type PricingBackend } from './interfaces'
import { scryfallClient } from './scryfall'
import { getLogger } from './logger'

// Scryfall Rate Limit: 100ms per request. We launch one request every 2x the
// rate limit (200ms) to be safe, while still running all requests in parallel.
const RATE_LIMIT_DELAY = 100
const REQUEST_INTERVAL = RATE_LIMIT_DELAY * 2

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Map of Card Name -> Price Data
export type PricingMap = Map<string, PriceData>

export interface PriceResult {
  totalLatest: number
  totalMin: number
  totalMax: number
  breakdown: PricingMap
}

export class PriceService {
  constructor(
    private backend: PricingBackend,
    private priceCache: CacheManager<PriceData>,
  ) {}

  async getDeckPricing(cards: Card[]): Promise<PriceResult> {
    const uniqueNames = Array.from(new Set(cards.map((c) => c.name)))
    const pricingMap: PricingMap = new Map()
    const logUpdatedPrice = (name: string) => {
      getLogger().progress('\n')
      getLogger().info(`Updated cached price for '${name}'.`)
    }

    if (uniqueNames.length > 0) {
      getLogger().info(`Fetching prices for ${uniqueNames.length} cards...`)
      let processed = 0
      getLogger().progress(`Progress: 0/${uniqueNames.length}`)

      const streamedResults = await this.priceCache.streamGetMany(uniqueNames, (name, data, meta) => {
        pricingMap.set(name, data)
        if (meta.updated) {
          logUpdatedPrice(name)
        }
        processed++
        getLogger().progress(`\rProgress: ${processed}/${uniqueNames.length} (${name})`)
      })
      const missingCards = uniqueNames.filter((name) => !(name in streamedResults))

      if (missingCards.length > 0) {
        const latestPrices = await this.backend.fetchLatestPrices(missingCards)
        await new Promise<void>((resolve, reject) => {
          let remaining = missingCards.length
          let failed = false

          for (const [index, name] of missingCards.entries()) {
            void (async () => {
              await sleep(index * REQUEST_INTERVAL)
              const minMax = await this.backend.fetchMinMaxPrice(name)
              const latest = latestPrices.get(name) || 0
              const finalLatest = latest > 0 ? latest : minMax.min || 0

              const data: PriceData = {
                latest: finalLatest,
                min: minMax.min,
                max: minMax.max,
              }

              if (failed) return
              pricingMap.set(name, data)
              await this.priceCache.set(name, data)
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
              .catch((error) => {
                if (failed) return
                failed = true
                reject(error)
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
    }
  }
}

export const priceService = new PriceService(scryfallClient, defaultCache)

export function getDeckPricing(cards: Card[]) {
  return priceService.getDeckPricing(cards)
}
