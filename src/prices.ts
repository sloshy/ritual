import { type Card, type PriceData } from './types'
import { defaultCache } from './cache'
import { type CacheManager, type PricingBackend } from './interfaces'
import { scryfallClient } from './scryfall'
import { getLogger } from './logger'

// Scryfall Rate Limit: 100ms per request (10 requests per second is safe).
const RATE_LIMIT_DELAY = 100

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

    const cardsToFetch: string[] = []
    for (const name of uniqueNames) {
      const cached = await this.priceCache.get(name)
      if (cached) {
        pricingMap.set(name, cached)
      } else {
        cardsToFetch.push(name)
      }
    }

    if (cardsToFetch.length > 0) {
      getLogger().info(`Fetching prices for ${cardsToFetch.length} cards...`)

      const latestPrices = await this.backend.fetchLatestPrices(cardsToFetch)

      let processed = 0
      getLogger().progress(`Progress: 0/${cardsToFetch.length}`)

      for (const name of cardsToFetch) {
        const minMax = await this.backend.fetchMinMaxPrice(name)
        const latest = latestPrices.get(name) || 0

        const finalLatest = latest > 0 ? latest : minMax.min || 0

        const data: PriceData = {
          latest: finalLatest,
          min: minMax.min,
          max: minMax.max,
        }

        pricingMap.set(name, data)
        await this.priceCache.set(name, data)

        processed++
        getLogger().progress(`\rProgress: ${processed}/${cardsToFetch.length}`)
        await sleep(RATE_LIMIT_DELAY)
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
