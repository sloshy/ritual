import { describe, expect, test, mock, afterEach } from 'bun:test'
import { batchFetchScryfall } from '../../../src/site/scryfall-collection'
import type { ScryfallCard } from '../../../src/types'

type CollectionRequest = { identifiers: { id: string }[] }

function makeCard(id: string, usd: string): ScryfallCard {
  return {
    id,
    name: id,
    cmc: 0,
    type_line: '',
    oracle_text: '',
    image_uris: { small: '', normal: '', large: '', png: '', art_crop: '', border_crop: '' },
    prices: { usd, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'tst',
    set_name: 'Test',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
    released_at: '2025-01-01',
  } as unknown as ScryfallCard
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('batchFetchScryfall', () => {
  test('returns empty map when given no IDs (no fetch)', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response()))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await batchFetchScryfall([])
    expect(result.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('issues a single batch for ≤75 IDs and merges the response', async () => {
    const ids = ['a', 'b', 'c']
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as CollectionRequest
      const data = body.identifiers.map((i) => makeCard(i.id, '1.00'))
      return new Response(JSON.stringify({ data, not_found: [] }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await batchFetchScryfall(ids)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.size).toBe(3)
    expect(result.get('b')?.prices.usd).toBe('1.00')
  })

  test('splits into multiple batches of 75 and merges results', async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `card-${i}`)
    const calls: number[] = []
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as CollectionRequest
      calls.push(body.identifiers.length)
      const data = body.identifiers.map((i) => makeCard(i.id, '2.00'))
      return new Response(JSON.stringify({ data, not_found: [] }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await batchFetchScryfall(ids)
    expect(calls).toEqual([75, 75, 10])
    expect(result.size).toBe(160)
    expect(result.get('card-0')?.prices.usd).toBe('2.00')
    expect(result.get('card-159')?.prices.usd).toBe('2.00')
  })

  test('skips a failed batch but keeps results from successful batches', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `card-${i}`)
    let callCount = 0
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      callCount++
      if (callCount === 1) return new Response('boom', { status: 500 })
      const body = JSON.parse(init!.body as string) as CollectionRequest
      const data = body.identifiers.map((i) => makeCard(i.id, '3.00'))
      return new Response(JSON.stringify({ data, not_found: [] }), { status: 200 })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await batchFetchScryfall(ids)
    expect(callCount).toBe(2)
    expect(result.size).toBe(25)
    expect(result.has('card-75')).toBe(true)
    expect(result.has('card-0')).toBe(false)
  })

  test('returns empty map when fetch throws', async () => {
    const fetchMock = mock(() => Promise.reject(new Error('network')))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const result = await batchFetchScryfall(['a', 'b'])
    expect(result.size).toBe(0)
  })
})
