import { cardCache } from '../cache'
import { getErrorMessage } from '../errors'
import { matchesNameTerms, normalizeCardName, rankNameMatches, splitNameTerms } from '../term-match'

/** How many suggestions the editor's search box is offered. */
const MAX_SUGGESTIONS = 20

export type AutocompleteResponse = {
  success: boolean
  names: string[]
  message?: string
}

export async function handleAutocomplete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const rawQuery = url.searchParams.get('q')?.trim()
    if (!rawQuery || rawQuery.length < 2) {
      return Response.json({ success: true, names: [] })
    }

    // Fold case, diacritics, and punctuation so "jotun" matches "Jötun Grunt" and
    // "jaces archivist" matches "Jace's Archivist". Each whitespace-separated term
    // is matched on its own — the same rule the CLI prompts use — so "in tre" finds
    // "In the Trenches".
    const terms = splitNameTerms(rawQuery)
    if (terms.length === 0) {
      return Response.json({ success: true, names: [] })
    }

    const allNames = await cardCache.keys()
    const matches = allNames.filter((name) => matchesNameTerms(normalizeCardName(name), terms))

    // Alphabetical is the tiebreak the cache can offer (it holds no popularity
    // order), applied before the ranking so it only orders equally good matches.
    matches.sort((a, b) => a.localeCompare(b))
    const names = rankNameMatches(matches, rawQuery, (name) => name).slice(0, MAX_SUGGESTIONS)
    return Response.json({ success: true, names })
  } catch (error) {
    return Response.json(
      { success: false, names: [], message: getErrorMessage(error) },
      { status: 500 },
    )
  }
}
