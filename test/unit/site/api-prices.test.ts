import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { batchFetchApiPrices } from '../../../src/site/api-prices'
import { resetApiBase, setApiBase } from '../../../src/site/api-base'
import { makeScryfallCard } from '../../test-utils'

const originalFetch = globalThis.fetch

type StubbedBatch = { names: string[] }

/** Stub `POST /api/card-prices`, answering each batch via `respond`. */
function stubCardPrices(
  respond: (names: string[], batchIndex: number) => Response,
): StubbedBatch[] {
  const batches: StubbedBatch[] = []
  const stub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/api/card-prices')) throw new Error(`unexpected request: ${url}`)
    const body = JSON.parse(init?.body as string) as { names: string[] }
    batches.push({ names: body.names })
    return respond(body.names, batches.length - 1)
  }
  globalThis.fetch = stub as unknown as typeof fetch
  return batches
}

describe('batchFetchApiPrices', () => {
  beforeEach(() => {
    resetApiBase()
    setApiBase('')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetApiBase()
  })

  test('returns the cards from a single batch', async () => {
    const bolt = makeScryfallCard({ id: 'bolt', name: 'Lightning Bolt' })
    const batches = stubCardPrices((names) =>
      Response.json({ success: true, cards: names.map(() => bolt) }),
    )

    const cards = await batchFetchApiPrices(['Lightning Bolt'])
    expect(cards).toEqual([bolt])
    expect(batches).toEqual([{ names: ['Lightning Bolt'] }])
  })

  test('splits large inputs into batches and merges the results', async () => {
    const names = Array.from({ length: 401 }, (_, i) => `Card ${i}`)
    const batches = stubCardPrices((batchNames) =>
      Response.json({
        success: true,
        cards: batchNames.map((name) => makeScryfallCard({ id: name, name })),
      }),
    )

    const cards = await batchFetchApiPrices(names)
    expect(batches.map((b) => b.names.length)).toEqual([400, 1])
    expect(cards).toHaveLength(401)
  })

  test('a failed batch contributes nothing, later batches still land', async () => {
    const names = Array.from({ length: 401 }, (_, i) => `Card ${i}`)
    const batches = stubCardPrices((batchNames, batchIndex) =>
      batchIndex === 0
        ? Response.json({ success: false, cards: [] }, { status: 500 })
        : Response.json({
            success: true,
            cards: batchNames.map((name) => makeScryfallCard({ id: name, name })),
          }),
    )

    const cards = await batchFetchApiPrices(names)
    expect(batches).toHaveLength(2)
    expect(cards).toHaveLength(1)
  })

  test('resolves empty for an empty input without any request', async () => {
    const batches = stubCardPrices(() => Response.json({ success: true, cards: [] }))
    expect(await batchFetchApiPrices([])).toEqual([])
    expect(batches).toEqual([])
  })
})
