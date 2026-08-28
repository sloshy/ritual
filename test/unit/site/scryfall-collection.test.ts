import { describe, expect, test, afterEach } from 'bun:test'
import { batchFetchScryfall } from '../../../src/site/scryfall-collection'
import { makeScryfallCard } from '../../test-utils'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'
import type { ScryfallCard } from '../../../src/scryfall/types'

type CollectionRequest = { identifiers: { id: string }[] }

function makeCard(id: string, usd: string): ScryfallCard {
  return makeScryfallCard({ id, name: id, prices: { usd } })
}

/** The ids one batch POST asked Scryfall for. */
const askedIds = (body: unknown): string[] =>
  (body as CollectionRequest).identifiers.map((identifier) => identifier.id)

let stubbed: StubbedFetch | undefined

afterEach(() => {
  stubbed?.restore()
})

describe('batchFetchScryfall', () => {
  test('returns empty map when given no IDs (no fetch)', async () => {
    stubbed = stubFetch({ 'https://api.scryfall.com': () => new Response() })
    const result = await batchFetchScryfall([])
    expect(result.size).toBe(0)
    expect(stubbed.sent).toHaveLength(0)
  })

  test('issues a single batch for ≤75 IDs and merges the response', async () => {
    const ids = ['a', 'b', 'c']
    stubbed = stubFetch({
      'https://api.scryfall.com': (request) =>
        Response.json({
          data: askedIds(request.body).map((id) => makeCard(id, '1.00')),
          not_found: [],
        }),
    })
    const result = await batchFetchScryfall(ids)
    expect(stubbed.sent).toHaveLength(1)
    expect(result.size).toBe(3)
    expect(result.get('b')?.prices.usd).toBe('1.00')
  })

  test('splits into multiple batches of 75 and merges results', async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `card-${i}`)
    stubbed = stubFetch({
      'https://api.scryfall.com': (request) =>
        Response.json({
          data: askedIds(request.body).map((id) => makeCard(id, '2.00')),
          not_found: [],
        }),
    })
    const result = await batchFetchScryfall(ids)
    expect(stubbed.sent.map((request) => askedIds(request.body).length)).toEqual([75, 75, 10])
    expect(result.size).toBe(160)
    expect(result.get('card-0')?.prices.usd).toBe('2.00')
    expect(result.get('card-159')?.prices.usd).toBe('2.00')
  })

  test('skips a failed batch but keeps results from successful batches', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `card-${i}`)
    let callCount = 0
    stubbed = stubFetch({
      'https://api.scryfall.com': (request) => {
        if (++callCount === 1) return new Response('boom', { status: 500 })
        return Response.json({
          data: askedIds(request.body).map((id) => makeCard(id, '3.00')),
          not_found: [],
        })
      },
    })
    const result = await batchFetchScryfall(ids)
    expect(callCount).toBe(2)
    expect(result.size).toBe(25)
    expect(result.has('card-75')).toBe(true)
    expect(result.has('card-0')).toBe(false)
  })

  test('returns empty map when fetch throws', async () => {
    stubbed = stubFetch({
      'https://api.scryfall.com': () => {
        throw new Error('network')
      },
    })
    const result = await batchFetchScryfall(['a', 'b'])
    expect(result.size).toBe(0)
  })
})
