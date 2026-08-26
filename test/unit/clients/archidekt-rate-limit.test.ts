import { describe, test, expect, afterEach } from 'bun:test'
import {
  ArchidektClient,
  createArchidektPacer,
  createPacedArchidektClient,
  parseRetryAfterMs,
  ARCHIDEKT_RATE_LIMIT_PER_MIN,
  BACKOFF_CAP_MS,
  DEFAULT_MIN_REQUEST_INTERVAL_MS,
  RATE_LIMIT_MAX_RETRIES,
  type ArchidektClientOptions,
} from '../../../src/clients/ArchidektClient'
import {
  ARCHIDEKT_BULK_BATCH_SIZE,
  ARCHIDEKT_CSV_CHUNK_SIZE,
} from '../../../src/importers/archidekt-collection'
import type { RateLimitWait } from '../../../src/sync/common'

/**
 * The client's rate limiting: request pacing (`minRequestIntervalMs`) and the
 * 429 retry loop. Every test injects the clock and timer seams, so nothing here
 * actually sleeps — a recorded sleep advances the fake clock instead. The clock
 * is epoch-seeded because the seam's contract is epoch milliseconds (the
 * Retry-After HTTP-date branch subtracts it from a parsed absolute date).
 */

const EPOCH = Date.parse('2026-07-26T12:00:00Z')

type FakeTimeline = {
  now: () => number
  sleep: (ms: number) => Promise<void>
  advance: (ms: number) => void
  /** Every wait the client took, in order. */
  sleeps: number[]
}

function fakeTimeline(): FakeTimeline {
  let t = EPOCH
  const sleeps: number[] = []
  return {
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms)
      t += ms
      return Promise.resolve()
    },
    advance: (ms: number) => {
      t += ms
    },
    sleeps,
  }
}

const DECKS_BODY = JSON.stringify({ results: [] })

const ok = (): Response => new Response(DECKS_BODY, { status: 200 })
const okDelete = (): Response => new Response(null, { status: 204 })
/** An upload/v2 response whose row results are ignored here (pacing is the subject). */
const okUpload = (): Response => new Response(JSON.stringify({ data: [] }), { status: 200 })
const tooMany = (headers?: Record<string, string>): Response =>
  new Response('slow down', { status: 429, headers })

type RecordedRequest = { url: string; body: string | undefined; at: number }

type Harness = {
  client: ArchidektClient
  timeline: FakeTimeline
  /** Each request's URL, JSON body, and clock offset from the harness's start. */
  requests: RecordedRequest[]
  waits: RateLimitWait[]
}

type HarnessSetup = {
  /** Responses served in order; the last one repeats. */
  responses: (() => Response)[]
  options?: Omit<ArchidektClientOptions, 'now' | 'sleep' | 'onRateLimitWait'>
  /** Fake clock consumed by each request, so pacing-from-request-START is observable. */
  latencyMs?: number
}

/**
 * A client wired entirely to fakes. The `now`/`sleep` seams are not optional
 * here on purpose: omitting them in a test would silently switch it to real
 * timers (a wall-clock pacing wait per request, and over a minute of backoff in
 * the budget tests).
 */
function harness({ responses, options, latencyMs = 0 }: HarnessSetup): Harness {
  const timeline = fakeTimeline()
  const requests: RecordedRequest[] = []
  const waits: RateLimitWait[] = []
  let index = 0
  const client = new ArchidektClient(
    {
      fetch: (url, init): Promise<Response> => {
        requests.push({
          url: String(url),
          body: typeof init?.body === 'string' ? init.body : undefined,
          at: timeline.now() - EPOCH,
        })
        timeline.advance(latencyMs)
        const make = responses.at(Math.min(index, responses.length - 1))!
        index++
        return Promise.resolve(make())
      },
    },
    {
      ...options,
      // A fresh pacer per harness: the default is process-wide, and tests must
      // not pace against each other's clocks.
      pacer: createArchidektPacer(),
      now: timeline.now,
      sleep: timeline.sleep,
      onRateLimitWait: (wait) => waits.push(wait),
    },
  )
  return { client, timeline, requests, waits }
}

const requestTimes = (h: Harness): number[] => h.requests.map((r) => r.at)

const ENV_KEY = 'RITUAL_ARCHIDEKT_MIN_INTERVAL_MS'
const priorEnv = process.env[ENV_KEY]

