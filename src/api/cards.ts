import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { getErrorMessage } from '../errors'
import type { ScryfallCard } from '../types'

/** Upper bound on IDs per request, so one call can't ask for the whole cache. */
export const MAX_CARD_IDS = 200

export type CardsResponse = {
  success: boolean
  /** The cards found, in no particular order. IDs the cache doesn't hold are omitted. */
  cards: ScryfallCard[]
  message?: string
}

/** Parse the `ids` query param into unique IDs, or an error message. */
export function parseCardIdsParam(raw: string | null): string[] | string {
  if (raw === null) return 'ids is required'
  const ids = [...new Set(raw.split(',').map((id) => id.trim()))].filter((id) => id.length > 0)
  if (ids.length === 0) return 'ids must contain at least one Scryfall ID'
  if (ids.length > MAX_CARD_IDS) return `ids must contain at most ${MAX_CARD_IDS} entries`
  return ids
}

/**
 * Cache-only card lookup by Scryfall ID: `GET /api/cards?ids=a,b,c`.
 *
 * This is what lets the hosted public site restore a shared trade link — whose
 * rows are encoded by Scryfall ID — without the browser talking to Scryfall.
 * Unlike `/api/card-printings` there is no Scryfall fallback: an ID the cache
 * doesn't hold is left out of the response, keeping the endpoint's cost bounded
 * (the static site asks Scryfall directly instead).
 */
export async function handleCards(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const ids = parseCardIdsParam(url.searchParams.get('ids'))
    if (typeof ids === 'string') {
      const resp: CardsResponse = { success: false, cards: [], message: ids }
      return Response.json(resp, { status: 400 })
    }

    const found = await scryfallIdIndex.lookup(ids)
    const resp: CardsResponse = { success: true, cards: [...found.values()] }
    return Response.json(resp)
  } catch (error) {
    const resp: CardsResponse = { success: false, cards: [], message: getErrorMessage(error) }
    return Response.json(resp, { status: 500 })
  }
}
