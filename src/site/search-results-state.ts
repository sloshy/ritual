import { createSignal } from 'solid-js'
import type { LoadedListDetail } from './combined-list'

/**
 * The "View As List" hand-off from the Find page to the Search Results view.
 *
 * The Find page has already loaded every list's detail and matched a subset of
 * cards; rather than re-encode that subset into the URL (it can be hundreds of
 * cards), it stashes the loaded details of the lists that contributed a match
 * plus the global select-keys of the matched cards here. The Search Results
 * page rebuilds the cards from these — so prices still react to currency and
 * in-session "Update Prices" — and filters to the matched keys.
 */
export interface SearchResultsData {
  /** Loaded details of the lists that contributed at least one matched card. */
  loaded: LoadedListDetail[]
  /** Global select-keys of the matched cards (see {@link CombinedCardData.selectKey}). */
  matchedKeys: ReadonlySet<string>
}

const [searchResults, setSearchResults] = createSignal<SearchResultsData | null>(null)

export { searchResults }

export function setSearchResultsData(data: SearchResultsData): void {
  setSearchResults(data)
}

export function clearSearchResults(): void {
  setSearchResults(null)
}
