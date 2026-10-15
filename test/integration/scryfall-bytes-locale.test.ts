import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CACHE_LOCK_FILENAME } from '../../src/cache/lock'
import {
  preloadCache,
  preloadCacheFromFiles,
  refreshTags,
  scryfallClient,
} from '../../src/scryfall'
import { setupGlobalFetch } from '../../src/util/http'
import { MemoryLogger } from '../../src/util/logger'
import { bindWorkspace, snapshotTree } from '../helpers/workspace'
import type { StubbedFetch, StubbedRequest } from '../helpers/stub-fetch'
import { expectLocaleInForce, foreignLocales, withSyntheticLocaleAsync } from '../helpers/sync-text'
import { stubScryfallBulk } from './helpers/scryfall-bulk'
import {
  ART_TAGS_URI,
  BULK_META_URL,
  DEFAULT_CARDS_URI,
  ORACLE_TAGS_URI,
  bulkCard,
  bulkCards,
  gzipJsonLines,
  gzipJsonLinesResponse,
  resetLogger,
  setLogger,
} from '../test-utils'

/**
 * What the Scryfall client sends and stores is the same bytes in every UI
 * language.
 *
 * Its requests are a machine contract with Scryfall — URLs, query strings, the
 * `User-Agent` header, a JSON body — and what it writes is regenerable cache
 * data other processes read back: the card cache, `tags.json`, the bulk
 * provenance record, and the cache lock whose `operation` another Ritual
 * process quotes. Each run below refreshes the cache from a bulk download (tags
 * included), re-bakes the tags, ingests a cache feed's artifacts, fetches a
 * search page, a foreign-language printing, a fuzzy name and a price batch,
 * and records every request, every lock it held and every file — all of which
 * must match an English run.
 *
 * Nothing in these bytes is formatted today: the numbers in them are
 * `JSON.stringify`'s and the query string's, and the prices are Scryfall's own
 * strings. The German leg is a tripwire for the day a formatter is added to one
 * of these paths (a page number or a timestamp run through `Intl` would differ
 * there); the pseudo-locale leg catches any catalog text written into them.
 */

/** The fixed clock every run reads: `tags.json`, the lock and provenance stamp it. */
const NOW = new Date('2026-06-04T12:00:00.000Z')

/** One request as the pins compare it: what Scryfall would see. */
type SentRequest = {
  method: string
  url: string
  userAgent: string | null
  contentType: string | null
  body: string | null
}

/** Everything one run sent and wrote. */
type ScryfallRun = {
  requests: SentRequest[]
  locks: string[]
  files: Record<string, string>
}

/** The oracle and art tag bulks the refresh bakes onto each card. */
const ORACLE_TAGS = [
  {
    object: 'tag',
    id: 't-ramp',
    label: 'Ramp',
    slug: 'ramp',
    type: 'oracle',
    taggings: [{ oracle_id: 'o-sol' }, { oracle_id: 'o-bolt' }],
  },
]
const ART_TAGS = [
  {
    object: 'tag',
    id: 't-ring',
    label: 'Ring',
    slug: 'ring',
    type: 'illustration',
    taggings: [{ illustration_id: 'i-sol' }],
  },
]

function sentRequest(request: StubbedRequest): SentRequest {
  const headers = new Headers(request.init?.headers)
  const body = request.init?.body
  return {
    method: request.method,
    url: request.url,
    userAgent: headers.get('user-agent'),
    contentType: headers.get('content-type'),
    body: typeof body === 'string' ? body : null,
  }
}

/**
 * A logger that reads the cache lock each time a line is logged: every
 * lock-holding operation logs while it holds the lock, and another process
 * reads this very file.
 */
class LockReadingLogger extends MemoryLogger {
  readonly locks = new Set<string>()
  constructor(private readonly lockPath: string) {
    super()
  }
  override info(message?: unknown, ...optionalParams: unknown[]): void {
    if (existsSync(this.lockPath)) this.locks.add(readFileSync(this.lockPath, 'utf-8'))
    super.info(message, ...optionalParams)
  }
}

let stub: StubbedFetch

