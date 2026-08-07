import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { ScryfallClient } from '../../../src/scryfall'
import type { ScryfallCard } from '../../../src/types'
import {
  MockHttpClient,
  InMemoryCacheManager,
  MemoryFileSystemClient,
  MemoryLogger,
  gzipJsonLinesResponse,
  makeScryfallCard,
  resetLogger,
  setLogger,
} from '../../test-utils'

const BULK_META_URL = 'https://api.scryfall.com/bulk-data'
const DEFAULT_URI = 'https://data.example/default-cards.jsonl.gz'

/** Only the card bulk is advertised — these tests assert card filtering, not tag baking. */
function bulkMetaResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ type: 'default_cards', jsonl_download_uri: DEFAULT_URI }] }),
  )
}

const REAL_PRINTING = makeScryfallCard({
  id: 'real-1',
  name: 'Ghalta, Primal Hunger',
  layout: 'normal',
  type_line: 'Legendary Creature — Elder Dinosaur',
  set: 'rix',
  collector_number: '130',
})

/**
 * A real print in a four-letter `a`-prefixed set — the shape art-series sets
 * happen to share. Keeping it pins that the filter keys on layout rather than
 * on the set code (which is what `isDigitalOnlySet` matches).
 */
const REAL_IN_A_SET = makeScryfallCard({
  id: 'real-2',
  name: 'Alrund, God of the Cosmos',
  layout: 'normal',
  set: 'akhm',
  collector_number: '1',
})

/** The oversized art-only print, which shares the real card's name. */
const ART_PRINTING = makeScryfallCard({
  id: 'art-1',
  name: 'Ghalta, Primal Hunger',
  layout: 'art_series',
  type_line: 'Card',
  set: 'arix',
  collector_number: '30',
})

/** An art print whose name exists nowhere else — the autocomplete noise this filter targets. */
const ART_ONLY_NAME = makeScryfallCard({
  id: 'art-2',
  name: 'Clearwater Pathway // Clearwater Pathway',
  layout: 'art_series',
  type_line: 'Card // Card',
  set: 'aznr',
  collector_number: '25',
})

const TOKEN_PRINTING = makeScryfallCard({
  id: 'token-1',
  name: 'Dinosaur',
  layout: 'token',
  type_line: 'Token Creature — Dinosaur',
  set: 'trix',
  collector_number: '9',
})

/**
 * A Japanese object of the same printing as REAL_PRINTING (an `all_cards`
 * bulk shape). Scryfall keeps `name`, `layout`, `type_line`, and `games`
 * canonical-English on foreign objects, so the exclusion filters and the
 * name-keyed grouping treat it exactly like the en object.
 */
const REAL_PRINTING_JA = makeScryfallCard({
  id: 'real-1-ja',
  name: 'Ghalta, Primal Hunger',
  layout: 'normal',
  type_line: 'Legendary Creature — Elder Dinosaur',
  set: 'rix',
  collector_number: '130',
  lang: 'ja',
})

const ARENA_PRINTING = makeScryfallCard({
  id: 'arena-1',
  name: 'Alrund, God of the Cosmos',
  layout: 'normal',
  set: 'ykhm',
  collector_number: '2',
  games: ['arena'],
})

