import { beforeEach, describe, expect, test } from 'bun:test'
import { ScryfallClient } from '../../../src/scryfall'
import type { ScryfallCard } from '../../../src/scryfall/types'
import {
  InMemoryCacheManager,
  MemoryFileSystemClient,
  MockHttpClient,
  makeScryfallCard,
} from '../../test-utils'

/**
 * `searchAllPages` exists so `cache preload-set` can tell a typo'd set code from
 * a working one. Every outcome used to look like success, because a 404, an HTTP
 * failure and a dead network all answered with an empty card list.
 */
describe('ScryfallClient.searchAllPages', () => {
  let http: MockHttpClient
  let cache: InMemoryCacheManager<ScryfallCard[]>
  let client: ScryfallClient

  const pageUrl = (page: number): string =>
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent('set:khm')}&order=edhrec&page=${page}`

  beforeEach(() => {
    http = new MockHttpClient()
    cache = new InMemoryCacheManager<ScryfallCard[]>(0)
    client = new ScryfallClient(http, cache, new MemoryFileSystemClient())
  })

  test('walks every page and caches each real printing', async () => {
    http.mock(pageUrl(1), () =>
      Response.json({
        has_more: true,
        data: [makeScryfallCard({ id: '1', name: 'First Page Card', set: 'khm' })],
      }),
    )
    http.mock(pageUrl(2), () =>
      Response.json({
        has_more: false,
        data: [makeScryfallCard({ id: '2', name: 'Second Page Card', set: 'khm' })],
      }),
    )

    const result = await client.searchAllPages('set:khm')

    expect(result.kind).toBe('cards')
    if (result.kind !== 'cards') return
    expect(result.cards.map((c) => c.name)).toEqual(['First Page Card', 'Second Page Card'])
    expect(result.matched).toBe(2)
    expect(await cache.get('First Page Card')).toHaveLength(1)
  })

  test('a set of only non-printings matched something, even though it cached nothing', async () => {
    // The distinction `cache preload-set` reports on: a real token set is not a
    // typo'd set code, even though `cacheRealPrintings` drops every item in it.
    http.mock(pageUrl(1), () =>
      Response.json({
        has_more: false,
        data: [
          makeScryfallCard({ id: 't1', name: 'Zombie', layout: 'token', set: 'khm' }),
          makeScryfallCard({ id: 't2', name: 'Bear', layout: 'token', set: 'khm' }),
        ],
      }),
    )

    const result = await client.searchAllPages('set:khm')

    expect(result).toEqual({ kind: 'cards', cards: [], matched: 2 })
    expect(await cache.get('Zombie')).toBeNull()
  })

  test('drops excluded printings from the results and from the cache', async () => {
    // Same name as the real card, so caching the art series would pollute that
    // card's printing list.
    http.mock(pageUrl(1), () =>
      Response.json({
        has_more: false,
        data: [
          makeScryfallCard({ id: 'r', name: 'Ghalta, Primal Hunger', layout: 'normal' }),
          makeScryfallCard({
            id: 'a',
            name: 'Ghalta, Primal Hunger',
            layout: 'art_series',
            set: 'arix',
          }),
          makeScryfallCard({ id: 't', name: 'Dinosaur', layout: 'token' }),
        ],
      }),
    )

    const result = await client.searchAllPages('set:khm')

    expect(result.kind).toBe('cards')
    if (result.kind !== 'cards') return
    expect(result.cards.map((c) => c.id)).toEqual(['r'])
    expect(result.matched).toBe(3)
    expect((await cache.get('Ghalta, Primal Hunger'))?.map((c) => c.id)).toEqual(['r'])
    expect(await cache.get('Dinosaur')).toBeNull()
  })

  test('an unknown set code (Scryfall 404) is zero cards, not a failure', async () => {
    http.mock(pageUrl(1), () => new Response('{}', { status: 404 }))

    const result = await client.searchAllPages('set:khm')

    expect(result).toEqual({ kind: 'cards', cards: [], matched: 0 })
  })

  test('an HTTP failure comes back as data instead of an empty result', async () => {
    http.mock(
      pageUrl(1),
      () => new Response(JSON.stringify({ details: 'Service unavailable' }), { status: 503 }),
    )

    const result = await client.searchAllPages('set:khm')

    expect(result.kind).toBe('failed')
    if (result.kind !== 'failed') return
    expect(result.status).toBe(503)
    expect(result.message).toBe('Service unavailable')
  })

  test('a transport failure propagates, so the caller can exit non-zero', async () => {
    http.mock(pageUrl(1), () => {
      throw new Error('network is unreachable')
    })

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(client.searchAllPages('set:khm')).rejects.toThrow('network is unreachable')
  })
})
