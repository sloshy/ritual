/** Scryfall search-page result shapes and the error-body reader the client's fetches share. */
import type { ScryfallCard, ScryfallList } from './types'

/**
 * Hard page ceiling for `ScryfallClient.searchAllPages`. At 175 cards a
 * page this is far past any real Scryfall result set (the largest set is a few
 * hundred cards); it exists only so a response that never stops reporting
 * `has_more` terminates.
 */
export const SEARCH_ALL_PAGES_MAX = 1000

/** Extract the human-readable `details` from a Scryfall error body, falling back to the HTTP status. */
export async function readScryfallErrorDetails(response: Response): Promise<string> {
  const errorBody: unknown = await response.json().catch(() => null)
  const details =
    errorBody !== null && typeof errorBody === 'object' && 'details' in errorBody
      ? errorBody.details
      : undefined
  return typeof details === 'string' ? details : `${response.status} ${response.statusText}`
}

/**
 * One fetched search page. `data` is null for a CSV fetch (the page lives in
 * `raw`) and for a Scryfall 404, which means "no matches" — an empty page, not
 * a failure.
 */
export type SearchPage = {
  kind: 'page'
  data: ScryfallList<ScryfallCard> | null
  raw: string
  hasMore: boolean
}

/**
 * Scryfall refused the request. A malformed query is a 4xx here, so callers can
 * blame the query rather than reporting a server error; `message` carries
 * Scryfall's own `details` text when it sent one.
 */
export type SearchPageFailure = {
  kind: 'failed'
  status: number
  message: string
}

/** The outcome of `ScryfallClient.fetchSearchPage`. */
export type SearchPageResult = SearchPage | SearchPageFailure

/**
 * A completed `ScryfallClient.searchAllPages` walk.
 *
 * `matched` and `cards` are deliberately separate. `cards` holds only *real
 * printings* — tokens and art series are dropped on the way into the cache — so
 * a genuine token set (`tmkm`) or an Art Series set returns `cards: []` while
 * having matched plenty. Only `matched === 0` means "Scryfall matched nothing",
 * which is what an unknown set code produces; a caller that reports a typo must
 * branch on `matched`, not on `cards.length`.
 */
export type SearchAllPagesSuccess = {
  kind: 'cards'
  /** Real printings, cached as a side effect of the walk. */
  cards: ScryfallCard[]
  /** How many items Scryfall returned in total, before the real-printing filter. */
  matched: number
}

/**
 * The outcome of `ScryfallClient.searchAllPages` — what the query matched,
 * or why the search did not happen.
 *
 * The point of the variant is that an HTTP failure comes back as data rather
 * than as an empty result, so `cache preload-set` can tell a typo'd set code
 * from a dead network.
 */
export type SearchAllPagesResult = SearchAllPagesSuccess | SearchPageFailure
