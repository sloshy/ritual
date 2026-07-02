import { describe, expect, test } from 'bun:test'
import {
  ensureFreshPriceData,
  refreshCardCacheForSession,
  type SessionCardCache,
} from '../../src/cache/freshness'
import { BULK_CACHE_MAX_AGE_MS, PRICE_MAX_AGE_MS } from '../../src/cache/constants'
import type { BulkRefreshPrompt } from '../../src/refresh'

function stubCache(opts: { empty?: boolean; lastRefreshedAt: number | null }): SessionCardCache {
  return {
    isEmpty: async () => opts.empty ?? false,
    getLastRefreshedAt: async () => opts.lastRefreshedAt,
  }
}

type Harness = {
  preloadCalls: number
  confirmCalls: BulkRefreshPrompt[]
  preload: () => Promise<void>
  confirmStaleRefresh: (prompt: BulkRefreshPrompt) => Promise<boolean>
}

function harness(confirmAnswer = false): Harness {
  const h: Harness = {
    preloadCalls: 0,
    confirmCalls: [],
    preload: async () => {
      h.preloadCalls++
    },
    confirmStaleRefresh: async (prompt) => {
      h.confirmCalls.push(prompt)
      return confirmAnswer
    },
  }
  return h
}

describe('refreshCardCacheForSession', () => {
  test('refreshes prices when --refresh-prices and cache is older than a day', async () => {
    const h = harness()
    await refreshCardCacheForSession(
      { refreshPrices: true },
      { cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('does not refresh prices when cache is younger than a day', async () => {
    const h = harness()
    await refreshCardCacheForSession(
      { refreshPrices: true },
      { cache: stubCache({ lastRefreshedAt: Date.now() - 60_000 }), ...h },
    )
    expect(h.preloadCalls).toBe(0)
  })

  test('refresh-prices takes precedence over the stale prompt', async () => {
    const h = harness(true)
    // Cache is both over a week old (stale) and over a day old (stale prices).
    await refreshCardCacheForSession(
      { refreshPrices: true },
      { cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('prompts to update a cache older than a week and preloads when accepted', async () => {
    const h = harness(true)
    await refreshCardCacheForSession(
      {},
      { cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(1)
  })

  test('prompts but does not preload when the update is declined', async () => {
    const h = harness(false)
    await refreshCardCacheForSession(
      {},
      { cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(0)
  })

  test('--no-cache-prompt suppresses the stale prompt entirely', async () => {
    const h = harness(true)
    await refreshCardCacheForSession(
      { cachePrompt: false },
      { cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('does not prompt when the cache is fresh', async () => {
    const h = harness(true)
    await refreshCardCacheForSession(
      {},
      { cache: stubCache({ lastRefreshedAt: Date.now() - 60_000 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('leaves an empty cache untouched', async () => {
    const h = harness(true)
    await refreshCardCacheForSession(
      { refreshPrices: true },
      { cache: stubCache({ empty: true, lastRefreshedAt: null }), ...h },
    )
    expect(h.preloadCalls).toBe(0)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('does nothing when the cache has never been bulk-refreshed', async () => {
    const h = harness(true)
    await refreshCardCacheForSession(
      { refreshPrices: true },
      { cache: stubCache({ lastRefreshedAt: null }), ...h },
    )
    expect(h.preloadCalls).toBe(0)
    expect(h.confirmCalls).toHaveLength(0)
  })
})

describe('ensureFreshPriceData', () => {
  test('offers to download when the cache is empty and preloads on acceptance', async () => {
    const h = harness(true)
    const result = await ensureFreshPriceData(
      {},
      { cache: stubCache({ empty: true, lastRefreshedAt: null }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.confirmCalls[0]!.initial).toBe(true)
    expect(h.preloadCalls).toBe(1)
    expect(result.ready).toBe(true)
  })

  test('is not ready when the empty-cache download is declined', async () => {
    const h = harness(false)
    const result = await ensureFreshPriceData(
      {},
      { cache: stubCache({ empty: true, lastRefreshedAt: null }), ...h },
    )
    expect(h.preloadCalls).toBe(0)
    expect(result).toEqual({ ready: false, lastRefreshedAt: null })
  })

  test('never downloads into an empty cache when prompting is suppressed', async () => {
    const h = harness(true)
    const result = await ensureFreshPriceData(
      { cachePrompt: false },
      { cache: stubCache({ empty: true, lastRefreshedAt: null }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
    expect(result.ready).toBe(false)
  })

  test('prompts when prices are more than a day old and preloads on acceptance', async () => {
    const h = harness(true)
    const stale = Date.now() - PRICE_MAX_AGE_MS - 60_000
    const result = await ensureFreshPriceData(
      {},
      { cache: stubCache({ lastRefreshedAt: stale }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.confirmCalls[0]!.initial).toBe(false)
    expect(h.confirmCalls[0]!.message).toContain('Prices were last updated')
    expect(h.preloadCalls).toBe(1)
    expect(result.ready).toBe(true)
  })

  test('stays ready without preloading when the stale prompt is declined', async () => {
    const h = harness(false)
    const stale = Date.now() - PRICE_MAX_AGE_MS - 60_000
    const result = await ensureFreshPriceData(
      {},
      { cache: stubCache({ lastRefreshedAt: stale }), ...h },
    )
    expect(h.preloadCalls).toBe(0)
    expect(result.ready).toBe(true)
    expect(result.lastRefreshedAt).toBe(stale)
  })

  test('--refresh-prices refreshes stale prices without prompting', async () => {
    const h = harness(false)
    await ensureFreshPriceData(
      { refreshPrices: true },
      { cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(1)
  })

  test('--no-cache-prompt suppresses the stale-price prompt', async () => {
    const h = harness(true)
    await ensureFreshPriceData(
      { cachePrompt: false },
      { cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('does not prompt when prices are fresh', async () => {
    const h = harness(true)
    const fresh = Date.now() - 60_000
    const result = await ensureFreshPriceData(
      {},
      { cache: stubCache({ lastRefreshedAt: fresh }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(result).toEqual({ ready: true, lastRefreshedAt: fresh })
  })

  test('an age of exactly one day is still considered fresh', async () => {
    const h = harness(true)
    const now = Date.now()
    await ensureFreshPriceData(
      {},
      { cache: stubCache({ lastRefreshedAt: now - PRICE_MAX_AGE_MS }), ...h },
    )
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })
})
