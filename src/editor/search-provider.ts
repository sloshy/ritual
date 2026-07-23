import type { ScryfallCard } from '../types'

/**
 * A subtle attribution note about where a provider's searches go, rendered by
 * the search UI as `{prefix}<a href={linkUrl}>{linkText}</a>{suffix}`. Present
 * on providers whose backend (and therefore result set) differs from the local
 * card cache the other editors search.
 */
export type SearchSourceNote = {
  prefix: string
  linkText: string
  linkUrl: string
  suffix: string
}

/**
 * Pluggable card-search backend for {@link CardSearchModal}. The admin editor
 * resolves searches against its own API (which is backed by the local Scryfall
 * cache); the public site resolves them directly against Scryfall. Both return
 * the same shapes so the modal is agnostic to the source.
 */
export type SearchProvider = {
  /** Autocomplete card names for a partial query (already debounced by the caller). */
  autocomplete: (query: string) => Promise<string[]>
  /** All printings of an exact card name, newest first. */
  printings: (cardName: string) => Promise<ScryfallCard[]>
  /** Shown subtly in the search UI when the backend warrants a heads-up. */
  sourceNote?: SearchSourceNote
}

type AutocompleteResponse = { success: boolean; names: string[] }
type PrintingsResponse = { success: boolean; printings: ScryfallCard[] }

/**
 * Admin {@link SearchProvider}: hits the admin server's `/api/autocomplete` and
 * `/api/card-printings`, which serve data from the local Scryfall cache.
 */
export function createApiSearchProvider(): SearchProvider {
  return {
    autocomplete: async (query) => {
      const resp = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as AutocompleteResponse
      return data.success ? data.names : []
    },
    printings: async (cardName) => {
      const resp = await fetch(`/api/card-printings?name=${encodeURIComponent(cardName)}`, {
        credentials: 'same-origin',
      })
      const data = (await resp.json()) as PrintingsResponse
      return data.success ? data.printings : []
    },
  }
}