describe('cache printing exclusions', () => {
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  beforeEach(() => {
    setLogger(new MemoryLogger())
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    http.mock(BULK_META_URL, () => bulkMetaResponse())
    client = new ScryfallClient(http, cache, new MemoryFileSystemClient())
  })

  afterEach(() => {
    resetLogger()
  })

  test('preloadCache keeps real printings and drops token, arena-only, and art-series ones', async () => {
    http.mock(DEFAULT_URI, () =>
      gzipJsonLinesResponse([
        REAL_PRINTING,
        REAL_PRINTING_JA,
        REAL_IN_A_SET,
        ART_PRINTING,
        ART_ONLY_NAME,
        TOKEN_PRINTING,
        ARENA_PRINTING,
      ]),
    )

    await client.preloadCache()

    // The foreign object survives the same filters and groups under the same
    // canonical-English name key, its lang retained.
    const ghalta = await cache.get('Ghalta, Primal Hunger')
    expect(ghalta?.map((c) => c.id)).toEqual(['real-1', 'real-1-ja'])
    expect(ghalta?.map((c) => c.lang)).toEqual([undefined, 'ja'])
    expect((await cache.get('Alrund, God of the Cosmos'))?.map((c) => c.id)).toEqual(['real-2'])
    // Excluded names must not become cache keys at all — the keys are what autocomplete lists.
    expect(await cache.get('Clearwater Pathway // Clearwater Pathway')).toBeNull()
    expect(await cache.get('Dinosaur')).toBeNull()
    expect(await cache.keys()).toHaveLength(2)
  })

  test('getCardPrintings evicts art-series prints left in an older cache entry', async () => {
    await cache.set('Ghalta, Primal Hunger', [REAL_PRINTING, ART_PRINTING])

    const printings = await client.getCardPrintings('Ghalta, Primal Hunger')

    expect(printings.map((c) => c.id)).toEqual(['real-1'])
    // The eviction write is fire-and-forget; InMemoryCacheManager.set applies it synchronously.
    expect((await cache.get('Ghalta, Primal Hunger'))?.map((c) => c.id)).toEqual(['real-1'])
  })
})

/**
 * The provenance of a printings list is what tells "this card has exactly one
 * printing" apart from "one fallback fetch answered". Callers that assign or
 * validate printings branch on it, so each source is pinned here.
 */
describe('getCardPrintingsResult provenance', () => {
  const NAMED_URL = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent('Ghalta, Primal Hunger')}`
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  beforeEach(() => {
    setLogger(new MemoryLogger())
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    client = new ScryfallClient(http, cache, new MemoryFileSystemClient())
  })

  afterEach(() => {
    resetLogger()
  })

  test("a bulk-backed cache entry is the card's complete printing list", async () => {
    await cache.set('Ghalta, Primal Hunger', [REAL_PRINTING])
    await cache.markRefreshed()

    const result = await client.getCardPrintingsResult('Ghalta, Primal Hunger')

    expect(result.source).toBe('complete')
    expect(result.printings.map((c) => c.id)).toEqual(['real-1'])
  })

  test('a cache miss answered by the single-card fetch is only partial', async () => {
    http.mock(NAMED_URL, () => Response.json(REAL_PRINTING))

    const result = await client.getCardPrintingsResult('Ghalta, Primal Hunger')

    expect(result.source).toBe('partial')
    expect(result.printings.map((c) => c.id)).toEqual(['real-1'])
  })

  test('a fallback fetch does not leave behind a list the next lookup calls complete', async () => {
    // `fetchCardData` writes its single result into the cache, so without the
    // bulk-download check the very next command would read that one printing as
    // the card's whole printing list — the bug this provenance exists to stop,
    // one command later.
    http.mock(NAMED_URL, () => Response.json(REAL_PRINTING))
    await client.getCardPrintingsResult('Ghalta, Primal Hunger')

    const second = await client.getCardPrintingsResult('Ghalta, Primal Hunger', { network: false })

    expect(second.source).toBe('partial')
  })

  test('an entry in a never-bulk-downloaded cache is partial: it was one such fetch', async () => {
    await cache.set('Ghalta, Primal Hunger', [REAL_PRINTING])

    const result = await client.getCardPrintingsResult('Ghalta, Primal Hunger')

    expect(result.source).toBe('partial')
    expect(result.printings.map((c) => c.id)).toEqual(['real-1'])
  })

  test('network: false never fetches — a cache miss resolves to no printings', async () => {
    let fetches = 0
    http.mockDefault(() => {
      fetches++
      return Response.json(REAL_PRINTING)
    })

    const result = await client.getCardPrintingsResult('Ghalta, Primal Hunger', { network: false })

    expect(result).toEqual({ printings: [], source: 'none' })
    expect(fetches).toBe(0)
  })
})
