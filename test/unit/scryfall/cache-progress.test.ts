import { describe, expect, test, beforeEach } from 'bun:test'
import { ScryfallClient } from '../../../src/scryfall'
import type { CacheRefreshEvent } from '../../../src/scryfall'
import type { ScryfallCard } from '../../../src/types'
import {
  ART_TAGS_URI,
  BULK_META_URL,
  DEFAULT_CARDS_URI,
  ORACLE_TAGS_URI,
  MockHttpClient,
  InMemoryCacheManager,
  MemoryFileSystemClient,
  MemoryLogger,
  bulkCard,
  bulkMetaBody,
  gzipJsonLinesResponse,
  setLogger,
} from '../../test-utils'

describe('preloadCache progress reporting', () => {
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  beforeEach(() => {
    setLogger(new MemoryLogger())
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    http.mock(BULK_META_URL, () => Response.json(bulkMetaBody()))
    http.mock(ORACLE_TAGS_URI, () => gzipJsonLinesResponse([]))
    http.mock(ART_TAGS_URI, () => gzipJsonLinesResponse([]))
    http.mock(DEFAULT_CARDS_URI, () => gzipJsonLinesResponse([bulkCard()]))
    client = new ScryfallClient(http, cache, new MemoryFileSystemClient())
  })

  test('reports the refresh stages in order', async () => {
    const events: CacheRefreshEvent[] = []
    await client.preloadCache({ onProgress: (event) => events.push(event) })

    const stages = events.map((e) => e.stage)
    expect(stages[0]).toBe('metadata')
    expect(stages[1]).toBe('tags')
    expect(stages).toContain('download')
    expect(stages.indexOf('save')).toBeGreaterThan(stages.indexOf('download'))
    expect(stages.at(-1)).toBe('done')
    // Every report carries text a client can render.
    expect(events.every((e) => e.message.length > 0)).toBeTrue()
  })

  test('carries a download percentage when the compressed size is known', async () => {
    const events: CacheRefreshEvent[] = []
    await client.preloadCache({ onProgress: (event) => events.push(event) })

    // `gzipJsonLinesResponse` sets content-length, so the ingest knows the scale.
    const percentages = events
      .filter((e) => e.stage === 'download' && e.percentage !== undefined)
      .map((e) => e.percentage)
    expect(percentages.length).toBeGreaterThan(0)
    expect(percentages.at(-1)).toBe(100)
  })

  // These two are the phase's headline change: `preloadCache` used to swallow a
  // failed refresh and report success. The `await` is load-bearing — without it
  // the assertion is a floating promise and the test passes however the call
  // settles — and so is the message matcher, which is what keeps an unrelated
  // throw (a missing stub, say) from satisfying "it rejected".
  test('rejects when the bulk metadata fetch fails instead of reporting success', async () => {
    http.mock(BULK_META_URL, () => new Response('nope', { status: 500 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.preloadCache()).rejects.toThrow('Failed to fetch bulk manifest: 500')
  })

  test('rejects when the card bulk download fails', async () => {
    http.mock(DEFAULT_CARDS_URI, () => new Response('nope', { status: 500 }))

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.preloadCache()).rejects.toThrow('Failed to fetch bulk data: 500')
  })
})
