import type { ScryfallCard } from '../../types'
import type { SearchProvider } from '../../editor/search-provider'
import type {
  ScryfallAutocompleteResponse,
  ScryfallListResponse,
} from '../useScryfallBrowserSearch'
import { getPrintingsByName, putFetchedPrintings } from '../session-cache'
import { promoteFullNameMatches } from '../../term-match'

const SCRYFALL_API = 'https://api.scryfall.com'

/**
 * Public-site {@link SearchProvider}: resolves card search directly against
 * Scryfall (the serverless site has no admin API). Mirrors the trade page's
 * browser search — autocomplete by name, then all printings of an exact name,
 * falling back to a fuzzy named lookup when the exact search fails.
 *
 * Printings are read through the in-memory session cache: a name already shipped
 * in the baked list data (or fetched earlier this session) is reused instead of
 * hitting Scryfall again; fresh fetches are recorded back into the cache.
 */
export function createScryfallSearchProvider(): SearchProvider {
  return {
    autocomplete: async (query) => {
      const resp = await fetch(`${SCRYFALL_API}/cards/autocomplete?q=${encodeURIComponent(query)}`)
      if (!resp.ok) return []
      const data = (await resp.json()) as ScryfallAutocompleteResponse
      // Scryfall ranks suggestions by popularity, so promote a name the query
      // already spells out in full (see promoteFullNameMatches).
      return promoteFullNameMatches(data.data ?? [], query, (name) => name)
    },
    printings: async (cardName) => {
      const cached = getPrintingsByName(cardName)
      if (cached) return cached

      const exact = `!"${cardName}"`
      const url = `${SCRYFALL_API}/cards/search?q=${encodeURIComponent(exact)}&unique=prints&order=released&dir=desc`
      const resp = await fetch(url)
      if (resp.ok) {
        const data = (await resp.json()) as ScryfallListResponse
        const printings = data.data ?? []
        putFetchedPrintings(cardName, printings, Date.now())
        return printings
      }
      // Exact search 404s for some names (tokens, edge cases); fall back to fuzzy.
      const named = await fetch(`${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(cardName)}`)
      if (!named.ok) return []
      const printings = [(await named.json()) as ScryfallCard]
      putFetchedPrintings(cardName, printings, Date.now())
      return printings
    },
  }
}