afterEach(() => {
  if (priorEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = priorEnv
})

describe('parseRetryAfterMs', () => {
  test('parses delta-seconds', () => {
    expect(parseRetryAfterMs('3', EPOCH)).toBe(3000)
    expect(parseRetryAfterMs(' 10 ', EPOCH)).toBe(10_000)
  })

  test('parses a future HTTP-date relative to now', () => {
    expect(parseRetryAfterMs(new Date(EPOCH + 5000).toUTCString(), EPOCH)).toBe(5000)
  })

  test('a zero or past wait is no hint at all, so the backoff applies', () => {
    expect(parseRetryAfterMs('0', EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs(new Date(EPOCH - 5000).toUTCString(), EPOCH)).toBeUndefined()
  })

  test('caps both forms at sixty seconds', () => {
    expect(parseRetryAfterMs('600', EPOCH)).toBe(60_000)
    expect(parseRetryAfterMs(new Date(EPOCH + 300_000).toUTCString(), EPOCH)).toBe(60_000)
  })

  test('missing, blank, or unparseable headers fall back to undefined', () => {
    expect(parseRetryAfterMs(null, EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs('', EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs('   ', EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs('soon', EPOCH)).toBeUndefined()
  })

  test('numeric-looking non-integers never reach the lenient date parser', () => {
    expect(parseRetryAfterMs('3.5', EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs('-3', EPOCH)).toBeUndefined()
    expect(parseRetryAfterMs('1e3', EPOCH)).toBeUndefined()
  })
})

describe('request pacing', () => {
  test('the default interval targets half the observed limit, rounded toward slower', () => {
    expect(DEFAULT_MIN_REQUEST_INTERVAL_MS).toBe(1500)
    // The headroom rule as an inequality, so it survives a future retune of
    // the measured limit: one pacer never claims more than half of it.
    expect(60_000 / DEFAULT_MIN_REQUEST_INTERVAL_MS).toBeLessThanOrEqual(
      ARCHIDEKT_RATE_LIMIT_PER_MIN / 2,
    )
  })

  test('spaces request STARTS by the interval, first request free', async () => {
    // 120ms of transport latency eats into the interval: the next wait is only
    // the remainder, proving lastRequestAt is stamped before the fetch.
    const h = harness({ responses: [ok], options: { minRequestIntervalMs: 500 }, latencyMs: 120 })

    await h.client.fetchPublicDecks('user1')
    await h.client.fetchPublicDecks('user1')
    await h.client.fetchPublicDecks('user1')

    expect(h.timeline.sleeps).toEqual([380, 380])
    expect(requestTimes(h)).toEqual([0, 500, 1000])
  })

  const intervalCases: {
    name: string
    env: string | undefined
    option: number | undefined
    expectedWait: number | null
  }[] = [
    {
      name: 'no option and no env → the built-in default',
      env: undefined,
      option: undefined,
      expectedWait: DEFAULT_MIN_REQUEST_INTERVAL_MS,
    },
    {
      name: 'the env interval applies when no option is given',
      env: '250',
      option: undefined,
      expectedWait: 250,
    },
    { name: 'an explicit option beats the env', env: '250', option: 100, expectedWait: 100 },
    { name: 'env 0 disables pacing', env: '0', option: undefined, expectedWait: null },
    {
      name: 'a malformed env value is ignored',
      env: 'soon',
      option: undefined,
      expectedWait: DEFAULT_MIN_REQUEST_INTERVAL_MS,
    },
    {
      name: 'a negative env value is ignored',
      env: '-5',
      option: undefined,
      expectedWait: DEFAULT_MIN_REQUEST_INTERVAL_MS,
    },
    {
      name: 'a blank env value is ignored',
      env: '  ',
      option: undefined,
      expectedWait: DEFAULT_MIN_REQUEST_INTERVAL_MS,
    },
  ]

  for (const { name, env, option, expectedWait } of intervalCases) {
    test(name, async () => {
      if (env === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = env
      const h = harness({ responses: [ok], options: { minRequestIntervalMs: option } })

      await h.client.fetchPublicDecks('user1')
      await h.client.fetchPublicDecks('user1')

      expect(h.timeline.sleeps).toEqual(expectedWait === null ? [] : [expectedWait])
      expect(requestTimes(h)).toEqual(expectedWait === null ? [0, 0] : [0, expectedWait])
    })
  }

  test('an invalid explicit interval throws instead of silently disabling pacing', () => {
    expect(() =>
      harness({ responses: [ok], options: { minRequestIntervalMs: Number.NaN } }),
    ).toThrow(/minRequestIntervalMs/)
    expect(() =>
      harness({ responses: [ok], options: { minRequestIntervalMs: Number.POSITIVE_INFINITY } }),
    ).toThrow(/minRequestIntervalMs/)
    expect(() => harness({ responses: [ok], options: { minRequestIntervalMs: -1 } })).toThrow(
      /minRequestIntervalMs/,
    )
  })

  test('two clients sharing one pacer pace against each other', async () => {
    const timeline = fakeTimeline()
    const pacer = createArchidektPacer()
    const starts: number[] = []
    const makeClient = (): ArchidektClient =>
      new ArchidektClient(
        {
          fetch: (): Promise<Response> => {
            starts.push(timeline.now() - EPOCH)
            return Promise.resolve(ok())
          },
        },
        { minRequestIntervalMs: 500, pacer, now: timeline.now, sleep: timeline.sleep },
      )
    const a = makeClient()
    const b = makeClient()

    await a.fetchPublicDecks('user1')
    await b.fetchPublicDecks('user1')
    await a.fetchPublicDecks('user1')

    // Were pacing per-instance, each client's first request would go out
    // immediately; the shared pacer spaces the combined traffic instead.
    expect(starts).toEqual([0, 500, 1000])
  })

  test('bulk deletes pace between batches too', async () => {
    const h = harness({ responses: [okDelete], options: { minRequestIntervalMs: 500 } })

    await h.client.deleteCollectionRecords(
      Array.from({ length: ARCHIDEKT_BULK_BATCH_SIZE * 2 + 1 }, (_, i) => i + 1),
      'token',
    )

    expect(h.requests).toHaveLength(3)
    expect(h.timeline.sleeps).toEqual([500, 500])
  })

  test('CSV chunk uploads pace between chunks too', async () => {
    // The whole point of the CSV path is to stop hammering the API, so its own
    // chunk posts must go through the same pacing funnel as everything else.
    const h = harness({ responses: [okUpload], options: { minRequestIntervalMs: 500 } })
    const rows = Array.from(
      { length: ARCHIDEKT_CSV_CHUNK_SIZE * 2 + 1 },
      (_, i) => `uid-${i + 1},1,Normal,NM`,
    )

    await h.client.uploadCollectionCsv(
      ['Scryfall ID,Quantity,Variant,Condition', ...rows].join('\n'),
      { columns: ['uid', 'quantity', 'modifier', 'condition'], header: true },
      'token',
    )

    expect(h.requests).toHaveLength(3)
    expect(h.requests.map((r) => r.url)).toEqual(
      Array.from({ length: 3 }, () => 'https://archidekt.com/api/collection/upload/v2/'),
    )
    expect(h.timeline.sleeps).toEqual([500, 500])
  })
})

describe('429 handling', () => {
  test('the cap sits above the whole curve, so it only guards a bigger retry budget', () => {
    const curve = Array.from({ length: RATE_LIMIT_MAX_RETRIES }, (_, i) => 2000 * 2 ** i)
    expect(Math.max(...curve)).toBeLessThanOrEqual(BACKOFF_CAP_MS)
  })

  test('retries with exponential backoff and reports each wait', async () => {
    const h = harness({
      responses: [tooMany, tooMany, ok],
      options: { minRequestIntervalMs: 0 },
    })

    const decks = await h.client.fetchPublicDecks('user1')

    expect(decks).toEqual([])
    expect(h.requests).toHaveLength(3)
    expect(h.timeline.sleeps).toEqual([2000, 4000])
    expect(h.waits).toEqual([
      { waitMs: 2000, retry: 1, maxRetries: RATE_LIMIT_MAX_RETRIES },
      { waitMs: 4000, retry: 2, maxRetries: RATE_LIMIT_MAX_RETRIES },
    ])
  })

  test('honors Retry-After over the computed backoff, and reports it', async () => {
    // 'Retry-After' vs the client's 'retry-after' read also pins Headers.get's
    // case-insensitivity — do not "fix" the casing to match.
    const h = harness({
      responses: [() => tooMany({ 'Retry-After': '3' }), ok],
      options: { minRequestIntervalMs: 0 },
    })

    await h.client.fetchPublicDecks('user1')

    expect(h.timeline.sleeps).toEqual([3000])
    expect(h.waits).toEqual([{ waitMs: 3000, retry: 1, maxRetries: RATE_LIMIT_MAX_RETRIES }])
  })

  test('a Retry-After naming no usable wait falls back to the backoff', async () => {
    const h = harness({
      responses: [() => tooMany({ 'Retry-After': '0' }), ok],
      options: { minRequestIntervalMs: 0 },
    })

    await h.client.fetchPublicDecks('user1')

    expect(h.timeline.sleeps).toEqual([2000])
  })

  test('a 429 outliving the retry budget fails with the full backoff curve behind it', async () => {
    const h = harness({ responses: [tooMany], options: { minRequestIntervalMs: 0 } })

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(h.client.fetchPublicDecks('user1')).rejects.toThrow(/429/)
    expect(h.requests).toHaveLength(RATE_LIMIT_MAX_RETRIES + 1)
    expect(h.timeline.sleeps).toEqual([2000, 4000, 8000, 16_000, 32_000])
    expect(h.waits).toHaveLength(RATE_LIMIT_MAX_RETRIES)
  })

  test('a throwing observer does not fail the request', async () => {
    const timeline = fakeTimeline()
    let index = 0
    const responses = [tooMany, ok]
    const client = new ArchidektClient(
      { fetch: () => Promise.resolve(responses.at(Math.min(index++, 1))!()) },
      {
        minRequestIntervalMs: 0,
        now: timeline.now,
        sleep: timeline.sleep,
        onRateLimitWait: () => {
          throw new Error('observer bug')
        },
      },
    )

    expect(await client.fetchPublicDecks('user1')).toEqual([])
  })

  test('pacing tops up a backoff shorter than the interval', async () => {
    const h = harness({ responses: [tooMany, ok], options: { minRequestIntervalMs: 5000 } })

    await h.client.fetchPublicDecks('user1')

    // The 2s backoff runs first; the retry then waits out the interval's
    // remaining 3s, so request starts stay a full interval apart.
    expect(h.timeline.sleeps).toEqual([2000, 3000])
    expect(requestTimes(h)).toEqual([0, 5000])
  })

  test('a backoff longer than the interval subsumes the pacing wait', async () => {
    const h = harness({ responses: [tooMany, ok], options: { minRequestIntervalMs: 100 } })

    await h.client.fetchPublicDecks('user1')

    expect(h.timeline.sleeps).toEqual([2000])
    expect(requestTimes(h)).toEqual([0, 2000])
  })

  test('a backoff exactly the interval leaves no pacing remainder to sleep', async () => {
    // The wait > 0 edge in pace(): a computed remainder of exactly zero must
    // not record a zero-length sleep.
    const h = harness({ responses: [tooMany, ok], options: { minRequestIntervalMs: 2000 } })

    await h.client.fetchPublicDecks('user1')

    expect(h.timeline.sleeps).toEqual([2000])
    expect(requestTimes(h)).toEqual([0, 2000])
  })

  test('a rate-limited write retries the SAME request, then continues the batches', async () => {
    const h = harness({
      responses: [tooMany, okDelete, okDelete, okDelete],
      options: { minRequestIntervalMs: 0 },
    })
    const ids = Array.from({ length: ARCHIDEKT_BULK_BATCH_SIZE * 2 + 1 }, (_, i) => i + 1)

    await h.client.deleteCollectionRecords(ids, 'token')

    expect(h.requests).toHaveLength(4)
    // The retry resends batch 1 verbatim; batches 2 and 3 follow once.
    expect(h.requests[1]).toMatchObject({ url: h.requests[0]!.url, body: h.requests[0]!.body })
    const batches = h.requests.slice(1).map((r) => (JSON.parse(r.body!) as { ids: number[] }).ids)
    expect(batches).toEqual([
      ids.slice(0, ARCHIDEKT_BULK_BATCH_SIZE),
      ids.slice(ARCHIDEKT_BULK_BATCH_SIZE, ARCHIDEKT_BULK_BATCH_SIZE * 2),
      ids.slice(ARCHIDEKT_BULK_BATCH_SIZE * 2),
    ])
  })
})

describe('createPacedArchidektClient', () => {
  test('reports 429 waits as the shared human-readable line', async () => {
    const timeline = fakeTimeline()
    const messages: string[] = []
    const priorFetch = globalThis.fetch
    let first = true
    globalThis.fetch = ((_input: string | URL | Request, _init?: RequestInit) => {
      const response = first ? tooMany() : ok()
      first = false
      return Promise.resolve(response)
    }) as typeof globalThis.fetch
    try {
      const client = createPacedArchidektClient((message) => messages.push(message), {
        minRequestIntervalMs: 0,
        now: timeline.now,
        sleep: timeline.sleep,
      })
      await client.fetchPublicDecks('user1')
    } finally {
      globalThis.fetch = priorFetch
    }

    expect(messages).toEqual(['Rate limited by Archidekt — waiting 2s before retry 1 of 5.'])
  })
})
