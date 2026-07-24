import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { cardLookupSourceName, fetchCardsByIds } from '../../../src/site/card-lookup'
import { resetApiBase, setApiBase } from '../../../src/site/api-base'
import { makeScryfallCard } from '../../test-utils'

/**
 * The by-ID card lookup behind trade-URL restores: which backend answers, and
 * the source label the resulting rows carry. The static path delegates to
 * `batchFetchScryfall`, pinned in scryfall-collection.test.ts.
 */

const originalFetch = globalThis.fetch

/** Stub `GET /api/cards`, recording the ids each batch asked for. */
function stubCardsApi(respond: (ids: string[]) => Response): string[][] {
  const batches: string[][] = []
  const stub = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://site.test')
    if (!url.pathname.endsWith('/api/cards')) throw new Error(`unexpected request: ${url.href}`)
    const ids = (url.searchParams.get('ids') ?? '').split(',')
    batches.push(ids)
    return respond(ids)
  }
  globalThis.fetch = stub as unknown as typeof fetch
  return batches
}

describe('cardLookupSourceName', () => {
  beforeEach(resetApiBase)
  afterEach(resetApiBase)

  test('names the backend that answers the lookup', () => {
    expect(cardLookupSourceName()).toBe('Scryfall')
    setApiBase('')
    expect(cardLookupSourceName()).toBe('Cache')
  })
})

describe('fetchCardsByIds — hosted', () => {
  beforeEach(() => {
    resetApiBase()
    setApiBase('')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetApiBase()
  })

  test('keys the API cards by id and asks Scryfall for nothing', async () => {
    const bolt = makeScryfallCard({ id: 'bolt', name: 'Lightning Bolt' })
    const batches = stubCardsApi(() => Response.json({ success: true, cards: [bolt] }))

    const cards = await fetchCardsByIds(['bolt'])
    expect([...cards.keys()]).toEqual(['bolt'])
    expect(cards.get('bolt')).toEqual(bolt)
    expect(batches).toEqual([['bolt']])
  })

  test('splits large inputs into batches and merges them', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`)
    const batches = stubCardsApi((batchIds) =>
      Response.json({
        success: true,
        cards: batchIds.map((id) => makeScryfallCard({ id, name: id })),
      }),
    )

    const cards = await fetchCardsByIds(ids)
    expect(batches.map((b) => b.length)).toEqual([100, 1])
    expect(cards.size).toBe(101)
  })

  test('a failed batch costs only its own ids, not the whole restore', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`)
    const batches = stubCardsApi((batchIds) => {
      // The first batch of 100 dies; the second still lands.
      if (batches.length === 1) return new Response('nope', { status: 500 })
      return Response.json({
        success: true,
        cards: batchIds.map((id) => makeScryfallCard({ id, name: id })),
      })
    })

    const cards = await fetchCardsByIds(ids)
    expect([...cards.keys()]).toEqual(['id-100'])
  })

  test('an unresolvable id is simply absent', async () => {
    stubCardsApi(() => Response.json({ success: true, cards: [] }))
    expect((await fetchCardsByIds(['ghost'])).size).toBe(0)
  })

  test('an error response yields nothing rather than throwing', async () => {
    stubCardsApi(() => Response.json({ success: false, cards: [], message: 'boom' }))
    expect((await fetchCardsByIds(['bolt'])).size).toBe(0)
  })

  test('an unreachable backend yields nothing and degrades the session to static', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    setApiBase('https://api.test')

    expect((await fetchCardsByIds(['bolt'])).size).toBe(0)
    // Degraded: the next lookup would go to Scryfall instead of the dead API.
    expect(cardLookupSourceName()).toBe('Scryfall')
  })

  test('no ids means no request', async () => {
    const batches = stubCardsApi(() => Response.json({ success: true, cards: [] }))
    expect((await fetchCardsByIds([])).size).toBe(0)
    expect(batches).toEqual([])
  })
})
