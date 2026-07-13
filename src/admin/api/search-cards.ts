import { searchCards } from '../../scryfall'
import { getErrorMessage } from '../../errors'
import { promoteFullNameMatches } from '../../term-match'

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

    // Scryfall returns these in EDHRec order, which buries an unpopular card even
    // when the query is its exact name — promote whole-name matches before the cut.
    const results = promoteFullNameMatches(await searchCards(query), query, (c) => c.name)
    const cards: CardResult[] = results.slice(0, 20).map((c) => ({ name: c.name }))
    const resp: SearchCardsResponse = { success: true, cards }
    return Response.json(resp)
  } catch (error) {
    const msg = getErrorMessage(error)
    const resp: SearchCardsResponse = { success: false, cards: [], message: msg }
    return Response.json(resp, { status: 500 })
  }
}
