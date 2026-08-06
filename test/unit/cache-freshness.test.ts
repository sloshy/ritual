import { describe, expect, test } from 'bun:test'
import {
  emptyCacheAdvice,
  ensureCardCacheForUpload,
  ensureFreshPriceData,
  offerBulkPriceRefresh,
  offerTagDownload,
  refreshCardCacheForSession,
  type PriceFreshnessCache,
  type PriceRefreshDeps,
  type SessionCardCache,
} from '../../src/cache/freshness'
import {
  BULK_CACHE_MAX_AGE_MS,
  BULK_FETCH_THRESHOLD,
  PRICE_MAX_AGE_MS,
} from '../../src/cache/constants'
import type { TagIndex } from '../../src/scryfall/tags'
import type { BulkRefreshPrompt } from '../../src/refresh'

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

/**
 * A cache stub whose emptiness reflects the harness's preloads: an empty cache
 * that has been preloaded reads as filled, the way a real cache would — the
 * empty-cache gates re-check after downloading.
 */
function stubCacheFor(
  h: Harness,
  opts: { empty?: boolean; lastRefreshedAt: number | null },
): SessionCardCache {
  return {
    isEmpty: async () => (opts.empty ?? false) && h.preloadCalls === 0,
    getLastRefreshedAt: async () => opts.lastRefreshedAt,
  }
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
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('auto does not refresh prices when the cache is younger than a day', async () => {
    const h = harness()
    await refreshCardCacheForSession('auto', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - 60_000 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
  })

  test('auto refreshes without prompting even when the cache is over a week old', async () => {
    const h = harness(true)
    // Cache is both over a week old (stale) and over a day old (stale prices).
    await refreshCardCacheForSession('auto', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.preloadCalls).toBe(1)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('ask prompts to update a cache older than a week and preloads when accepted', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(1)
  })

  test('ask prompts but does not preload when the update is declined', async () => {
    const h = harness(false)
    await refreshCardCacheForSession('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(0)
  })

  test('never suppresses the stale prompt entirely', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('never', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('no-bulk never bulk-downloads for a stale cache', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('no-bulk', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - BULK_CACHE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('ask does not prompt when the cache is fresh', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - 60_000 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('leaves an empty cache untouched', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('auto', {
      cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(h.confirmCalls).toHaveLength(0)
  })

  test('does nothing when the cache has never been bulk-refreshed', async () => {
    const h = harness(true)
    await refreshCardCacheForSession('auto', {
      cache: stubCacheFor(h, { lastRefreshedAt: null }),
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
      cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
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
      cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(result).toEqual({ ready: false, lastRefreshedAt: null })
  })

  test('auto downloads into an empty cache without a prompt', async () => {
    const h = harness(false)
    const result = await ensureFreshPriceData('auto', {
      cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
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
        cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
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
      cache: stubCacheFor(h, { lastRefreshedAt: stale }),
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
      cache: stubCacheFor(h, { lastRefreshedAt: stale }),
      ...h,
    })
    expect(h.preloadCalls).toBe(0)
    expect(result.ready).toBe(true)
    expect(result.lastRefreshedAt).toBe(stale)
  })

  test('auto refreshes stale prices without prompting', async () => {
    const h = harness(false)
    await ensureFreshPriceData('auto', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(1)
  })

  test('never suppresses the stale-price prompt', async () => {
    const h = harness(true)
    await ensureFreshPriceData('never', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('no-bulk leaves stale prices alone (refreshing them means a bulk download)', async () => {
    const h = harness(true)
    const result = await ensureFreshPriceData('no-bulk', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - PRICE_MAX_AGE_MS - 1 }),
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
      cache: stubCacheFor(h, { lastRefreshedAt: fresh }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(result).toEqual({ ready: true, lastRefreshedAt: fresh })
  })

  test('an age of exactly one day is still considered fresh', async () => {
    const h = harness(true)
    // The implementation samples `Date.now()` after this line, so a timestamp of
    // exactly `now - PRICE_MAX_AGE_MS` lands one millisecond *over* the boundary
    // whenever the clock ticks in between — the boundary this test means to pin
    // is `age === PRICE_MAX_AGE_MS`, so bias the timestamp forward to absorb the
    // elapsed time rather than racing it.
    const lastRefreshedAt = Date.now() - PRICE_MAX_AGE_MS + 60_000
    await ensureFreshPriceData('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt }),
      ...h,
    })
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })
})

/**
 * The gate a CSV upload passes through. Uploaded rows are keyed by the Scryfall
 * ids this cache holds, so "stale" here is not a suggestion to update — it is a
 * reason to refuse, since the alternative is rows that quietly go missing and one
 * paced Archidekt search per addition that lost its row.
 */
describe('ensureCardCacheForUpload', () => {
  const DAY_OLD = (): number => Date.now() - PRICE_MAX_AGE_MS - 1

  test('a cache refreshed within the day is used as it is', async () => {
    const h = harness(true)
    const logged: string[] = []

    const ready = await ensureCardCacheForUpload('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: Date.now() - 60_000 }),
      log: (message) => logged.push(message),
      ...h,
    })

    expect(ready).toBe(true)
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
    expect(logged).toEqual([])
  })

  test('a cache of unknown age counts as fresh, as every other command reads it', async () => {
    const h = harness(true)

    // No timestamp means the cache was filled by something other than a bulk
    // download — not that it is old.
    const ready = await ensureCardCacheForUpload('never', {
      cache: stubCacheFor(h, { lastRefreshedAt: null }),
      ...h,
    })

    expect(ready).toBe(true)
    expect(h.preloadCalls).toBe(0)
  })

  test('auto refreshes an empty cache without asking, reporting it through the log', async () => {
    const h = harness()
    const logged: string[] = []
    let empty = true

    const ready = await ensureCardCacheForUpload('auto', {
      cache: { isEmpty: () => Promise.resolve(empty), getLastRefreshedAt: async () => null },
      log: (message) => logged.push(message),
      preload: async () => {
        h.preloadCalls++
        empty = false
      },
      confirmStaleRefresh: h.confirmStaleRefresh,
    })

    expect(ready).toBe(true)
    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(1)
    expect(logged).toEqual([
      'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Refreshing it from Scryfall first...',
    ])
  })

  test('auto refreshes a day-old cache too', async () => {
    const h = harness()

    const ready = await ensureCardCacheForUpload('auto', {
      cache: stubCacheFor(h, { lastRefreshedAt: DAY_OLD() }),
      log: () => {},
      ...h,
    })

    expect(ready).toBe(true)
    expect(h.preloadCalls).toBe(1)
  })

  test('ask prompts with yes preselected and preloads when accepted', async () => {
    const h = harness(true)

    const ready = await ensureCardCacheForUpload('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: DAY_OLD() }),
      log: () => {},
      ...h,
    })

    expect(ready).toBe(true)
    // Freshness is a requirement here, so the default answer is yes — unlike the
    // ordinary weekly nag, which defaults to no.
    expect(h.confirmCalls).toEqual([
      {
        message: expect.stringContaining('Update it before uploading?'),
        initial: true,
      },
    ])
    expect(h.preloadCalls).toBe(1)
  })

  test('a declined prompt refuses rather than uploading from the cache anyway', async () => {
    const h = harness(false)

    const ready = await ensureCardCacheForUpload('ask', {
      cache: stubCacheFor(h, { lastRefreshedAt: DAY_OLD() }),
      log: () => {},
      ...h,
    })

    expect(h.preloadCalls).toBe(0)
    expect(ready).toContain('Run `ritual cache preload-all`, or re-run with --refresh auto.')
  })

  test.each(['no-bulk', 'never'] as const)(
    '%s refuses an empty cache instead of falling back to per-card searches',
    async (mode) => {
      const h = harness(true)

      const ready = await ensureCardCacheForUpload(mode, {
        cache: stubCacheFor(h, { empty: true, lastRefreshedAt: null }),
        log: () => {},
        ...h,
      })

      expect(h.confirmCalls).toHaveLength(0)
      expect(h.preloadCalls).toBe(0)
      expect(ready).toBe(
        'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty. Run `ritual cache preload-all`, or re-run with --refresh auto.',
      )
    },
  )

  test('a refresh that leaves the cache empty is still a refusal', async () => {
    const h = harness()

    // Deliberately NOT the harness-aware stub: this cache stays empty even
    // after a "successful" preload, which is the failure being pinned.
    const ready = await ensureCardCacheForUpload('auto', {
      cache: { isEmpty: async () => true, getLastRefreshedAt: async () => null },
      log: () => {},
      ...h,
    })

    expect(h.preloadCalls).toBe(1)
    expect(ready).toBe(
      'The card cache is still empty after a refresh, so no CSV row could be keyed by a Scryfall id.',
    )
  })
})

/**
 * The price gate `build-site` and `serve --api` share: a redownload is only
 * worth offering when enough of the cards being rendered carry day-old prices.
 */
describe('offerBulkPriceRefresh', () => {
  const STALE = Date.now() - PRICE_MAX_AGE_MS - 1
  const names = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `Card ${i + 1}`)

  /** A cache whose bulk download is old and whose every card price is stale. */
  function staleCache(): PriceFreshnessCache {
    return {
      getLastRefreshedAt: async () => STALE,
      getTimestamp: async () => STALE,
      isBlocked: async () => false,
    }
  }

  /** The harness wired in as the gate's deps; `cache` defaults to all-stale. */
  const deps = (h: Harness, cache: PriceFreshnessCache = staleCache()): PriceRefreshDeps => ({
    cache,
    preload: h.preload,
    confirm: h.confirmStaleRefresh,
  })

  test('offers the redownload when more cards than the threshold have stale prices', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD + 1), 'ask', false, deps(h))

    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(1)
  })

  test('declining leaves the older prices in place', async () => {
    const h = harness(false)

    await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD + 1), 'ask', false, deps(h))

    expect(h.confirmCalls).toHaveLength(1)
    expect(h.preloadCalls).toBe(0)
  })

  test('stays silent when only a handful of prices are stale', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD), 'ask', false, deps(h))

    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('cards whose prices are already fresh do not count toward the threshold', async () => {
    const h = harness(true)
    const stale = new Set(names(3))

    // Over the threshold in cards, but only three of them are priced stale.
    await offerBulkPriceRefresh(
      names(BULK_FETCH_THRESHOLD + 1),
      'ask',
      false,
      deps(h, {
        ...staleCache(),
        getTimestamp: async (name: string) => (stale.has(name) ? STALE : Date.now() - 60_000),
      }),
    )

    expect(h.confirmCalls).toHaveLength(0)
  })

  test('a bulk cache downloaded within the day makes the offer pointless', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(
      names(BULK_FETCH_THRESHOLD + 1),
      'ask',
      false,
      deps(h, { ...staleCache(), getLastRefreshedAt: async () => Date.now() - 60_000 }),
    )

    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('a redownload that fails leaves the run going on the older prices', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD + 1), 'ask', false, {
      ...deps(h),
      preload: async () => {
        h.preloadCalls++
        throw new Error('offline')
      },
    })

    // Reported, not thrown: the caller still has the cache it had.
    expect(h.preloadCalls).toBe(1)
  })

  test('a bulk download earlier in the same run makes the prices as fresh as they can be', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD + 1), 'ask', true, deps(h))

    expect(h.confirmCalls).toHaveLength(0)
    expect(h.preloadCalls).toBe(0)
  })

  test('blocked cards are not counted as stale', async () => {
    const h = harness(true)

    await offerBulkPriceRefresh(
      names(BULK_FETCH_THRESHOLD + 1),
      'ask',
      false,
      deps(h, {
        ...staleCache(),
        isBlocked: async () => true,
      }),
    )

    expect(h.confirmCalls).toHaveLength(0)
  })

  test.each(['no-bulk', 'never'] as const)(
    '--refresh %s never offers a bulk download',
    async (mode) => {
      const h = harness(true)

      await offerBulkPriceRefresh(names(BULK_FETCH_THRESHOLD + 1), mode, false, deps(h))

      expect(h.confirmCalls).toHaveLength(0)
      expect(h.preloadCalls).toBe(0)
    },
  )
})

