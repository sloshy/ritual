import { scryfallIdIndex } from '../cache/scryfall-id-index'
import { caughtMessage, statusForError } from './http'
import { apiMessage, isApiMessage, pickMessage, type ApiMessage } from './result'
import type { SyncMessage } from '../sync/message'
import type { ScryfallCard } from '../scryfall/types'

/** Upper bound on IDs per request, so one call can't ask for the whole cache. */
export const MAX_CARD_IDS = 200

/** The lookup ran. */
export type CardsSuccess = {
  success: true
  /** The cards found, in no particular order. IDs the cache doesn't hold are omitted. */
  cards: ScryfallCard[]
}

/**
 * The request was refused or the lookup failed; `cards` stays, empty. A failure
 * carries the message triple; one raised with a catalog key (a cache error)
 * carries its key and possibly nested params.
 */
export type CardsFailure = SyncMessage & {
  success: false
  cards: []
}

/** `GET /api/cards` body. */
export type CardsResponse = CardsSuccess | CardsFailure

/** The one refusal body for this route, at `status`. */
function cardsRefusal(message: SyncMessage, status: number): Response {
  const body: CardsFailure = { success: false, cards: [], ...pickMessage(message) }
  return Response.json(body, { status })
}

/** Parse the `ids` query param into unique IDs, or its refusal as English plus its key. */
export function parseCardIdsParam(raw: string | null): string[] | ApiMessage {
  if (raw === null) return apiMessage('admin.api.field.required', { field: 'ids' })
  const ids = [...new Set(raw.split(',').map((id) => id.trim()))].filter((id) => id.length > 0)
  if (ids.length === 0) return apiMessage('admin.api.cards.idsEmpty')
  if (ids.length > MAX_CARD_IDS) {
    return apiMessage('admin.api.field.tooMany', { field: 'ids', count: MAX_CARD_IDS })
  }
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
    if (isApiMessage(ids)) return cardsRefusal(ids, 400)

    const found = await scryfallIdIndex.lookup(ids)
    const resp: CardsSuccess = { success: true, cards: [...found.values()] }
    return Response.json(resp)
  } catch (error) {
    return cardsRefusal(caughtMessage(error), statusForError(error))
  }
}
