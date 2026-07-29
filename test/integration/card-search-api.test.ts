import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { handleAutocomplete } from '../../src/api/autocomplete'
import { handleSearchCards, type SearchCardsResponse } from '../../src/admin/api/search-cards'
import {
  handleCardSearch,
  type CardSearchFailure,
  type CardSearchResponse,
  type CardSearchSuccess,
} from '../../src/api/card-search'
import { cardCache } from '../../src/cache'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard, ScryfallList } from '../../src/types'

/**
 * The card-search endpoints behind the admin editor's search modal and the MCP
 * `autocomplete_card` / `search_cards` tools, plus the raw-Scryfall-syntax
 * `GET /api/card-search`. Autocomplete reads the on-disk Scryfall cache (seeded
 * here in a throwaway workspace); the other two proxy Scryfall itself (stubbed
 * here). Autocomplete and search-cards must both offer a card whose whole name
 * the query spells out ahead of the popular cards that merely contain it.
 */

/** Scryfall's error object, as it answers a search that matched nothing. */
type ScryfallErrorBody = { object: 'error' }

/** Scryfall's error object when it explains itself (a malformed query). */
type ScryfallErrorDetails = { object: 'error'; details: string }

// "The End" is an unpopular card whose name the popular ones all contain. The
// "Ach!" pair is the case that only whole-name promotion can get right in the
// autocomplete handler: it sorts its candidates alphabetically, and punctuation
// collates such that "Ach Hans Run Away" lands ahead of the card the query
// actually spells out.
const CARD_NAMES = [
  'The Enduring Renown',
  'The Endless Swarm',
  'The End',
  'Ach Hans Run Away',
  'Ach! Hans, Run!',
  'Delver of Secrets Deluxe',
  'Delver of Secrets // Insectile Aberration',
  // The "in tre" set: each term appears in all three, but only "In the Trenches"
  // is spelled the way the query reads — the others match mid-word.
  'In the Trenches',
  'Arctic Treeline',
  'Intrepid Paleontologist',
]

/** Seed the card cache with the fixture, which also stands in for a completed preload. */
async function seedCardCache(): Promise<void> {
  const entries: Record<string, ScryfallCard[]> = Object.fromEntries(
    CARD_NAMES.map((name) => [name, [makeScryfallCard({ name })]]),
  )
  await cardCache.bulkSet(entries)
}

describe('handleAutocomplete', () => {
  type AutocompleteBody = { success: boolean; names: string[] }

  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ init: true, clearCardCache: true })
    await seedCardCache()
  })

  afterAll(async () => {
    await workspace.dispose()
  })

  async function autocomplete(query: string): Promise<string[]> {
    const req = new Request(`http://localhost/api/autocomplete?q=${encodeURIComponent(query)}`)
    const resp = await handleAutocomplete(req)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as AutocompleteBody
    expect(body.success).toBe(true)
    return body.names
  }

  test('a partial query returns every match, the closest first', async () => {
    // "In the Trenches" matches too — its terms just land mid-word ("trENches"),
    // which is what ranks it below the three names the query prefixes.
    expect(await autocomplete('The En')).toEqual([
      'The End',
      'The Endless Swarm',
      'The Enduring Renown',
      'In the Trenches',
    ])
  })

  test('a query spelling out a whole name offers that card first', async () => {
    expect((await autocomplete('The End'))[0]).toBe('The End')
  })

  test('a whole-name match wins even when another candidate sorts ahead of it', async () => {
    // Typed without its punctuation, and against a rival that collates first.
    expect(await autocomplete('ach hans run')).toEqual(['Ach! Hans, Run!', 'Ach Hans Run Away'])
  })

  test('a spelled-out front face promotes its double-faced card', async () => {
    expect(await autocomplete('delver of secrets')).toEqual([
      'Delver of Secrets // Insectile Aberration',
      'Delver of Secrets Deluxe',
    ])
  })

  test('a one-character query returns nothing', async () => {
    expect(await autocomplete('T')).toEqual([])
  })

  test('each term is matched separately, as the CLI prompts match them', async () => {
    // No card name contains "in tre" contiguously, so this used to return nothing.
    expect(await autocomplete('in tre')).toEqual([
      'In the Trenches',
      'Arctic Treeline',
      'Intrepid Paleontologist',
    ])
  })

  test('terms may be typed in any order', async () => {
    expect((await autocomplete('tre in'))[0]).toBe('In the Trenches')
  })
})

