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
        REAL_IN_A_SET,
        ART_PRINTING,
        ART_ONLY_NAME,
        TOKEN_PRINTING,
        ARENA_PRINTING,
      ]),
    )

    await client.preloadCache()

    expect((await cache.get('Ghalta, Primal Hunger'))?.map((c) => c.id)).toEqual(['real-1'])
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
