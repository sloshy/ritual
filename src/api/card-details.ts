import { getCardPrintings } from '../scryfall'
import { getErrorMessage } from '../errors'
import { detailCard, type CardDetails } from './card-summary'

/** The card was found. */
export type CardDetailsSuccess = {
  success: true
  card: CardDetails
}

/** No such card, or the lookup failed. `card` is still present, as null. */
export type CardDetailsFailure = {
  success: false
  card: null
  message: string
}

/** `GET /api/card-details` body. */
export type CardDetailsResponse = CardDetailsSuccess | CardDetailsFailure

function errorResponse(message: string, status: number): Response {
  const body: CardDetailsFailure = { success: false, card: null, message }
  return Response.json(body, { status })
}

/**
 * `GET /api/card-details?name=` — everything known about one card: oracle text,
 * type line, mana cost/CMC, colors and color identity, keywords, format
 * legalities, and Scryfall Tagger oracle/art tags.
 *
 * Reads the local Scryfall cache first, falling back to a single-card Scryfall
 * fetch when the cache has no printings for the name (same path
 * `/api/card-printings` takes). Oracle-level fields are identical across
 * printings, so the response describes *the card*, with the **most recent**
 * printing's identity (`set`, `collectorNumber`, `prices`) attached —
 * `getCardPrintings` sorts newest first — and `printingCount` reporting how many
 * printings were found.
 *
 * `colors`, `keywords`, and `legalities` are only present on cards written by a
 * cache from this version onward — run `ritual cache preload-all` to backfill.
 */
export async function handleCardDetails(req: Request): Promise<Response> {
  try {
    const name = new URL(req.url).searchParams.get('name')
    if (!name || name.trim() === '') return errorResponse('name is required.', 400)

    const printings = await getCardPrintings(name)
    if (printings.length === 0) {
      return errorResponse(
        `No card named '${name}'. Names are matched exactly — use /api/autocomplete to resolve a partial name.`,
        404,
      )
    }

    const body: CardDetailsSuccess = {
      success: true,
      card: detailCard(printings[0]!, printings.length),
    }
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}
