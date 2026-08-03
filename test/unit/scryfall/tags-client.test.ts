import { describe, expect, test, beforeEach } from 'bun:test'
import { ScryfallClient } from '../../../src/scryfall'
import type { TagIndex } from '../../../src/scryfall/tags'
import type { ScryfallCard } from '../../../src/types'
import {
  MockHttpClient,
  InMemoryCacheManager,
  DenyHttpClient,
  MemoryFileSystemClient,
  MemoryLogger,
  gzipJsonLinesResponse,
  setLogger,
} from '../../test-utils'

/** InMemoryCacheManager that also implements the optional bulkSet fast path. */
class BulkSetCacheManager<T> extends InMemoryCacheManager<T> {
  bulkSetCalled = false
  async bulkSet(entries: Record<string, T>): Promise<void> {
    this.bulkSetCalled = true
    for (const [key, value] of Object.entries(entries)) await this.set(key, value)
  }
}

const BULK_META_URL = 'https://api.scryfall.com/bulk-data'
const DEFAULT_URI = 'https://data.example/default-cards.jsonl.gz'
const ORACLE_URI = 'https://data.example/oracle-tags.jsonl.gz'
const ART_URI = 'https://data.example/art-tags.jsonl.gz'

/** In-memory FileSystemClient so the client can persist cache/tags.json. */
function makeMemoryFs(): MemoryFileSystemClient {
  return new MemoryFileSystemClient()
}

function bulkMetaResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        { type: 'default_cards', jsonl_download_uri: DEFAULT_URI },
        { type: 'oracle_tags', jsonl_download_uri: ORACLE_URI },
        { type: 'art_tags', jsonl_download_uri: ART_URI },
      ],
    }),
  )
}

