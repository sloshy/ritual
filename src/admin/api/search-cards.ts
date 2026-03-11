import { searchCards } from '../../scryfall'
import { getErrorMessage } from '../../errors'

interface SearchCardsRequest {
  query: string
}

interface CardResult {
  name: string
}

interface SearchCardsResponse {
  success: boolean
  cards: CardResult[]
  message?: string
}

export async function handleSearchCards(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as SearchCardsRequest
    const { query } = body

    if (!query) {
      const resp: SearchCardsResponse = { success: false, cards: [], message: 'query is required' }
      return Response.json(resp, { status: 400 })
    }

    const results = await searchCards(query)
    const cards = results.slice(0, 20).map((c) => ({ name: c.name }))
    const resp: SearchCardsResponse = { success: true, cards }
    return Response.json(resp)
  } catch (error) {
    const msg = getErrorMessage(error)
    const resp: SearchCardsResponse = { success: false, cards: [], message: msg }
    return Response.json(resp, { status: 500 })
  }
}
