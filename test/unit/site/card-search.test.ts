import { beforeEach, describe, test, expect, afterEach } from 'bun:test'
import { autocompleteCardNames, fetchCardPrintings } from '../../../src/site/card-search'
import { isAbortError } from '../../../src/site/utils'
import {
  getPrintingsByName,
  resetSessionCache,
  seedPrintings,
} from '../../../src/site/session-cache'
import { resetApiBase, setApiBase } from '../../../src/site/api-base'
import { makeScryfallCard } from '../../test-utils'
import type { ScryfallCard } from '../../../src/scryfall/types'

/**
 * The public site's browser card-search client, shared by the trade page's
 * search box and the list editors' search modal. Dispatches per call: live-API
 * endpoints when a backend is configured, Scryfall otherwise.
 */

const originalFetch = globalThis.fetch

type StubbedRequest = { url: string }

/** Per-endpoint Scryfall stubs. An omitted endpoint answers 404. */
type ScryfallStubs = {
  autocomplete?: (query: string) => string[]
  search?: () => Response
  named?: () => Response
}

/** Stub Scryfall, routing by endpoint. Returns the requests the client actually made. */
function stubScryfall(handlers: ScryfallStubs): StubbedRequest[] {
  const requests: StubbedRequest[] = []
  const notFound = (): Response => Response.json({ object: 'error' }, { status: 404 })
  const stub = (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push({ url })
    if (url.includes('/cards/autocomplete')) {
      const query = new URL(url).searchParams.get('q') ?? ''
      const names = handlers.autocomplete?.(query) ?? []
      return Promise.resolve(Response.json({ object: 'catalog', total_values: 0, data: names }))
    }
    if (url.includes('/cards/search')) return Promise.resolve(handlers.search?.() ?? notFound())
    if (url.includes('/cards/named')) return Promise.resolve(handlers.named?.() ?? notFound())
    throw new Error(`unexpected request: ${url}`)
  }
  globalThis.fetch = stub as typeof fetch
  return requests
}

function cardList(...cards: ScryfallCard[]): Response {
  return Response.json({ object: 'list', has_more: false, data: cards })
}

// Reset on both sides: module-level api-base state can leak in from other test
// files in the same process.
beforeEach(() => {
  resetApiBase()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  resetSessionCache()
  resetApiBase()
})

describe('autocompleteCardNames', () => {
  // Scryfall ranks its suggestions by popularity, so "The End" comes back last.
  const popularityOrder = ['The Enduring Renown', 'The Endless Swarm', 'The End']

  test('offers a fully typed card name ahead of more popular partial matches', async () => {
    stubScryfall({ autocomplete: () => popularityOrder })
    expect((await autocompleteCardNames('The End'))[0]).toBe('The End')
  })

  test("leaves Scryfall's order alone for a partially typed name", async () => {
    stubScryfall({ autocomplete: () => popularityOrder })
    expect(await autocompleteCardNames('The En')).toEqual(popularityOrder)
  })

  test('resolves empty when Scryfall rejects the query', async () => {
    const stub = (_input: string | URL | Request): Promise<Response> =>
      Promise.resolve(Response.json({ object: 'error' }, { status: 400 }))
    globalThis.fetch = stub as typeof fetch
    expect(await autocompleteCardNames('!!')).toEqual([])
  })

  test('asks a multi-term query as-is — one request, Scryfall order kept', async () => {
    // The admin editor and CLI apply term matching over the local cache (`in
    // tre` finds "In the Trenches"); the public site deliberately surfaces
    // Scryfall's own contiguous-string results instead of widening the query
    // with extra requests. The search dialog discloses the difference.
    const contiguousOnly = ['Intrepid Ace', 'Kin-Tree Warden']
    const requests = stubScryfall({ autocomplete: () => contiguousOnly })

    expect(await autocompleteCardNames('in tre')).toEqual(contiguousOnly)
    expect(requests).toHaveLength(1)
  })
})

