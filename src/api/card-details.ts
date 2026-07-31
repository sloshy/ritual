// An HTTP handler module that is server-agnostic: `src/api/` means "handlers no
// server owns", not "handlers both servers mount". This one is currently mounted
// on the admin server only.
import { getCardPrintingsResult } from '../scryfall'
import { printingsAreComplete } from '../card-printing'
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
 * printings were found. `printingsComplete` is false when that count came from
 * the single-card fallback rather than the cache's own printing list.
 *
 * `colors`, `keywords`, and `legalities` are only present on cards written by a
 * cache from this version onward — run `ritual cache preload-all` to backfill.
 */
export async function handleCardDetails(req: Request): Promise<Response> {
  try {
    // Trimmed at the parse boundary, not just for the emptiness check: the name
    // is a cache key, and `?name=%20Sol+Ring` must resolve like `Sol Ring`.
    const name = new URL(req.url).searchParams.get('name')?.trim()
    if (!name) return errorResponse('name is required.', 400)

    const result = await getCardPrintingsResult(name)
    const printings = result.printings
    if (printings.length === 0) {
      return errorResponse(
        `No card named '${name}'. Names are matched exactly — resolve a partial name with /api/autocomplete (MCP: the autocomplete_card tool).`,
        404,
      )
    }

    const body: CardDetailsSuccess = {
      success: true,
      card: detailCard(printings[0]!, printings.length, printingsAreComplete(result)),
    }
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500)
  }
}
