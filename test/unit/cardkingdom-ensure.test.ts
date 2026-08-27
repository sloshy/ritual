import { describe, expect, test } from 'bun:test'
import {
  ensureCardKingdomFeed,
  parseCardKingdomCacheFile,
  sellModeWarning,
  warmCardKingdomFeed,
  type BuylistWarmth,
  type CardKingdomCacheFile,
  type EnsureCardKingdomFeedDeps,
  type WarmCardKingdomFeedDeps,
} from '../../src/cardkingdom'
import { BUYLIST_FEED_MAX_AGE_MS } from '../../src/buylist'
import { headlessPolicy, type RefreshMode, type RefreshPolicy } from '../../src/cache/refresh'
import type { HttpClient } from '../../src/util/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../src/util/logger'
import {
  cardKingdomFeedBody,
  makeCardKingdomCacheFile,
  makeCardKingdomProduct,
} from '../test-utils'

const NOW = 1_785_850_800_000

/**
 * Deliberately a different generation stamp than `makeCardKingdomCacheFile`'s
 * (2026-08-04): it is what tells a downloaded feed from the cached one.
 */
const FEED_JSON = cardKingdomFeedBody(undefined, '2026-08-05 06:06:09')

function cachedFile(retrievedAt: number): CardKingdomCacheFile {
  return makeCardKingdomCacheFile([makeCardKingdomProduct()], retrievedAt)
}

const okHttp: HttpClient = { fetch: async () => Response.json(FEED_JSON) }
const failHttp: HttpClient = {
  fetch: async () => new Response('nope', { status: 503 }),
}
/** For tests where a download must be impossible: reaching the network is the bug. */
const noNetHttp: HttpClient = {
  fetch: async () => {
    throw new Error('unexpected network call')
  },
}

type Recorded = { saved: CardKingdomCacheFile[]; confirms: string[] }

/** A deps bag plus the calls it records. */
type EnsureDepsFixture = {
  deps: EnsureCardKingdomFeedDeps
  recorded: Recorded
  /** The fixture's recording confirm under a mode. */
  policy: (mode: RefreshMode) => RefreshPolicy
}

