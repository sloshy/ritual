import type { ScryfallCard, ScryfallList } from '../types'
import { getPrintingsByName, putFetchedPrintings } from './session-cache'
import { promoteFullNameMatches } from '../term-match'

/**
 * The public site's browser-side Scryfall client. The site is serverless, so its
 * card search (the trade page's search box and the list editors' search modal)
 * talks to Scryfall from the browser instead of going through the admin API.
 * Both surfaces need the same two calls, so they live here: autocomplete a
 * partial name, then fetch every printing of an exact name.
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

export type ScryfallRequestOptions = {
  signal?: AbortSignal
}

/** Whether a caught error is a `fetch` cancelled through its {@link AbortSignal}. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Autocomplete card names for a partial query, asked of Scryfall as-is.
 *
 * Deliberately NOT the term matching the CLI and admin editor apply (`in tre`
 * finding "In the Trenches") — that semantic belongs to searches over the local
 * card cache, while Scryfall's autocomplete matches the query as one contiguous
 * string. The public site surfaces Scryfall's own results rather than
 * approximating the local semantics with extra requests, and its search UI says
 * so (see the Scryfall provider's `sourceNote`). Scryfall ranks its suggestions
 * by popularity, so a name the query already spells out in full is floated to
 * the top (see {@link promoteFullNameMatches}).
 */
export async function autocompleteCardNames(
  query: string,
  options: ScryfallRequestOptions = {},
): Promise<string[]> {
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
 * in the baked list data (or fetched earlier this session) is reused instead of
 * hitting Scryfall again; fresh fetches are recorded back into the cache. The
 * exact-name search 404s for some names (tokens, edge cases), so a failed search
 * falls back to a fuzzy named lookup, which yields the single card it resolves to.
 */
export async function fetchCardPrintings(
  cardName: string,
  options: ScryfallRequestOptions = {},
): Promise<ScryfallCard[]> {
  // A cache hit answers even an already-cancelled request: there is no network
  // work left to cancel, so there is nothing to reject.
  const cached = getPrintingsByName(cardName)
  if (cached) return cached

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
 * Scryfall answers `null`, same as a 404 answers a non-ok response, so callers
 * can treat "couldn't ask" and "nothing there" alike.
 */
async function get(url: string, options: ScryfallRequestOptions): Promise<Response | null> {
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
