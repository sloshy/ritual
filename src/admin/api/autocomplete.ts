import { cardCache } from '../../cache'
import { getErrorMessage } from '../../errors'

export async function handleAutocomplete(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const query = url.searchParams.get('q')?.trim().toLowerCase()

    if (!query || query.length < 2) {
      return Response.json({ success: true, names: [] })
    }

    const allNames = await cardCache.keys()

    const prefixMatches: string[] = []
    const substringMatches: string[] = []

    for (const name of allNames) {
      const lower = name.toLowerCase()
      if (lower.startsWith(query)) {
        prefixMatches.push(name)
      } else if (lower.includes(query)) {
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
