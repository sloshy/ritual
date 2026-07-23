import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { handleAutocomplete } from '../../src/admin/api/autocomplete'
import { handleSearchCards } from '../../src/admin/api/search-cards'
import { cardCache } from '../../src/cache'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'
import { makeScryfallCard } from '../test-utils'
import type { ScryfallCard } from '../../src/types'

/**
 * The two card-search endpoints behind the admin editor's search modal and the
 * MCP `autocomplete_card` / `search_cards` tools. Autocomplete reads the on-disk
 * Scryfall cache (seeded here in a throwaway workspace); search-cards proxies
 * Scryfall itself (stubbed here). Both must offer a card whose whole name the
 * query spells out ahead of the popular cards that merely contain it.
 */

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
    workspace = await bindWorkspace({ init: true })
    await seedCardCache()
  })

  afterAll(async () => {
    await cardCache.clear()
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
  type SearchCardsBody = { success: boolean; cards: { name: string }[] }

  const originalFetch = globalThis.fetch
  let workspace: BoundWorkspace

  beforeAll(async () => {
    workspace = await bindWorkspace({ init: true })
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
    await cardCache.clear()
    await workspace.dispose()
  })

  async function search(query: string): Promise<string[]> {
    const req = new Request('http://localhost/api/search-cards', {
      method: 'POST',
      body: JSON.stringify({ query }),
    })
    const resp = await handleSearchCards(req)
    expect(resp.status).toBe(200)
    const body = (await resp.json()) as SearchCardsBody
    expect(body.success).toBe(true)
    return body.cards.map((c) => c.name)
  }

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
