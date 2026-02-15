import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { PriceService } from '../../src/prices'
import { InMemoryCacheManager, MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { type PriceData, type Card } from '../../src/types'
import type { PricingBackend } from '../../src/interfaces'

describe('PriceService', () => {
  let priceService: PriceService
  let mockCache: InMemoryCacheManager<PriceData>
  let mockBackend: PricingBackend
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
    mockCache = new InMemoryCacheManager()
    mockBackend = {
      fetchLatestPrices: async () => new Map(),
      fetchMinMaxPrice: async () => ({ min: 0, max: 0 }),
    }
    priceService = new PriceService(mockBackend, mockCache)
  })

  afterEach(() => {
    resetLogger()
  })

  test('should return zero totals for empty deck', async () => {
    const result = await priceService.getDeckPricing([])
    expect(result.totalLatest).toBe(0)
    expect(result.totalMin).toBe(0)
    expect(result.totalMax).toBe(0)
    expect(result.breakdown.size).toBe(0)
  })

  test('should use cached prices if available', async () => {
    const cachedPrice: PriceData = { latest: 10, min: 5, max: 20 }
    await mockCache.set('Black Lotus', cachedPrice)

    const cards: Card[] = [{ name: 'Black Lotus', quantity: 1 }]

    const result = await priceService.getDeckPricing(cards)

    expect(result.totalLatest).toBe(10)
    expect(result.totalMin).toBe(5)
    expect(result.totalMax).toBe(20)
    expect(result.breakdown.get('Black Lotus')).toEqual(cachedPrice)
  })

  test('should fetch prices from API if not in cache', async () => {
    const cards: Card[] = [{ name: 'Lightning Bolt', quantity: 4 }]

    mockBackend = {
      fetchLatestPrices: async () => new Map([['Lightning Bolt', 2.5]]),
      fetchMinMaxPrice: async (name: string) => {
        if (name === 'Lightning Bolt') {
          return { min: 1, max: 5 }
        }
        return { min: 0, max: 0 }
      },
    }
    priceService = new PriceService(mockBackend, mockCache)

    const result = await priceService.getDeckPricing(cards)

    expect(result.breakdown.get('Lightning Bolt')).toEqual({
      latest: 2.5,
      min: 1.0,
      max: 5.0,
    })

    expect(result.totalLatest).toBe(2.5 * 4)
    expect(result.totalMin).toBe(1.0 * 4)
    expect(result.totalMax).toBe(5.0 * 4)

    // Verify cache was updated
    const cached = await mockCache.get('Lightning Bolt')
    expect(cached).not.toBeNull()
    expect(cached).toEqual({ latest: 2.5, min: 1, max: 5 })

    expect(logger.entries.some((entry) => entry.level === 'info')).toBeTrue()
  })
})