const SOL_RING: Partial<ScryfallCard> = {
  id: 'sol-1',
  oracle_id: 'o-sol',
  illustration_id: 'i-sol',
  name: 'Sol Ring',
  type_line: 'Artifact',
  set: 'cmr',
  set_name: 'Commander Legends',
  collector_number: '472',
  rarity: 'uncommon',
  finishes: ['nonfoil'],
  games: ['paper'],
  prices: { usd: '1.50', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
}

const DELVER: Partial<ScryfallCard> = {
  id: 'delver-1',
  oracle_id: 'o-delver',
  name: 'Delver of Secrets // Insectile Aberration',
  type_line: 'Creature — Human Wizard',
  set: 'isd',
  set_name: 'Innistrad',
  collector_number: '51',
  rarity: 'common',
  finishes: ['nonfoil'],
  games: ['paper'],
  prices: { usd: '0.25', usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  card_faces: [
    {
      name: 'Delver of Secrets',
      mana_cost: '{U}',
      type_line: 'Creature — Human Wizard',
      oracle_text: '',
      illustration_id: 'i-delver-front',
    },
    {
      name: 'Insectile Aberration',
      mana_cost: '',
      type_line: 'Creature — Human Insect',
      oracle_text: '',
      illustration_id: 'i-delver-back',
    },
  ],
}

function cardsStream(cards: Partial<ScryfallCard>[]): Response {
  return gzipJsonLinesResponse(cards)
}

const oracleTag = (id: string, slug: string, oracleId: string) => ({
  object: 'tag',
  id,
  label: slug,
  slug,
  type: 'oracle',
  taggings: [{ oracle_id: oracleId }],
})

const artTag = (id: string, slug: string, illustrationId: string) => ({
  object: 'tag',
  id,
  label: slug,
  slug,
  type: 'illustration',
  taggings: [{ illustration_id: illustrationId }],
})

const oracleTagBulk = [
  oracleTag('t1', 'ramp', 'o-sol'),
  oracleTag('t2', 'artifact', 'o-sol'),
  oracleTag('t3', 'card-draw', 'o-delver'),
]

const artTagBulk = [
  artTag('a1', 'machine', 'i-sol'),
  artTag('a2', 'wizard', 'i-delver-front'),
  artTag('a3', 'insect', 'i-delver-back'),
]

describe('ScryfallClient tag integration', () => {
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  beforeEach(() => {
    setLogger(new MemoryLogger())
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    http.mock(BULK_META_URL, () => bulkMetaResponse())
    http.mock(ORACLE_URI, () => gzipJsonLinesResponse(oracleTagBulk))
    http.mock(ART_URI, () => gzipJsonLinesResponse(artTagBulk))
    client = new ScryfallClient(http, cache, makeMemoryFs())
  })

  test('preloadCache bakes oracle tags on every printing and art tags per illustration', async () => {
    http.mock(DEFAULT_URI, () => cardsStream([SOL_RING, DELVER]))

    await client.preloadCache()

    const sol = (await cache.get('Sol Ring'))![0]!
    expect(sol.oracleTags).toEqual(['artifact', 'ramp'])
    expect(sol.artTags).toEqual(['machine'])

    const delver = (await cache.get('Delver of Secrets // Insectile Aberration'))![0]!
    expect(delver.oracleTags).toEqual(['card-draw'])
    // Art tags union both faces' illustrations.
    expect(delver.artTags).toEqual(['insect', 'wizard'])
  })

  test('refreshTags re-attaches updated tags without changing card identity or prices', async () => {
    // Seed the cache with already-stored printings carrying stale tags.
    await cache.set('Sol Ring', [
      { ...(SOL_RING as ScryfallCard), oracleTags: ['stale'], artTags: ['stale'] },
    ])

    await client.refreshTags()

    const sol = (await cache.get('Sol Ring'))![0]!
    expect(sol.oracleTags).toEqual(['artifact', 'ramp'])
    expect(sol.artTags).toEqual(['machine'])
    // Identity and price data are untouched by a tag refresh.
    expect(sol.id).toBe('sol-1')
    expect(sol.prices.usd).toBe('1.50')
  })

  test('preloadCache still caches cards when the oracle-tag download fails', async () => {
    http.mock(DEFAULT_URI, () => cardsStream([SOL_RING]))
    http.mock(ORACLE_URI, () => new Response('nope', { status: 500 }))

    await client.preloadCache()

    const sol = (await cache.get('Sol Ring'))![0]!
    expect(sol.id).toBe('sol-1')
    expect(sol.oracleTags).toBeUndefined()
    expect(sol.artTags).toBeUndefined()
  })

  test('preloadCache still caches cards when the art-tag download fails', async () => {
    http.mock(DEFAULT_URI, () => cardsStream([SOL_RING]))
    http.mock(ART_URI, () => new Response('nope', { status: 500 }))

    await client.preloadCache()

    const sol = (await cache.get('Sol Ring'))![0]!
    expect(sol.id).toBe('sol-1')
    // A single tag-bulk failure aborts the whole index, so no tags are attached.
    expect(sol.oracleTags).toBeUndefined()
    expect(sol.artTags).toBeUndefined()
  })

  test('refreshTags throws when the tags cannot be downloaded', async () => {
    // The command promises exit 1 for a failed refresh, which it can only keep
    // if the failure reaches it — this used to be logged and swallowed.
    http.mock(ORACLE_URI, () => new Response('nope', { status: 500 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.refreshTags()).rejects.toThrow('Tag refresh aborted')
  })

  test('refreshTags uses the cache bulkSet fast path when available', async () => {
    const bulkCache = new BulkSetCacheManager<ScryfallCard[]>(0)
    await bulkCache.set('Sol Ring', [SOL_RING as ScryfallCard])
    const bulkClient = new ScryfallClient(http, bulkCache, makeMemoryFs())

    await bulkClient.refreshTags()

    expect(bulkCache.bulkSetCalled).toBeTrue()
    expect((await bulkCache.get('Sol Ring'))![0]!.oracleTags).toEqual(['artifact', 'ramp'])
  })

  test('fetchCardData attaches tags from the persisted tags.json on a cache miss', async () => {
    const fs = makeMemoryFs()
    http.mock(DEFAULT_URI, () => cardsStream([DELVER]))

    // First client populates the card cache and writes cache/tags.json.
    const writer = new ScryfallClient(http, new InMemoryCacheManager<ScryfallCard[]>(0), fs)
    await writer.preloadCache()

    // A fresh client + empty cache must read tags back from the persisted index.
    const reader = new ScryfallClient(http, new InMemoryCacheManager<ScryfallCard[]>(0), fs)
    http.mock(
      `https://api.scryfall.com/cards/named?exact=${encodeURIComponent('Sol Ring')}`,
      () => new Response(JSON.stringify(SOL_RING)),
    )

    const sol = await reader.fetchCardData('Sol Ring', { silent: true })
    expect(sol?.oracleTags).toEqual(['artifact', 'ramp'])
    expect(sol?.artTags).toEqual(['machine'])
  })

  test('refreshTags(prefetched) bakes a supplied index without any network access', async () => {
    // build-site downloads the index once for its in-memory cards, then hands it to
    // refreshTags to persist — this must not trigger a second download.
    const cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    await cache.set('Sol Ring', [SOL_RING as ScryfallCard])
    // DenyHttpClient throws on any fetch, so the test fails if a download is attempted.
    const offlineClient = new ScryfallClient(new DenyHttpClient(), cache, makeMemoryFs())

    const index: TagIndex = {
      updatedAt: 1,
      oracle: { 'o-sol': ['artifact', 'ramp'] },
      illustration: { 'i-sol': ['machine'] },
    }
    await offlineClient.refreshTags(index)

    const sol = (await cache.get('Sol Ring'))![0]!
    expect(sol.oracleTags).toEqual(['artifact', 'ramp'])
    expect(sol.artTags).toEqual(['machine'])
  })
})
