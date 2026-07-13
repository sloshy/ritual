import { describe, test, expect, afterEach } from 'bun:test'
import { createScryfallSearchProvider } from '../../../src/site/editor/scryfall-search-provider'

/**
 * The public site's card search goes straight to Scryfall, whose autocomplete is
 * ranked by popularity. The provider's own job is to reorder those suggestions so
 * a name the query already spells out comes first.
 */

const originalFetch = globalThis.fetch

/** Stub Scryfall's autocomplete endpoint with a fixed, popularity-ordered name list. */
function stubAutocomplete(names: string[]): void {
  const stub = (_input: string | URL | Request): Promise<Response> =>
    Promise.resolve(Response.json({ object: 'catalog', total_values: names.length, data: names }))
  globalThis.fetch = stub as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('createScryfallSearchProvider', () => {
  test('offers a fully typed card name ahead of more popular partial matches', async () => {
    stubAutocomplete(['The Enduring Renown', 'The Endless Swarm', 'The End'])
    const suggestions = await createScryfallSearchProvider().autocomplete('The End')
    expect(suggestions[0]).toBe('The End')
  })

  test('leaves Scryfall’s order alone for a partially typed name', async () => {
    const popularityOrder = ['The Enduring Renown', 'The Endless Swarm', 'The End']
    stubAutocomplete(popularityOrder)
    expect(await createScryfallSearchProvider().autocomplete('The En')).toEqual(popularityOrder)
  })
})
