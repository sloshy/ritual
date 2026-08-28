import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { handleAutocomplete } from '../../src/api/autocomplete'
import {
  DEFAULT_WARM_LIMIT,
  handleCardSearch,
  type CardSearchFailure,
  type CardSearchResponse,
  type CardSearchSuccess,
} from '../../src/api/card-search'
import { cardCache } from '../../src/cache'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { stubFetch, type StubbedFetch } from '../helpers/stub-fetch'
import { makeScryfallCard, seedCardNames } from '../test-utils'
import type { ScryfallCard, ScryfallList } from '../../src/scryfall/types'

/**
 * The card-lookup endpoints behind the admin editor's search modal and the MCP
 * `autocomplete_card` / `search_scryfall` tools.
 *
 * `GET /api/autocomplete` reads the on-disk Scryfall cache (seeded here in a
 * throwaway workspace). `GET /api/card-search` proxies Scryfall itself (stubbed
 * here) and carries both halves of what used to be two routes: a plain read that
 * returns the page as Scryfall ordered it and touches no cache, and
 * `warm=true`, which filters to real printings, writes names the cache lacks
 * into it, promotes whole-name matches ahead of Scryfall's popularity order, and
 * caps the result. The strict error contract — a refused query is a 400, a
 * Scryfall server error is a 500, never an empty 200 — applies to both modes.
 *
 * Autocomplete and a warming search must both offer a card whose whole name the
 * query spells out ahead of the popular cards that merely contain it.
 */

/** Scryfall's error object, as it answers a search that matched nothing. */
type ScryfallErrorBody = { object: 'error' }

/** Scryfall's error object when it explains itself (a malformed query). */
type ScryfallErrorDetails = { object: 'error'; details: string }

/** Anything Scryfall can answer a search with, as these tests stage it. */
type ScryfallSearchBody = ScryfallList<ScryfallCard> | ScryfallErrorBody | ScryfallErrorDetails

/** The installed stub, so both describes read the URLs it recorded the same way. */
let scryfall: StubbedFetch

/**
 * Answer every Scryfall search with `body`, at `status`, discarding whatever the
 * previous test staged. One helper for both modes: the two describes stub the
 * same endpoint and differ only in what they assert about the answer.
 */
function stubScryfall(body: ScryfallSearchBody, status = 200): void {
  scryfall = stubFetch({ 'https://api.scryfall.com': () => Response.json(body, { status }) })
}

/** The URLs the current stub has been asked for, in order. */
function requestedUrls(): string[] {
  return scryfall.sent.map((request) => request.url)
}

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

describe('handleAutocomplete', () => {
  type AutocompleteBody = { success: boolean; names: string[] }

  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ init: true, clearCardCache: true })
    await seedCardNames(...CARD_NAMES)
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

/**
 * The plain read: one page of a raw Scryfall query, handed back exactly as
 * Scryfall ordered it, with no promotion and no cache write.
 */
describe('handleCardSearch', () => {
  // No workspace and no seeded cache: this route neither reads nor writes the
  // card cache, so the only external it has is `fetch`.
  afterAll(() => {
    scryfall.restore()
  })

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
    expect(requestedUrls()).toHaveLength(1)
    expect(requestedUrls()[0]).toContain('page=2')
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
    expect(requestedUrls()[0]).toContain(`q=${encodeURIComponent('t:saga')}&`)
  })

  test.each([
    ['missing', 'http://localhost/api/card-search'],
    ['blank', 'http://localhost/api/card-search?q=%20%20'],
  ])('a %s q is a 400 that never reaches Scryfall', async (_label, url) => {
    stubScryfall({ object: 'list', has_more: false, data: [] })

    const resp = await handleCardSearch(new Request(url))
    expect(resp.status).toBe(400)
    expect(requestedUrls()).toEqual([])
  })
})

/**
 * The warming mode, folded in from what used to be `POST /api/search-cards`.
 * Everything the old route did must still happen — real-printing filtering,
 * cache warming that never overwrites, whole-name promotion, the 20-result cap —
 * and the strict error contract it lacked now applies to it too.
 */