function deps(
  cached: CardKingdomCacheFile | null,
  overrides: Partial<EnsureCardKingdomFeedDeps> = {},
  answer = false,
): EnsureDepsFixture {
  const recorded: Recorded = { saved: [], confirms: [] }
  return {
    recorded,
    policy: (mode) => ({
      mode,
      confirm: async (prompt) => {
        recorded.confirms.push(prompt.message)
        return answer
      },
    }),
    deps: {
      http: okHttp,
      load: async () => cached,
      save: async (file) => {
        recorded.saved.push(file)
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

// `buylistFeedIsStale` moved to src/buylist/freshness.ts; its max-age boundary
// is pinned once, beside the module that owns it, in
// test/unit/site/buylist-seed.test.ts.

describe('ensureCardKingdomFeed', () => {
  test('a fresh cache is used without downloading or prompting', async () => {
    const { deps: d, recorded, policy } = deps(cachedFile(NOW - 1000))
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('ask'), d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(false)
    expect(result.retrievedAt).toBe(NOW - 1000)
    expect(recorded.saved).toEqual([])
    expect(recorded.confirms).toEqual([])
  })

  test('a stale cache redownloads under auto and saves the result', async () => {
    const { deps: d, recorded, policy } = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS))
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('auto'), d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(true)
    expect(result.retrievedAt).toBe(NOW)
    expect(result.feed.createdAt).toBe('2026-08-05 06:06:09')
    expect(recorded.saved).toHaveLength(1)
  })

  test('a stale cache is redownloaded under ask without prompting', async () => {
    const {
      deps: d,
      recorded,
      policy,
    } = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS), {}, false)
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('ask'), d))
    if (typeof result === 'string') throw new Error(result)
    // Card Kingdom regenerates daily, so a stale feed quotes yesterday's
    // offers; keeping it current is not a question worth asking every run.
    // (The `false` confirm answer above would have declined, had it been asked.)
    expect(result.refreshed).toBe(true)
    expect(result.retrievedAt).toBe(NOW)
    expect(recorded.confirms).toEqual([])
  })

  test('never/no-bulk use a stale cache silently', async () => {
    for (const mode of ['never', 'no-bulk'] as const) {
      const { deps: d, recorded, policy } = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS))
      const result = await withQuietLogger(() => ensureCardKingdomFeed(policy(mode), d))
      if (typeof result === 'string') throw new Error(result)
      expect(result.refreshed).toBe(false)
      expect(recorded.confirms).toEqual([])
    }
  })

  test('a missing cache refuses under never/no-bulk with the remedy', async () => {
    for (const mode of ['never', 'no-bulk'] as const) {
      const { deps: d, policy } = deps(null)
      const result = await withQuietLogger(() => ensureCardKingdomFeed(policy(mode), d))
      expect(result).toContain('--refresh auto')
    }
  })

  test('a missing cache downloads under ask when accepted, refuses when declined', async () => {
    const accepted = deps(null, {}, true)
    const result = await withQuietLogger(() =>
      ensureCardKingdomFeed(accepted.policy('ask'), accepted.deps),
    )
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(true)

    const declined = deps(null, {}, false)
    const refused = await withQuietLogger(() =>
      ensureCardKingdomFeed(declined.policy('ask'), declined.deps),
    )
    expect(refused).toContain('--refresh auto')
  })

  test('a failed download falls back to the stale cache, reporting the failure', async () => {
    const stale = cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS)
    const { deps: d, policy } = deps(stale, { http: failHttp })
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('auto'), d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.refreshed).toBe(false)
    // The cached feed, not the downloaded one — the two carry different
    // generation stamps, so this distinguishes a fallback from a success.
    expect(result.feed).toEqual(stale.feed)
    // The failure travels on the result, not only into the log — the admin
    // refresh route reads it into its warnings.
    expect(result.staleFallback).toContain('HTTP 503')
  })

  test('a clean run carries no staleFallback', async () => {
    const { deps: d, policy } = deps(cachedFile(NOW - 1000))
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('ask'), d))
    if (typeof result === 'string') throw new Error(result)
    expect(result.staleFallback).toBeUndefined()
  })

  test('a failed download with no cache at all is the refusal', async () => {
    const { deps: d, policy } = deps(null, { http: failHttp })
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('auto'), d))
    expect(result).toContain('HTTP 503')
  })

  test('force redownloads a fresh cache under auto', async () => {
    const { deps: d, recorded, policy } = deps(cachedFile(NOW - 1000), { force: true })
    const result = await withQuietLogger(() => ensureCardKingdomFeed(policy('auto'), d))
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

/**
 * The startup gate the servers run. Both quote surfaces (admin, `serve --api`)
 * answer from the cached feed and never download per request, so this is the
 * only thing keeping a long-lived server off yesterday's offers — and it must
 * do that without ever prompting or downloading a first feed, since a server
 * start cannot block on a question.
 */
describe('warmCardKingdomFeed', () => {
  /** Warm with sell mode forced on — the server-start case every test here is. */
  function warm(
    mode: RefreshMode,
    fixture: EnsureDepsFixture,
    overrides: Partial<WarmCardKingdomFeedDeps> = {},
  ): Promise<BuylistWarmth> {
    return withQuietLogger(() =>
      warmCardKingdomFeed(fixture.policy(mode), { ...fixture.deps, sellMode: true, ...overrides }),
    )
  }

  test('refreshes a stale feed and indexes what it downloaded', async () => {
    const fixture = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS))
    const adopted: number[] = []

    const warmth = await warm('ask', fixture, {
      adopt: async (file) => adopted.push(file.retrievedAt),
    })

    expect(warmth).toStrictEqual({ enabled: true, ready: true, refreshed: true })
    expect(fixture.recorded.saved).toHaveLength(1)
    // The downloaded feed, not the stale one already on disk — and indexed here
    // so the first quote request does not pay to parse ~20 MB.
    expect(adopted).toEqual([NOW])
  })

  test('leaves a fresh feed alone, indexing nothing', async () => {
    const fixture = deps(cachedFile(NOW - 1000), { http: noNetHttp })
    let adopts = 0

    const warmth = await warm('ask', fixture, { adopt: async () => adopts++ })

    expect(warmth).toStrictEqual({ enabled: true, ready: true, refreshed: false })
    expect(adopts).toBe(0)
  })

  test.each(['no-bulk', 'never'] as const)(
    '--refresh %s keeps the stale feed without downloading',
    async (mode) => {
      const fixture = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS), { http: noNetHttp })

      const warmth = await warm(mode, fixture)

      expect(warmth).toStrictEqual({ enabled: true, ready: true, refreshed: false })
      expect(fixture.recorded.saved).toEqual([])
    },
  )

  test('sell mode off checks nothing at all', async () => {
    const fixture = deps(null, { http: noNetHttp })
    let loads = 0

    const warmth = await withQuietLogger(() =>
      warmCardKingdomFeed(headlessPolicy('auto'), {
        ...fixture.deps,
        sellMode: false,
        load: async () => {
          loads++
          return null
        },
      }),
    )

    expect(warmth).toStrictEqual({ enabled: false, ready: false, refreshed: false })
    expect(loads).toBe(0)
  })

  test('never downloads a first feed — a server start must not spend ~70 MB or ask', async () => {
    const fixture = deps(null, { http: noNetHttp })

    // `ask` is the default both servers run under, and the mode whose
    // missing-feed branch would prompt if the warm ever reached it. A cache
    // file that exists but cannot be read arrives here the same way — the load
    // reports it as null — which is why the warm gates on the load rather than
    // on the file being present (integration pins that end of the chain).
    const warmth = await warm('ask', fixture)

    expect(warmth).toStrictEqual({ enabled: true, ready: false, refreshed: false })
    expect(fixture.recorded.confirms).toEqual([])
    expect(fixture.recorded.saved).toEqual([])
  })

  test('a failed refresh keeps the stale feed and carries the reason', async () => {
    const fixture = deps(cachedFile(NOW - 2 * BUYLIST_FEED_MAX_AGE_MS), { http: failHttp })

    const warmth = await warm('auto', fixture)

    // Still servable — just from the older feed, and the caller says so.
    expect(warmth.ready).toBe(true)
    expect(warmth.refreshed).toBe(false)
    expect(warmth.problem).toContain('HTTP 503')
  })

  test('loads the feed once, then hands it to the gate', async () => {
    const fixture = deps(cachedFile(NOW - 1000), { http: noNetHttp })
    let loads = 0

    const warmth = await warm('ask', fixture, {
      load: async () => {
        loads++
        return cachedFile(NOW - 1000)
      },
    })

    // The ~20 MB parse is the reason: the gate reuses what the warm read.
    expect(loads).toBe(1)
    expect(warmth.ready).toBe(true)
  })
})

describe('sellModeWarning', () => {
  test('reports a refresh that failed', () => {
    expect(
      sellModeWarning({ enabled: true, ready: true, refreshed: false, problem: 'offline' }),
    ).toBe('Sell mode: offline')
  })

  test('says nothing about a workspace that simply has no buylist', () => {
    // Declining to download a first feed is a decision, not a failure, and the
    // admin forces sell mode on for every workspace — warning here would put a
    // line on every start for everyone who never sells.
    expect(sellModeWarning({ enabled: true, ready: false, refreshed: false })).toBeUndefined()
  })
})
