import { cardCache } from '../cache'
import { compareData } from '../i18n/collate'
import { apiError } from './http'
import { getErrorMessage } from '../util/errors'
import {
  matchesNameTerms,
  normalizeCardName,
  rankNameMatches,
  splitNameTerms,
} from '../card/term-match'

/** How many suggestions the editor's search box is offered. */
const MAX_SUGGESTIONS = 20

/** `GET /api/autocomplete?q=` — card names from the local cache matching the query. */
export type AutocompleteResponse = {
  success: true
  names: string[]
}

function namesResponse(names: string[]): AutocompleteResponse {
  return { success: true, names }
}

export async function handleAutocomplete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const rawQuery = url.searchParams.get('q')?.trim()
    if (!rawQuery || rawQuery.length < 2) return Response.json(namesResponse([]))

    // Fold case, diacritics, and punctuation so "jotun" matches "Jötun Grunt" and
    // "jaces archivist" matches "Jace's Archivist". Each whitespace-separated term
    // is matched on its own — the same rule the CLI prompts use — so "in tre" finds
    // "In the Trenches".
    const terms = splitNameTerms(rawQuery)
    if (terms.length === 0) return Response.json(namesResponse([]))

    const allNames = await cardCache.keys()
    const matches = allNames.filter((name) => matchesNameTerms(normalizeCardName(name), terms))

    // Alphabetical is the tiebreak the cache can offer (it holds no popularity
    // order), applied before the ranking so it only orders equally good matches.
    matches.sort((a, b) => compareData(a, b))
    const names = rankNameMatches(matches, rawQuery, (name) => name).slice(0, MAX_SUGGESTIONS)
    return Response.json(namesResponse(names))
  } catch (error) {
    return apiError(getErrorMessage(error), 500)
  }
}