describe('handleCardSearch with warm=true', () => {
  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ init: true, clearCardCache: true })
  })

  afterAll(async () => {
    scryfall.restore()
    await workspace.dispose()
  })

  /** Scryfall answers popular cards first, since the route queries with order=edhrec. */
  function stubPopularityOrder(names: string[] = CARD_NAMES): void {
    stubScryfall({
      object: 'list',
      has_more: false,
      data: names.map((name) => makeScryfallCard({ name })),
    })
  }

  async function warmSearch(query: string, extra = ''): Promise<CardSearchSuccess> {
    const resp = await handleCardSearch(
      new Request(
        `http://localhost/api/card-search?warm=true&q=${encodeURIComponent(query)}${extra}`,
      ),
    )
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as CardSearchResponse
    expect(body.success).toBeTrue()
    if (!body.success) throw new Error('expected the success arm')
    return body
  }

  test('each result carries the oracle-level fields, not just a name', async () => {
    stubPopularityOrder(['The End'])

    const body = await warmSearch('The End')
    expect(body.warmed).toBeTrue()
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
    stubPopularityOrder()

    // Scryfall answered with "The End" third; the rest keep their popularity order.
    const body = await warmSearch('The End')
    expect(body.cards.map((card) => card.name)).toEqual([
      'The End',
      ...CARD_NAMES.filter((name) => name !== 'The End'),
    ])
  })

  test('a query matching no name in full keeps the popularity order', async () => {
    stubPopularityOrder()

    expect((await warmSearch('The En')).cards.map((card) => card.name)).toEqual(CARD_NAMES)
  })

  test(`results are capped at ${DEFAULT_WARM_LIMIT} unless limit says otherwise`, async () => {
    const many = Array.from({ length: DEFAULT_WARM_LIMIT + 5 }, (_, i) => `Filler Card ${i}`)
    stubPopularityOrder(many)

    expect((await warmSearch('filler')).cards).toHaveLength(DEFAULT_WARM_LIMIT)
    expect((await warmSearch('filler', '&limit=3')).cards).toHaveLength(3)
  })

  test('a name the cache lacks is written into it', async () => {
    stubPopularityOrder(['Warmed Newcomer'])
    expect(await cardCache.get('Warmed Newcomer')).toBeNull()

    await warmSearch('Warmed Newcomer')

    const cached = await cardCache.get('Warmed Newcomer')
    expect(cached).not.toBeNull()
    expect(cached?.[0]?.name).toBe('Warmed Newcomer')
  })

  test('a non-printing is filtered out and never reaches the cache', async () => {
    // Scryfall answers searches with tokens and art series alongside real cards;
    // `cacheRealPrintings` drops them, which has to hold on both halves — the
    // result the caller sees AND what the warm-up wrote.
    stubScryfall({
      object: 'list',
      has_more: false,
      data: [
        makeScryfallCard({ name: 'Real Warmed Card' }),
        makeScryfallCard({ name: 'Goblin Token', layout: 'token', type_line: 'Token Creature' }),
      ],
    })

    const body = await warmSearch('warmed')
    expect(body.cards.map((card) => card.name)).toEqual(['Real Warmed Card'])
    expect(await cardCache.get('Goblin Token')).toBeNull()
  })

  test('an already-cached name is left as it is — this is a warm-up, not a refresh', async () => {
    await cardCache.set('Held Card', [
      makeScryfallCard({ name: 'Held Card', set: 'old', collector_number: '99' }),
      makeScryfallCard({ name: 'Held Card', set: 'older', collector_number: '98' }),
    ])
    stubPopularityOrder(['Held Card'])

    await warmSearch('Held Card')

    const cached = await cardCache.get('Held Card')
    expect(cached).toHaveLength(2)
    expect(cached?.[0]?.set).toBe('old')
  })

  test('the plain read leaves the cache untouched', async () => {
    stubPopularityOrder(['Untouched Card'])

    const resp = await handleCardSearch(
      new Request('http://localhost/api/card-search?q=Untouched%20Card'),
    )
    const body = (await resp.json()) as CardSearchResponse
    expect(body.success).toBeTrue()
    if (body.success) expect(body.warmed).toBeFalse()
    expect(await cardCache.get('Untouched Card')).toBeNull()
  })

  test('a Scryfall server error is a 500, never an empty result set', async () => {
    stubScryfall({ object: 'error' }, 500)

    const resp = await handleCardSearch(
      new Request('http://localhost/api/card-search?warm=true&q=bolt'),
    )
    expect(resp.status).toBe(500)
    const body = (await resp.json()) as CardSearchResponse
    expect(body.success).toBeFalse()
  })

  test('a missing q is a 400', async () => {
    stubPopularityOrder()

    const resp = await handleCardSearch(new Request('http://localhost/api/card-search?warm=true'))
    expect(resp.status).toBe(400)
  })
})
