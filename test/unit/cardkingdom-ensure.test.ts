import { describe, expect, test } from 'bun:test'
import {
  CARDKINGDOM_FEED_MAX_AGE_MS,
  cardKingdomFeedIsStale,
  ensureCardKingdomFeed,
  parseCardKingdomCacheFile,
  type CardKingdomCacheFile,
  type EnsureCardKingdomFeedDeps,
} from '../../src/cardkingdom'
import type { HttpClient } from '../../src/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../src/logger'
import { makeCardKingdomCacheFile, makeCardKingdomProduct } from '../test-utils'

const NOW = 1_785_850_800_000

const FEED_JSON = {
  meta: { created_at: '2026-08-04 06:06:09', base_url: 'https://www.cardkingdom.com/' },
  data: [
    {
      id: 1,
      sku: 'TST-0001',
      scryfall_id: 'sf-1',
      url: 'mtg/test/one',
      name: 'Test Card',
      variation: '',
      edition: 'Test Set',
      is_foil: 'false',
      price_retail: '1.00',
      qty_retail: 3,
      price_buy: '0.50',
      qty_buying: 10,
    },
  ],
}

function cachedFile(retrievedAt: number): CardKingdomCacheFile {
  return makeCardKingdomCacheFile([makeCardKingdomProduct()], retrievedAt)
}

const okHttp: HttpClient = { fetch: async () => Response.json(FEED_JSON) }
const failHttp: HttpClient = {
  fetch: async () => new Response('nope', { status: 503 }),
}

type Recorded = { saved: CardKingdomCacheFile[]; confirms: string[] }

function deps(
  cached: CardKingdomCacheFile | null,
  overrides: Partial<EnsureCardKingdomFeedDeps> = {},
  answer = false,
): { deps: EnsureCardKingdomFeedDeps; recorded: Recorded } {
  const recorded: Recorded = { saved: [], confirms: [] }
  return {
    recorded,
    deps: {
      http: okHttp,
      load: async () => cached,
      save: async (file) => {
        recorded.saved.push(file)
      },
      confirm: async (prompt) => {
        recorded.confirms.push(prompt.message)
        return answer
      },
      now: () => NOW,
      ...overrides,
    },
  }
}

/** The gate logs through getLogger(); keep test output clean and inspectable. */
function withQuietLogger<T>(run: () => Promise<T>): Promise<T> {
  setLogger(new MemoryLogger())
  return run().finally(resetLogger)
}

describe('cardKingdomFeedIsStale', () => {
  test('flips exactly past the max age', () => {
    expect(cardKingdomFeedIsStale(NOW - CARDKINGDOM_FEED_MAX_AGE_MS, NOW)).toBe(false)
    expect(cardKingdomFeedIsStale(NOW - CARDKINGDOM_FEED_MAX_AGE_MS - 1, NOW)).toBe(true)
  })
})

