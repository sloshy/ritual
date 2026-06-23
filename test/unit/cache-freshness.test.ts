import { describe, expect, test } from 'bun:test'
import { refreshCardCacheForSession, type SessionCardCache } from '../../src/cache/freshness'
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