describe('offerTagDownload', () => {
  const index: TagIndex = { updatedAt: 0, oracle: {}, illustration: {} }

  test('bakes the downloaded index into the cache and hands it back', async () => {
    const baked: TagIndex[] = []

    const result = await offerTagDownload('ask', {
      confirm: async () => true,
      download: async () => index,
      bake: async (i) => {
        baked.push(i)
      },
    })

    // The same index the caller gets is the one baked — a second download would
    // re-fetch a ~100 MB pair of bulk files.
    expect(result).toBe(index)
    expect(baked).toEqual([index])
  })

  test('a declined prompt downloads nothing', async () => {
    let downloads = 0

    const result = await offerTagDownload('ask', {
      confirm: async () => false,
      download: async () => {
        downloads++
        return index
      },
      bake: async () => {},
    })

    expect(result).toBeNull()
    expect(downloads).toBe(0)
  })

  test('a failed download is reported rather than baked', async () => {
    let downloads = 0
    let baked = 0

    const result = await offerTagDownload('auto', {
      download: async () => {
        downloads++
        return null
      },
      bake: async () => {
        baked++
      },
    })

    // Asserting the download ran is what separates this from the declined path,
    // whose result and bake count are identical.
    expect(downloads).toBe(1)
    expect(result).toBeNull()
    expect(baked).toBe(0)
  })

  test.each(['no-bulk', 'never'] as const)(
    '--refresh %s declines through the default confirm, downloading nothing',
    async (mode) => {
      let downloads = 0

      // No `confirm` dep: this is exactly how `warmSiteCache` calls the gate,
      // and it is what keeps `serve --api --refresh never` off the network.
      const result = await offerTagDownload(mode, {
        download: async () => {
          downloads++
          return index
        },
        bake: async () => {},
      })

      expect(downloads).toBe(0)
      expect(result).toBeNull()
    },
  )
})