describe('handleSearchCards', () => {
  const originalFetch = globalThis.fetch
  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ init: true, clearCardCache: true })
    // Scryfall is queried with order=edhrec, so it answers popular cards first.
    const stub = (_input: string | URL | Request): Promise<Response> =>
      Promise.resolve(
        Response.json({
          object: 'list',
          has_more: false,
          data: CARD_NAMES.map((name) => makeScryfallCard({ name })),
        }),
      )
    globalThis.fetch = stub as typeof fetch
    // A populated cache also keeps the search off the "pre-cache Scryfall?" prompt.
    await seedCardCache()
  })

  afterAll(async () => {
    globalThis.fetch = originalFetch
    await workspace.dispose()
  })

  async function search(query: string): Promise<string[]> {
    const req = new Request('http://localhost/api/search-cards', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
    const resp = await handleSearchCards(req)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as SearchCardsResponse
    expect(body.success).toBe(true)
    return body.cards.map((c) => c.name)
  }

  test('each result carries the oracle-level fields, not just a name', async () => {
    const req = new Request('http://localhost/api/search-cards', {
      method: 'POST',
      body: JSON.stringify({ query: 'The End' }),
    })
    const body = (await (await handleSearchCards(req)).json()) as SearchCardsResponse
    expect(body.cards[0]).toMatchObject({
      name: 'The End',
      // makeScryfallCard's neutral defaults, projected to the wire vocabulary.
      set: 'tst',
      collectorNumber: '1',
      typeLine: 'Artifact',
      cmc: 0,
      colorIdentity: [],
    })
  })

  test("a whole-name match leads Scryfall's popularity order", async () => {
    // Scryfall answered with "The End" third; the rest keep their popularity order.
    expect(await search('The End')).toEqual([
      'The End',
      ...CARD_NAMES.filter((name) => name !== 'The End'),
    ])
  })

  test('a query matching no name in full keeps the popularity order', async () => {
    expect(await search('The En')).toEqual(CARD_NAMES)
  })

  test('a missing query is a 400', async () => {
    const req = new Request('http://localhost/api/search-cards', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    expect((await handleSearchCards(req)).status).toBe(400)
  })
})

/**
 * `GET /api/card-search` runs one page of a raw Scryfall query. Unlike
 * `/api/search-cards` it neither promotes whole-name matches nor writes to the
 * card cache — it hands back exactly the page Scryfall returned.
 */
describe('handleCardSearch', () => {
  const originalFetch = globalThis.fetch
  let requestedUrls: string[]

  // No workspace and no seeded cache: this route neither reads nor writes the
  // card cache, so the only external it has is `fetch`.
  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  /** Answer every Scryfall search with `body`, recording the URLs asked for. */
  function stubScryfall(
    body: ScryfallList<ScryfallCard> | ScryfallErrorBody | ScryfallErrorDetails,
    status = 200,
  ): void {
    requestedUrls = []
    const stub = (input: string | URL | Request): Promise<Response> => {
      requestedUrls.push(input instanceof Request ? input.url : String(input))
      return Promise.resolve(Response.json(body, { status }))
    }
    globalThis.fetch = stub as typeof fetch
  }

  type SearchRun = { status: number; body: CardSearchResponse }

  async function search(query: string): Promise<SearchRun> {
    const resp = await handleCardSearch(new Request(`http://localhost/api/card-search?${query}`))
    return { status: resp.status, body: (await resp.json()) as CardSearchResponse }
  }

  /** Narrow a response to its success arm, failing the test if it is not one. */
  function succeeded(body: CardSearchResponse): CardSearchSuccess {
    expect(body.success).toBeTrue()
    if (!body.success) throw new Error('expected the success arm')
    return body
  }

  /** Narrow a response to its failure arm, failing the test if it is not one. */
  function failed(body: CardSearchResponse): CardSearchFailure {
    expect(body.success).toBeFalse()
    if (body.success) throw new Error('expected the failure arm')
    return body
  }

  test('returns one page of card summaries with the paging metadata', async () => {
    stubScryfall({
      object: 'list',
      has_more: true,
      total_cards: 412,
      data: [makeScryfallCard({ name: 'The End', mana_cost: '{4}{B}{B}', cmc: 6 })],
    })

    const page = succeeded((await search('q=t%3Asaga&page=2')).body)
    expect(page.page).toBe(2)
    expect(page.hasMore).toBeTrue()
    expect(page.totalCards).toBe(412)
    expect(page.cards).toHaveLength(1)
    expect(page.cards[0]).toMatchObject({ name: 'The End', manaCost: '{4}{B}{B}', cmc: 6 })
    // Exactly one request, for the page asked for — the route never crawls.
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain('page=2')
  })

  test('a Scryfall 404 is an empty result, not an error', async () => {
    stubScryfall({ object: 'error' }, 404)

    const page = succeeded((await search('q=set%3Anope')).body)
    expect(page.cards).toEqual([])
    expect(page.hasMore).toBeFalse()
  })

  test('a query Scryfall refuses is a 400 carrying its explanation', async () => {
    stubScryfall({ object: 'error', details: "Expected a colon after 'notafilter'." }, 422)

    const { status, body } = await search('q=notafilter%3Dfoo')
    expect(status).toBe(400)
    expect(failed(body).message).toBe("Expected a colon after 'notafilter'.")
  })

  test('the query is trimmed before it reaches Scryfall', async () => {
    stubScryfall({ object: 'list', has_more: false, data: [] })

    await search('q=%20%20t%3Asaga%20%20')
    expect(requestedUrls[0]).toContain(`q=${encodeURIComponent('t:saga')}&`)
  })

  test.each([
    ['missing', 'http://localhost/api/card-search'],
    ['blank', 'http://localhost/api/card-search?q=%20%20'],
  ])('a %s q is a 400 that never reaches Scryfall', async (_label, url) => {
    stubScryfall({ object: 'list', has_more: false, data: [] })

    const resp = await handleCardSearch(new Request(url))
    expect(resp.status).toBe(400)
    expect(requestedUrls).toEqual([])
  })
})