describe('ensureCardKingdomFeed', () => {
  test('a fresh cache is used without downloading or prompting', async () => {
    const { deps: d, recorded } = deps(cachedFile(NOW - 1000))
    const result = await withQuietLogger(() => ensureCardKingdomFeed('ask', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(false)
    expect(result.retrievedAt).toBe(NOW - 1000)
    expect(recorded.saved).toEqual([])
    expect(recorded.confirms).toEqual([])
  })

  test('a stale cache redownloads under auto and saves the result', async () => {
    const { deps: d, recorded } = deps(cachedFile(NOW - 2 * CARDKINGDOM_FEED_MAX_AGE_MS))
    const result = await withQuietLogger(() => ensureCardKingdomFeed('auto', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(true)
    expect(result.retrievedAt).toBe(NOW)
    expect(result.feed.createdAt).toBe('2026-08-04 06:06:09')
    expect(recorded.saved).toHaveLength(1)
  })

  test('declining the stale-cache prompt keeps the stale feed', async () => {
    const stale = cachedFile(NOW - 2 * CARDKINGDOM_FEED_MAX_AGE_MS)
    const { deps: d, recorded } = deps(stale, {}, false)
    const result = await withQuietLogger(() => ensureCardKingdomFeed('ask', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(false)
    expect(result.feed).toEqual(stale.feed)
    expect(recorded.confirms).toHaveLength(1)
  })

  test('never/no-bulk use a stale cache silently', async () => {
    for (const mode of ['never', 'no-bulk'] as const) {
      const { deps: d, recorded } = deps(cachedFile(NOW - 2 * CARDKINGDOM_FEED_MAX_AGE_MS))
      const result = await withQuietLogger(() => ensureCardKingdomFeed(mode, d))
      if (typeof result === 'string') throw new Error(result)
      expect(result.refreshed).toBe(false)
      expect(recorded.confirms).toEqual([])
    }
  })

  test('a missing cache refuses under never/no-bulk with the remedy', async () => {
    for (const mode of ['never', 'no-bulk'] as const) {
      const { deps: d } = deps(null)
      const result = await withQuietLogger(() => ensureCardKingdomFeed(mode, d))
      expect(result).toContain('--refresh auto')
    }
  })

  test('a missing cache downloads under ask when accepted, refuses when declined', async () => {
    const accepted = deps(null, {}, true)
    const result = await withQuietLogger(() => ensureCardKingdomFeed('ask', accepted.deps))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(true)

    const declined = deps(null, {}, false)
    const refused = await withQuietLogger(() => ensureCardKingdomFeed('ask', declined.deps))
    expect(refused).toContain('--refresh auto')
  })

  test('a failed download falls back to the stale cache, reporting the failure', async () => {
    const stale = cachedFile(NOW - 2 * CARDKINGDOM_FEED_MAX_AGE_MS)
    const { deps: d } = deps(stale, { http: failHttp })
    const result = await withQuietLogger(() => ensureCardKingdomFeed('auto', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(false)
    expect(result.feed).toEqual(stale.feed)
    // The failure travels on the result, not only into the log — the admin
    // refresh route reads it into its warnings.
    expect(result.staleFallback).toContain('HTTP 503')
  })

  test('a clean run carries no staleFallback', async () => {
    const { deps: d } = deps(cachedFile(NOW - 1000))
    const result = await withQuietLogger(() => ensureCardKingdomFeed('ask', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.staleFallback).toBeUndefined()
  })

  test('a failed download with no cache at all is the refusal', async () => {
    const { deps: d } = deps(null, { http: failHttp })
    const result = await withQuietLogger(() => ensureCardKingdomFeed('auto', d))
    expect(result).toContain('HTTP 503')
  })

  test('force redownloads a fresh cache under auto', async () => {
    const { deps: d, recorded } = deps(cachedFile(NOW - 1000), { force: true })
    const result = await withQuietLogger(() => ensureCardKingdomFeed('auto', d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(true)
    expect(recorded.saved).toHaveLength(1)
  })
})

describe('parseCardKingdomCacheFile', () => {
  test('round-trips a valid cache file', () => {
    const file = cachedFile(NOW)
    const parsed = parseCardKingdomCacheFile(JSON.parse(JSON.stringify(file)))
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.file).toEqual(file)
    expect(parsed.warnings).toEqual([])
  })

  test('rejects a broken envelope', () => {
    expect(parseCardKingdomCacheFile(null)).toStartWith('Invalid Card Kingdom cache')
    expect(parseCardKingdomCacheFile({ feed: {} })).toContain('missing numeric retrievedAt')
    expect(parseCardKingdomCacheFile({ retrievedAt: 1 })).toContain('missing feed object')
  })

  test('drops malformed product rows with a warning', () => {
    const file = cachedFile(NOW)
    const json = JSON.parse(JSON.stringify(file)) as {
      feed: { products: unknown[] }
    }
    json.feed.products.push({ id: 'broken' })
    const parsed = parseCardKingdomCacheFile(json)
    if (typeof parsed === 'string') throw new Error(parsed)
    expect(parsed.file.feed.products).toHaveLength(1)
    expect(parsed.warnings[0]).toContain('Dropped 1')
  })
})
