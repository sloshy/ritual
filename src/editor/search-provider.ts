import type { ScryfallCard } from '../types'
import type { AutocompleteResponse } from '../api/autocomplete'
import type { CardPrintingsResponse } from '../api/card-printings'
import type { MessageKey } from '../i18n/messages/en'
import type { MessageParams } from '../i18n/t'
import type { MessageSegment } from '../i18n/types'

/**
 * A segment renderer — `useTSegments()` from inside a component, so a note built
 * with it tracks the locale signal and re-renders on a switch.
 */
export type SegmentRenderer = <K extends MessageKey>(
  key: K,
  params: MessageParams<K>,
) => MessageSegment[]

/**
 * A subtle attribution note about where a provider's searches go. Present on
 * providers whose backend (and therefore result set) differs from the local card
 * cache the other editors search.
 *
 * The note is built as segments rather than the `{prefix, linkText, suffix}`
 * triple it used to be: splitting a sentence around its link fixes the link's
 * position in the sentence, which does not survive translation. The search UI
 * renders the one `param` segment as the anchor, wherever it falls.
 */
export type SearchSourceNote = {
  /** Build the note's segments; the single `param` segment becomes the link. */
  segments: (tSegments: SegmentRenderer) => MessageSegment[]
  linkUrl: string
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
      const data = (await resp.json()) as CardPrintingsResponse
      return data.success ? data.printings : []
    },
  }
}
