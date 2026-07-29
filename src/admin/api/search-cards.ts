import { searchCards } from '../../scryfall'
import { getErrorMessage } from '../../errors'
import { promoteFullNameMatches } from '../../term-match'
import { summarizeCard, type CardSummary } from '../../api/card-summary'

/** `POST /api/search-cards` request body. */
export type SearchCardsRequest = {
  query: string
}

/** `POST /api/search-cards` body: up to 20 card summaries, most popular first. */
export type SearchCardsResponse = {
  success: boolean
  cards: CardSummary[]
  message?: string
}

/**
 * Validate an untrusted request body into a {@link SearchCardsRequest}, or
 * return the error message explaining why it is not usable.
 */
export function parseSearchCardsBody(body: unknown): SearchCardsRequest | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be a JSON object.'
  }
  const { query } = body as Record<string, unknown>
  if (typeof query !== 'string' || query.trim() === '') return 'query is required.'
  return { query }
}

/**
 * `POST /api/search-cards` — search Scryfall with its raw query syntax and
 * return up to 20 card summaries. Printings Scryfall returns under a name the
 * local card cache does not already hold are written to it on the way through
 * (an already-cached name is left as it is — this is a warm-up, not a refresh);
 * `GET /api/card-search` never writes at all. One result page is fetched; use
 * `/api/card-search` to walk further pages.
 */
export async function handleSearchCards(req: Request): Promise<Response> {
  try {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      const resp: SearchCardsResponse = {
        success: false,
        cards: [],
        message: 'Request body must be JSON.',
      }
      return Response.json(resp, { status: 400 })
    }

    const parsed = parseSearchCardsBody(raw)
    if (typeof parsed === 'string') {
      const resp: SearchCardsResponse = { success: false, cards: [], message: parsed }
      return Response.json(resp, { status: 400 })
    }
    const { query } = parsed

    // Scryfall returns these in EDHRec order, which buries an unpopular card even
    // when the query is its exact name — promote whole-name matches before the cut.
    // The search itself is left at `searchCards`' bounded default of one page.
    const results = promoteFullNameMatches(await searchCards(query), query, (c) => c.name)
    const cards: CardSummary[] = results.slice(0, 20).map(summarizeCard)
    const resp: SearchCardsResponse = { success: true, cards }
    return Response.json(resp)
  } catch (error) {
    const msg = getErrorMessage(error)
    const resp: SearchCardsResponse = { success: false, cards: [], message: msg }
    return Response.json(resp, { status: 500 })
  }
}
