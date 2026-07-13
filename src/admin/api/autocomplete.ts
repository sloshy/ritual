import { cardCache } from '../../cache'
import { getErrorMessage } from '../../errors'
import { normalizeCardName, promoteFullNameMatches } from '../../term-match'

export async function handleAutocomplete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const rawQuery = url.searchParams.get('q')?.trim()
    if (!rawQuery || rawQuery.length < 2) {
      return Response.json({ success: true, names: [] })
    }

    // Fold case, diacritics, and punctuation so "jotun" matches "Jötun Grunt" and
    // "jaces archivist" matches "Jace's Archivist".
    const query = normalizeCardName(rawQuery)
    if (!query) {
      return Response.json({ success: true, names: [] })
    }

    const allNames = await cardCache.keys()

    const prefixMatches: string[] = []
    const substringMatches: string[] = []

    for (const name of allNames) {
      const normalized = normalizeCardName(name)
      if (normalized.startsWith(query)) {
        prefixMatches.push(name)
      } else if (normalized.includes(query)) {
        substringMatches.push(name)
      }
    }

    prefixMatches.sort((a, b) => a.localeCompare(b))
    substringMatches.sort((a, b) => a.localeCompare(b))

    // A query that spells out a whole card name wins over every partial match,
    // even one that sorts earlier — typing "The End" should offer "The End" first.
    const ranked = promoteFullNameMatches(
      [...prefixMatches, ...substringMatches],
      rawQuery,
      (name) => name,
    )
    const names = ranked.slice(0, 20)
    return Response.json({ success: true, names })
  } catch (error) {
    return Response.json(
      { success: false, names: [], message: getErrorMessage(error) },
      { status: 500 },
    )
  }
}
