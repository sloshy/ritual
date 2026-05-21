import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { ensureCacheForCards } from '../../src/cache/ensure-cards'
import { BULK_FETCH_THRESHOLD, BULK_CACHE_MAX_AGE_MS } from '../../src/cache/constants'
import { InMemoryCacheManager, MemoryLogger, setLogger, resetLogger } from '../test-utils'
import type { ScryfallCard } from '../../src/types'

type CardCache = InMemoryCacheManager<ScryfallCard[]> & {
  _lastRefreshedAt: number | null
  getLastRefreshedAt(): Promise<number | null>
}

function createCardCache(): CardCache {
  const cache = new InMemoryCacheManager<ScryfallCard[]>(0) as CardCache
  cache._lastRefreshedAt = null
  cache.getLastRefreshedAt = async () => cache._lastRefreshedAt
  return cache
}

function makeCard(name: string): ScryfallCard {
  return {
    id: name,
    name,
    mana_cost: '',
    type_line: '',
    oracle_text: '',
    set: 'test',
    collector_number: '1',
    released_at: '2020-01-01',
    color_identity: [],
    prices: {},
  } as unknown as ScryfallCard
}

function makeCardNames(count: number): Set<string> {
  const names = new Set<string>()
  for (let i = 0; i < count; i++) {
    names.add(`Card ${i}`)
  }
  return names
}

function hasLogMessage(logger: MemoryLogger, substring: string): boolean {
  return logger.entries.some(
    (e) => e.level === 'info' && e.args.some((a) => String(a).includes(substring)),
  )
}

describe('ensureCacheForCards', () => {
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    resetLogger()
  })

  test('triggers preload when cache has never been bulk-downloaded', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = null
    let preloadCalled = false

    await ensureCacheForCards(new Set(['Sol Ring']), {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    expect(preloadCalled).toBe(true)
    expect(hasLogMessage(logger, 'never been bulk-downloaded')).toBe(true)
  })

  test('suppresses preload when allowBulk is false, even with an empty cache', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = null
    let preloadCalled = false

    const result = await ensureCacheForCards(
      new Set(['Sol Ring']),
      {
        cache,
        preload: async () => {
          preloadCalled = true
        },
      },
      { allowBulk: false },
    )

    expect(preloadCalled).toBe(false)
    expect(result.refreshed).toBe(false)
  })

  test('triggers preload when cache is older than a week', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = Date.now() - BULK_CACHE_MAX_AGE_MS - 1
    let preloadCalled = false

    await ensureCacheForCards(new Set(['Sol Ring']), {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    expect(preloadCalled).toBe(true)
    expect(hasLogMessage(logger, 'more than a week old')).toBe(true)
  })

  test('does not preload when cache is fresh and all cards are cached', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = Date.now()
    await cache.set('Sol Ring', [makeCard('Sol Ring')])
    let preloadCalled = false

    await ensureCacheForCards(new Set(['Sol Ring']), {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    expect(preloadCalled).toBe(false)
  })

  test('triggers preload when missing cards exceed threshold', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = Date.now()
    // Create BULK_FETCH_THRESHOLD + 1 names, cache none of them
    const names = makeCardNames(BULK_FETCH_THRESHOLD + 1)
    let preloadCalled = false

    await ensureCacheForCards(names, {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    // Over BULK_FETCH_THRESHOLD are missing, should preload
    expect(preloadCalled).toBe(true)
  })

  test('triggers preload when more than threshold cards are missing', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = Date.now()
    const names = makeCardNames(BULK_FETCH_THRESHOLD + 2)
    // Leave all uncached
    let preloadCalled = false

    await ensureCacheForCards(names, {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    expect(preloadCalled).toBe(true)
    expect(hasLogMessage(logger, `Over ${BULK_FETCH_THRESHOLD} cards not found`)).toBe(true)
  })

  test('does not preload when just under threshold cards are missing', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = Date.now()
    const names = makeCardNames(BULK_FETCH_THRESHOLD)
    // Leave all uncached — exactly at threshold (not over)
    let preloadCalled = false

    await ensureCacheForCards(names, {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    expect(preloadCalled).toBe(false)
  })

  test('skips missing-card check when cache age triggers refresh', async () => {
    const cache = createCardCache()
    cache._lastRefreshedAt = null // Never refreshed
    let preloadCalled = false
    let getCalled = false
    const origGet = cache.get.bind(cache)
    cache.get = async (key: string) => {
      getCalled = true
      return origGet(key)
    }

    await ensureCacheForCards(makeCardNames(5), {
      cache,
      preload: async () => {
        preloadCalled = true
      },
    })

    // Should preload due to age, not bother checking individual cards
    expect(preloadCalled).toBe(true)
    expect(getCalled).toBe(false)
  })
})
