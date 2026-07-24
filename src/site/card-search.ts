import type { ScryfallCard, ScryfallList } from '../types'
import type { AutocompleteResponse } from '../api/autocomplete'
import type { CardPrintingsResponse } from '../api/card-printings'
import { getPrintingsByName, putFetchedPrintings } from './session-cache'
import { promoteFullNameMatches } from '../term-match'
import { apiActive, apiUrl } from './api-base'
import { isAbortError } from './utils'

/**
 * The public site's browser-side card search (the trade page's search box and
 * the list editors' search modal). Each call dispatches on the API base: with a
 * live backend the queries go to its cache-backed endpoints — the same
 * term-separation matching the admin editor has — and without one they go
 * straight to Scryfall, the serverless site's only option.
 *
 * Callers own their own UI state (debouncing, loading flags, abort signals). An
 * `AbortSignal` passed here is forwarded to `fetch`, and a cancelled request
 * rejects with an `AbortError` rather than resolving empty, so the caller can
 * tell "cancelled" apart from "no results". Autocomplete rejects on a network
 * failure too — its caller would rather warn and leave the suggestions already on
 * screen than blank them — while a printings lookup resolves empty, since it has
 * a fallback to try before giving up.
 */

const SCRYFALL_API = 'https://api.scryfall.com'

type ScryfallAutocompleteResponse = {
  object: string
  total_values: number
  data: string[]
}

export type CardSearchRequestOptions = {
  signal?: AbortSignal
}

/**
 * Autocomplete card names for a partial query.
 *
 * Backed by a live API, the server term-matches and ranks over its card cache
 * (`in tre` finds "In the Trenches"), and its order is used verbatim. Without
 * one, the query is asked of Scryfall as-is — deliberately NOT the term
 * matching the CLI and admin editor apply, since Scryfall's autocomplete
 * matches the query as one contiguous string; the public site surfaces
 * Scryfall's own results rather than approximating the local semantics with
 * extra requests, and its search UI says so (see `siteSearch`'s `sourceNote`).
 * Scryfall ranks its suggestions by popularity, so a name the query already
 * spells out in full is floated to the top (see {@link promoteFullNameMatches}).
 */
export async function autocompleteCardNames(
  query: string,
  options: CardSearchRequestOptions = {},
): Promise<string[]> {
  if (apiActive()) {
    const resp = await fetch(apiUrl(`api/autocomplete?q=${encodeURIComponent(query)}`), options)
    if (!resp.ok) return []
    const data = (await resp.json()) as AutocompleteResponse
    return data.success ? data.names : []
  }

  const url = `${SCRYFALL_API}/cards/autocomplete?q=${encodeURIComponent(query)}`
  const resp = await fetch(url, options)
  if (!resp.ok) return []
  const data = (await resp.json()) as ScryfallAutocompleteResponse
  return promoteFullNameMatches(data.data ?? [], query, (name) => name)
}

/**
 * All printings of an exact card name, newest first.
 *
 * Printings are read through the in-memory session cache: a name already shipped
 * in the list data (or fetched earlier this session) is reused instead of a new
 * request; fresh fetches are recorded back into the cache. With a live API the
 * lookup is answered from the server's card cache. On Scryfall, the exact-name
 * search 404s for some names (tokens, edge cases), so a failed search falls back
 * to a fuzzy named lookup, which yields the single card it resolves to.
 */
export async function fetchCardPrintings(
  cardName: string,
  options: CardSearchRequestOptions = {},
): Promise<ScryfallCard[]> {
  // A cache hit answers even an already-cancelled request: there is no network
  // work left to cancel, so there is nothing to reject.
  const cached = getPrintingsByName(cardName)
  if (cached) return cached

  if (apiActive()) {
    const resp = await get(
      apiUrl(`api/card-printings?name=${encodeURIComponent(cardName)}`),
      options,
    )
    if (!resp?.ok) return []
    const data = (await resp.json()) as CardPrintingsResponse
    return data.success ? cachePrintings(cardName, data.printings) : []
  }

  const exact = encodeURIComponent(`!"${cardName}"`)
  const searchUrl = `${SCRYFALL_API}/cards/search?q=${exact}&unique=prints&order=released&dir=desc`
  const search = await get(searchUrl, options)

  if (search?.ok) {
    const data = (await search.json()) as ScryfallList<ScryfallCard>
    return cachePrintings(cardName, data.data ?? [])
  }

  const namedUrl = `${SCRYFALL_API}/cards/named?fuzzy=${encodeURIComponent(cardName)}`
  const named = await get(namedUrl, options)
  if (!named?.ok) return []
  return cachePrintings(cardName, [(await named.json()) as ScryfallCard])
}

/**
 * A GET whose only failure worth surfacing is cancellation: an unreachable
 * backend answers `null`, same as a 404 answers a non-ok response, so callers
 * can treat "couldn't ask" and "nothing there" alike.
 */
async function get(url: string, options: CardSearchRequestOptions): Promise<Response | null> {
  try {
    return await fetch(url, options)
  } catch (error) {
    if (isAbortError(error)) throw error
    return null
  }
}

function cachePrintings(cardName: string, printings: ScryfallCard[]): ScryfallCard[] {
  putFetchedPrintings(cardName, printings, Date.now())
  return printings
}
