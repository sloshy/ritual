import { describe, expect, test } from 'bun:test'
import {
  emptyCacheAdvice,
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

describe('emptyCacheAdvice', () => {
  test('appends the standard remedy line to the caller lead-in', () => {
    expect(emptyCacheAdvice('Card cache is empty.')).toBe(
      'Card cache is empty. Run `ritual cache preload-all` first, or re-run with --refresh auto to download it.',
    )
  })
})

describe('refreshCardCacheForSession', () => {
  test('auto refreshes prices when the cache is older than a day', async () => {
    const h = harness()
    await refreshCardCacheForSession('auto', {
      cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('auto does not refresh prices when the cache is younger than a day', async () => {
    const h = harness()
    await refreshCardCacheForSession('auto', {
      cache: stubCache({ lastRefreshedAt: Date.now() - 60_000 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
  })

  test('auto refreshes without prompting even when the cache is over a week old', async () => {
    const h = harness(true)
    // Cache is both over a week old (stale) and over a day old (stale prices).
    await refreshCardCacheForSession('auto', {
      cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('ask prompts to update a cache older than a week and preloads when accepted', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('ask', {
      cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(1)
  })

  test('ask prompts but does not preload when the update is declined', async () => {
    const h = harness(false)
    await refreshCardCacheForSession('ask', {
      cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(0)
  })

  test('never suppresses the stale prompt entirely', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('never', {
      cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('no-bulk never bulk-downloads for a stale cache', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('no-bulk', {
      cache: stubCache({ lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('ask does not prompt when the cache is fresh', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('ask', {
      cache: stubCache({ lastRefreshedAt: Date.now() - 60_000 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('leaves an empty cache untouched', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('auto', {
      cache: stubCache({ empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('does nothing when the cache has never been bulk-refreshed', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('auto', {
      cache: stubCache({ lastRefreshedAt: null }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(h.confirmCalls).toHaveLength(0)
  })
})

describe('ensureFreshPriceData', () => {
  test('ask offers to download when the cache is empty and preloads on acceptance', async () => {
    const h = harness(true)
    const result = await ensureFreshPriceData('ask', {
      cache: stubCache({ empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.confirmCalls[0]!.initial).toBe(true)
    expect(h.preloadCalls).toBe(1)
    expect(result.ready).toBe(true)
  })

  test('is not ready when the empty-cache download is declined', async () => {
    const h = harness(false)
    const result = await ensureFreshPriceData('ask', {
      cache: stubCache({ empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(result).toEqual({ ready: false, lastRefreshedAt: null })
  })

  test('auto downloads into an empty cache without a prompt', async () => {
    const h = harness(false)
    const result = await ensureFreshPriceData('auto', {
      cache: stubCache({ empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(1)
    expect(result.ready).toBe(true)
  })

  test('never (and no-bulk) never download into an empty cache', async () => {
    for (const mode of ['never', 'no-bulk'] as const) {
      const h = harness(true)
      const result = await ensureFreshPriceData(mode, {
        cache: stubCache({ empty: true, lastRefreshedAt: null }),
        ...h,
      })
      expect(h.confirmCalls).toHaveLength(0)
      expect(h.preloadCalls).toBe(0)
      expect(result.ready).toBe(false)
    }
  })

  test('ask prompts when prices are more than a day old and preloads on acceptance', async () => {
    const h = harness(true)
    const stale = Date.now() - PRICE_MAX_AGE_MS - 60_000
    const result = await ensureFreshPriceData('ask', {
      cache: stubCache({ lastRefreshedAt: stale }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.confirmCalls[0]!.initial).toBe(false)
    expect(h.confirmCalls[0]!.message).toContain('Prices were last updated')
    expect(h.preloadCalls).toBe(1)
    expect(result.ready).toBe(true)
  })

  test('stays ready without preloading when the stale prompt is declined', async () => {
    const h = harness(false)
    const stale = Date.now() - PRICE_MAX_AGE_MS - 60_000
    const result = await ensureFreshPriceData('ask', {
      cache: stubCache({ lastRefreshedAt: stale }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(result.ready).toBe(true)
    expect(result.lastRefreshedAt).toBe(stale)
  })

  test('auto refreshes stale prices without prompting', async () => {
    const h = harness(false)
    await ensureFreshPriceData('auto', {
      cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(1)
  })

  test('never suppresses the stale-price prompt', async () => {
    const h = harness(true)
    await ensureFreshPriceData('never', {
      cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('no-bulk leaves stale prices alone (refreshing them means a bulk download)', async () => {
    const h = harness(true)
    const result = await ensureFreshPriceData('no-bulk', {
      cache: stubCache({ lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
    expect(result.ready).toBe(true)
  })

  test('does not prompt when prices are fresh', async () => {
    const h = harness(true)
    const fresh = Date.now() - 60_000
    const result = await ensureFreshPriceData('ask', {
      cache: stubCache({ lastRefreshedAt: fresh }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(result).toEqual({ ready: true, lastRefreshedAt: fresh })
  })

  test('an age of exactly one day is still considered fresh', async () => {
    const h = harness(true)
    const now = Date.now()
    await ensureFreshPriceData('ask', {
      cache: stubCache({ lastRefreshedAt: now - PRICE_MAX_AGE_MS }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })
})
