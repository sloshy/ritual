import { cardCache } from '../../cache'
import { getErrorMessage } from '../../errors'
import { normalizeForSearch } from '../../term-match'

export async function handleAutocomplete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const rawQuery = url.searchParams.get('q')?.trim()
    if (!rawQuery || rawQuery.length < 2) {
      return Response.json({ success: true, names: [] })
    }

    // Fold case and diacritics so e.g. "jotun" matches "Jötun Grunt".
    const query = normalizeForSearch(rawQuery)
    if (!query) {
      return Response.json({ success: true, names: [] })
    }

    const allNames = await cardCache.keys()

    const prefixMatches: string[] = []
    const substringMatches: string[] = []

    for (const name of allNames) {
      const normalized = normalizeForSearch(name)
      if (normalized.startsWith(query)) {
        prefixMatches.push(name)
      } else if (normalized.includes(query)) {
        substringMatches.push(name)
      }
    }

    prefixMatches.sort((a, b) => a.localeCompare(b))
    substringMatches.sort((a, b) => a.localeCompare(b))

    const names = [...prefixMatches, ...substringMatches].slice(0, 20)
    return Response.json({ success: true, names })
  } catch (error) {
    return Response.json(
      { success: false, names: [], message: getErrorMessage(error) },
      { status: 500 },
    )
  }
}
