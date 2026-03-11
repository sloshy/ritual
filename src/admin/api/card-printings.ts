import { getCardPrintings } from '../../scryfall'
import { cardCache } from '../../cache'
import { getErrorMessage } from '../../errors'

export async function handleCardPrintings(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const name = url.searchParams.get('name')

    if (!name) {
      return Response.json(
        { success: false, printings: [], message: 'name is required' },
        { status: 400 },
      )
    }

    // Try cache first
    const cached = await cardCache.get(name)
    if (cached && cached.length > 0) {
      return Response.json({ success: true, printings: cached })
    }

    // Fallback to API
    const printings = await getCardPrintings(name)
    return Response.json({ success: true, printings })
  } catch (error) {
    return Response.json(
      { success: false, printings: [], message: getErrorMessage(error) },
      { status: 500 },
    )
  }
}
