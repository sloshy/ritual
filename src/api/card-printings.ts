// An HTTP handler module that is server-agnostic: `src/api/` means "handlers no
// server owns", not "handlers both servers mount". This one is mounted on both
// the admin server and the public/hosted site server.
import { getCardPrintings } from '../scryfall'
import { cardCache } from '../cache'
import { getErrorMessage } from '../errors'
import { invalidLimitMessage, parsePositiveInteger } from '../parse-number'
import type { ScryfallCard } from '../types'

/** The card resolved; `printings` holds at least the newest printing. */
export type CardPrintingsSuccess = {
  success: true
  printings: ScryfallCard[]
  /** Printings found before `limit` truncated the list; absent when nothing was dropped. */
  totalPrintings?: number
}

/**
 * The request was refused or the lookup failed. `printings` is still present, as
 * an empty array, so a client that renders the list unconditionally does not
 * have to branch on `success` first.
 */
export type CardPrintingsFailure = {
  success: false
  printings: []
  message: string
}

/** `GET /api/card-printings` body. */
export type CardPrintingsResponse = CardPrintingsSuccess | CardPrintingsFailure

/** Validated `GET /api/card-printings` query. */
export type CardPrintingsParams = { name: string; limit?: number }

/** The one refusal body for this route, at `status`. */
function failure(message: string, status: number): Response {
  const body: CardPrintingsFailure = { success: false, printings: [], message }
  return Response.json(body, { status })
}

/**
 * Parse the query string of `GET /api/card-printings`, or return the message
 * explaining why it is not usable.
 *
 * `limit` is **opt-in**: absent means the full printing list, which is what the
 * public/hosted site mount depends on. There is deliberately no `includePrices`
 * parameter — dropping the price block is a projection, and per the API-first
 * rule each client projects what it needs from one honest response (the MCP
 * `get_card_printings` tool does exactly that).
 */
export function parseCardPrintingsParams(params: URLSearchParams): CardPrintingsParams | string {
  const rawName = params.get('name')?.trim()
  if (!rawName) return 'name is required'
  // Trimmed at the parse boundary, not just for the emptiness check: the name is
  // a cache key, and `?name=%20Sol+Ring` must hit the same entry as `Sol Ring`.
  const parsed: CardPrintingsParams = { name: rawName }

  const rawLimit = params.get('limit')
  if (rawLimit !== null && rawLimit.trim() !== '') {
    const limit = parsePositiveInteger(rawLimit.trim())
    if (limit === undefined) return invalidLimitMessage(rawLimit)
    parsed.limit = limit
  }

  return parsed
}

/**
 * `GET /api/card-printings?name=&limit=` — every cached printing of a card,
 * newest first, falling back to Scryfall when the cache does not hold the name.
 * With `limit` the newest N are returned and `totalPrintings` reports how many
 * there were.
 */
export async function handleCardPrintings(req: Request): Promise<Response> {
  try {
    const parsed = parseCardPrintingsParams(new URL(req.url).searchParams)
    if (typeof parsed === 'string') return failure(parsed, 400)

    // Try cache first
    const cached = await cardCache.get(parsed.name)
    const printings = cached && cached.length > 0 ? cached : await getCardPrintings(parsed.name)

    const body: CardPrintingsSuccess = { success: true, printings }
    if (parsed.limit !== undefined && printings.length > parsed.limit) {
      body.printings = printings.slice(0, parsed.limit)
      body.totalPrintings = printings.length
    }
    return Response.json(body)
  } catch (error) {
    return failure(getErrorMessage(error), 500)
  }
}