describe('fetchCardPrintings', () => {
  const bolt = makeScryfallCard({ id: 'bolt-lea', name: 'Lightning Bolt', set: 'lea' })
  const boltReprint = makeScryfallCard({ id: 'bolt-2x2', name: 'Lightning Bolt', set: '2x2' })

  test('returns the exact-name search results and caches them for the session', async () => {
    const requests = stubScryfall({ search: () => cardList(bolt, boltReprint) })

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([bolt, boltReprint])
    expect(getPrintingsByName('Lightning Bolt')).toEqual([bolt, boltReprint])
    expect(requests).toHaveLength(1)
  })

  test('serves an already-cached name without hitting Scryfall', async () => {
    seedPrintings({ 'Lightning Bolt': [bolt] })
    const requests = stubScryfall({})

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([bolt])
    expect(requests).toEqual([])
  })

  test('falls back to a fuzzy lookup when the exact search 404s', async () => {
    // Scryfall's exact search misses some names (tokens and other edge cases).
    const requests = stubScryfall({ named: () => Response.json(bolt) })

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([bolt])
    expect(requests.map((r) => r.url.split('?')[0])).toEqual([
      'https://api.scryfall.com/cards/search',
      'https://api.scryfall.com/cards/named',
    ])
  })

  test('resolves empty when neither lookup finds the card', async () => {
    stubScryfall({})
    expect(await fetchCardPrintings('Not A Card')).toEqual([])
    expect(getPrintingsByName('Not A Card')).toBeUndefined()
  })

  test('a cancelled fetch rejects rather than resolving empty', async () => {
    // The caller (the trade page's search box) needs "cancelled" to look different
    // from "no results", so it can leave the previous suggestions on screen.
    const stub = (_input: string | URL | Request): Promise<Response> =>
      Promise.reject(new DOMException('aborted', 'AbortError'))
    globalThis.fetch = stub as typeof fetch
    const controller = new AbortController()
    controller.abort()

    let caught: unknown
    try {
      await fetchCardPrintings('Lightning Bolt', { signal: controller.signal })
    } catch (e) {
      caught = e
    }
    expect(isAbortError(caught)).toBe(true)
  })
})

describe('live-API dispatch', () => {
  const bolt = makeScryfallCard({ id: 'bolt-lea', name: 'Lightning Bolt', set: 'lea' })

  /** Stub the live API endpoints; anything else (e.g. Scryfall) is an error. */
  function stubApi(handlers: {
    autocomplete?: () => Response
    printings?: () => Response
  }): StubbedRequest[] {
    const requests: StubbedRequest[] = []
    const stub = (input: string | URL | Request): Promise<Response> => {
      const url = input instanceof Request ? input.url : String(input)
      requests.push({ url })
      if (url.includes('/api/autocomplete')) {
        return Promise.resolve(
          handlers.autocomplete?.() ?? Response.json({ success: true, names: [] }),
        )
      }
      if (url.includes('/api/card-printings')) {
        return Promise.resolve(
          handlers.printings?.() ?? Response.json({ success: true, printings: [] }),
        )
      }
      throw new Error(`unexpected request in API mode: ${url}`)
    }
    globalThis.fetch = stub as typeof fetch
    return requests
  }

  test('autocomplete asks the API and keeps the server order verbatim', async () => {
    setApiBase('')
    // The server already ranked; the client must not re-promote "The End".
    const serverOrder = ['The Enduring Renown', 'The End']
    const requests = stubApi({
      autocomplete: () => Response.json({ success: true, names: serverOrder }),
    })

    expect(await autocompleteCardNames('The End')).toEqual(serverOrder)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('/api/autocomplete?q=The%20End')
  })

  test('a remote base prefixes the endpoint URLs', async () => {
    setApiBase('https://api.example.com')
    const requests = stubApi({})
    await autocompleteCardNames('bolt')
    expect(requests[0]!.url).toBe('https://api.example.com/api/autocomplete?q=bolt')
  })

  test('printings come from the API and land in the session cache', async () => {
    setApiBase('')
    const requests = stubApi({
      printings: () => Response.json({ success: true, printings: [bolt] }),
    })

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([bolt])
    expect(getPrintingsByName('Lightning Bolt')).toEqual([bolt])
    expect(requests).toHaveLength(1)
    expect(requests[0]!.url).toContain('/api/card-printings?name=Lightning%20Bolt')
  })

  test('the session cache still answers first in API mode', async () => {
    setApiBase('')
    seedPrintings({ 'Lightning Bolt': [bolt] })
    const requests = stubApi({})

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([bolt])
    expect(requests).toEqual([])
  })

  test('an API failure resolves empty without caching', async () => {
    setApiBase('')
    stubApi({ printings: () => Response.json({ success: false, printings: [] }, { status: 500 }) })

    expect(await fetchCardPrintings('Lightning Bolt')).toEqual([])
    expect(getPrintingsByName('Lightning Bolt')).toBeUndefined()
  })
})
