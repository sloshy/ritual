import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { PriceService } from '../../src/prices'
import { InMemoryCacheManager, MemoryLogger, resetLogger, setLogger } from '../test-utils'
import { type PriceData, type Card } from '../../src/types'
import type { CacheManager, PricingBackend } from '../../src/interfaces'

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
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === 'info' &&
          String(entry.args[0]).includes("Updated cached price for 'Lightning Bolt'."),
      ),
    ).toBeTrue()
    expect(
      logger.entries.some(
        (entry) => entry.level === 'progress' && String(entry.args[0]) === '\n',
      ),
    ).toBeTrue()
  })

  test('should fail without cache updates when collection API has missing cards', async () => {
    const cards: Card[] = [
      { name: 'Lightning Bolt', quantity: 1 },
      { name: 'Missing Card', quantity: 1 },
    ]

    let fetchMinMaxCallCount = 0
    mockBackend = {
      fetchLatestPrices: async () => {
        throw new Error('Scryfall could not find prices for: Missing Card')
      },
      fetchMinMaxPrice: async () => {
        fetchMinMaxCallCount++
        return { min: 0, max: 0 }
      },
    }
    priceService = new PriceService(mockBackend, mockCache)

    await expect(priceService.getDeckPricing(cards)).rejects.toThrow(
      'Scryfall could not find prices for: Missing Card',
    )

    expect(fetchMinMaxCallCount).toBe(0)
    expect(await mockCache.get('Lightning Bolt')).toBeNull()
    expect(await mockCache.get('Missing Card')).toBeNull()
  })

  test('should process refreshed fallback prices in completion order', async () => {
    const cards: Card[] = [
      { name: 'Alpha', quantity: 1 },
      { name: 'Beta', quantity: 1 },
      { name: 'Gamma', quantity: 1 },
    ]

    mockBackend = {
      fetchLatestPrices: async () => new Map([['Alpha', 1], ['Beta', 2], ['Gamma', 3]]),
      fetchMinMaxPrice: async (name) => {
        if (name === 'Alpha') await new Promise((resolve) => setTimeout(resolve, 550))
        if (name === 'Beta') await new Promise((resolve) => setTimeout(resolve, 20))
        if (name === 'Gamma') await new Promise((resolve) => setTimeout(resolve, 10))
        return { min: 0, max: 0 }
      },
    }
    priceService = new PriceService(mockBackend, mockCache)

    const result = await priceService.getDeckPricing(cards)

    expect(result.totalLatest).toBe(6)
    const refreshedOrder = logger.entries
      .filter((entry) => entry.level === 'progress')
      .map((entry) => String(entry.args[0]))
      .filter((message) => message.includes('('))
      .map((message) => message.match(/\(([^)]+)\)/)?.[1])
      .filter((value): value is string => typeof value === 'string')
    expect(refreshedOrder).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  test('should stream min/max entries from cache manager when available', async () => {
    const cards: Card[] = [
      { name: 'Sol Ring', quantity: 1 },
      { name: 'Arcane Signet', quantity: 2 },
    ]

    let latestCalls = 0
    let minMaxCalls = 0
    mockBackend = {
      fetchLatestPrices: async () => {
        latestCalls++
        return new Map()
      },
      fetchMinMaxPrice: async () => {
        minMaxCalls++
        return { min: 0, max: 0 }
      },
    }

    const streamCache = new InMemoryCacheManager<PriceData>() as InMemoryCacheManager<PriceData>
    streamCache.streamGetMany = async (keys, onEntry) => {
      const values: Record<string, PriceData> = {
        'Sol Ring': { latest: 1, min: 0.5, max: 2 },
        'Arcane Signet': { latest: 2, min: 1, max: 3 },
      }
      for (const key of keys) {
        const value = values[key]
        if (!value) continue
        onEntry(key, value, { updated: true })
      }
      return values
    }

    priceService = new PriceService(mockBackend, streamCache)
    const result = await priceService.getDeckPricing(cards)

    expect(result.totalLatest).toBe(5)
    expect(result.totalMin).toBe(2.5)
    expect(result.totalMax).toBe(8)
    expect(latestCalls).toBe(0)
    expect(minMaxCalls).toBe(0)
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === 'info' && String(entry.args[0]).includes("Updated cached price for 'Sol Ring'."),
      ),
    ).toBeTrue()
    expect(
      logger.entries.some(
        (entry) => entry.level === 'progress' && String(entry.args[0]) === '\n',
      ),
    ).toBeTrue()
    expect(
      logger.entries.some(
        (entry) => entry.level === 'progress' && String(entry.args[0]).includes('(Sol Ring)'),
      ),
    ).toBeTrue()
  })

  test('should default to streamGetMany without per-key cache get calls', async () => {
    const cards: Card[] = [
      { name: 'Sol Ring', quantity: 1 },
      { name: 'Arcane Signet', quantity: 1 },
    ]

    let streamCallCount = 0
    let getCallCount = 0
    let latestCalls = 0
    let minMaxCalls = 0
    const streamOnlyCache: CacheManager<PriceData> = {
      async get() {
        getCallCount++
        return null
      },
      async streamGetMany(keys, onEntry) {
        streamCallCount++
        const values: Record<string, PriceData> = {
          'Sol Ring': { latest: 1, min: 0.5, max: 2 },
          'Arcane Signet': { latest: 2, min: 1, max: 3 },
        }
        for (const key of keys) {
          const value = values[key]
          if (!value) continue
          onEntry(key, value, { updated: false })
        }
        return values
      },
      async set() {},
      async delete() {},
      async clear() {},
      async keys() {
        return []
      },
      async values() {
        return []
      },
    }

    mockBackend = {
      fetchLatestPrices: async () => {
        latestCalls++
        return new Map()
      },
      fetchMinMaxPrice: async () => {
        minMaxCalls++
        return { min: 0, max: 0 }
      },
    }

    priceService = new PriceService(mockBackend, streamOnlyCache)
    const result = await priceService.getDeckPricing(cards)

    expect(result.totalLatest).toBe(3)
    expect(streamCallCount).toBe(1)
    expect(getCallCount).toBe(0)
    expect(latestCalls).toBe(0)
    expect(minMaxCalls).toBe(0)
  })
})