async function runScryfall(): Promise<ScryfallRun> {
  const ws = await bindWorkspace({ clearCardCache: true })
  const from = stub.sent.length
  const logger = new LockReadingLogger(path.join(ws.dir, 'cache', CACHE_LOCK_FILENAME))
  setLogger(logger)
  try {
    await preloadCache()
    await refreshTags()
    // A cache feed's artifacts, already on disk.
    const artifacts = path.join(ws.dir, 'artifacts')
    await fs.mkdir(artifacts)
    const file = async (name: string, values: unknown[]): Promise<string> => {
      const filePath = path.join(artifacts, name)
      await fs.writeFile(filePath, gzipJsonLines(values))
      return filePath
    }
    await preloadCacheFromFiles({
      cards: await file('cards.jsonl.gz', bulkCards()),
      cardBulkType: 'default_cards',
      oracleTags: await file('oracle.jsonl.gz', ORACLE_TAGS),
      artTags: await file('art.jsonl.gz', ART_TAGS),
    })
    // A second page, so a number rides in the query string.
    await scryfallClient.fetchSearchPage('t:artifact cmc>=2', 2, 'json')
    await scryfallClient.fetchPrintingByCollectorNumber('CMR', '472', 'ja')
    await scryfallClient.fetchNamedCard('sol rng', { fuzzy: true, set: 'cmr' })
    // A list of names in a JSON body.
    await scryfallClient.fetchLatestPrices(['Sol Ring', 'Lightning Bolt'], 'usd')
    return {
      requests: stub.sent.slice(from).map(sentRequest),
      locks: [...logger.locks],
      files: await snapshotTree(ws.dir),
    }
  } finally {
    resetLogger()
    await ws.dispose()
  }
}

describe('Scryfall requests and cache bytes under a foreign UI language (Integration)', () => {
  let english: ScryfallRun

  beforeAll(async () => {
    setSystemTime(NOW)
    stub = stubScryfallBulk({
      routes: {
        [ORACLE_TAGS_URI]: () => gzipJsonLinesResponse(ORACLE_TAGS),
        [ART_TAGS_URI]: () => gzipJsonLinesResponse(ART_TAGS),
        'https://api.scryfall.com/cards/search': () =>
          Response.json({ object: 'list', has_more: false, data: bulkCards() }),
        'https://api.scryfall.com/cards/cmr/472/ja': () =>
          Response.json(bulkCard({ id: 'sol-ja', lang: 'ja' })),
        'https://api.scryfall.com/cards/named': () => Response.json(bulkCard()),
        'https://api.scryfall.com/cards/collection': () =>
          Response.json({ object: 'list', data: bulkCards() }),
      },
    })
    // The production wrapper, over the stub: it is what sets the User-Agent.
    setupGlobalFetch()
    english = await runScryfall()
  })

  afterAll(() => {
    // Puts back the `fetch` from before the stub, the wrapper with it.
    stub.restore()
    setSystemTime()
  })

  test('the English run exercises every request, lock and file the pins are about', () => {
    // Vacuity guard: the runs below compare like for like only if the English
    // run made these requests, held these locks and wrote these files.
    expect(english.requests.map((request) => request.url)).toEqual([
      // The card bulk's manifest, then the tag download's own.
      BULK_META_URL,
      BULK_META_URL,
      ORACLE_TAGS_URI,
      ART_TAGS_URI,
      DEFAULT_CARDS_URI,
      // The tag re-bake.
      BULK_META_URL,
      ORACLE_TAGS_URI,
      ART_TAGS_URI,
      'https://api.scryfall.com/cards/search?q=t%3Aartifact%20cmc%3E%3D2&order=edhrec&page=2',
      'https://api.scryfall.com/cards/cmr/472/ja',
      'https://api.scryfall.com/cards/named?fuzzy=sol+rng&set=cmr',
      'https://api.scryfall.com/cards/collection',
    ])
    for (const request of english.requests) expect(request.userAgent).toStartWith('Ritual/')
    expect(english.requests.at(-1)).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
      body: '{"identifiers":[{"name":"Sol Ring"},{"name":"Lightning Bolt"}]}',
    })
    expect(english.locks.map((raw) => JSON.parse(raw) as unknown)).toEqual([
      expect.objectContaining({ operation: 'bulk card cache download', createdAt: NOW.getTime() }),
      expect.objectContaining({ operation: 'tag refresh', createdAt: NOW.getTime() }),
      expect.objectContaining({ operation: 'bulk card cache ingest', createdAt: NOW.getTime() }),
    ])

    const files = english.files
    expect(files['cache/tags.json']).toContain(`"updatedAt":${NOW.getTime()}`)
    expect(files['cache/tags.json']).toContain('"o-sol":["ramp"]')
    expect(files['cache/card-bulk.json']).toContain('default_cards')
    const cards = JSON.stringify(JSON.parse(files['cache/cache.json'] ?? '{}'))
    expect(cards).toContain(`"lastRefreshedAt":${NOW.getTime()}`)
    expect(cards).toContain('"oracleTags":["ramp"]')
    // The Japanese printing the language fetch added beside the bulk's one.
    expect(cards).toContain('"id":"sol-ja"')
    expect(cards).toContain('"usd":"1.50"')
  })

  test.each(foreignLocales())(
    'sends and writes the same bytes under $tag',
    async ({ tag, catalog }) => {
      const localized = await withSyntheticLocaleAsync(tag, catalog, async (locale) => {
        expectLocaleInForce(locale)
        const run = await runScryfall()
        expectLocaleInForce(locale)
        return run
      })
      expect(localized.requests).toEqual(english.requests)
      expect(localized.locks).toEqual(english.locks)
      expect(localized.files).toEqual(english.files)
    },
  )
})
