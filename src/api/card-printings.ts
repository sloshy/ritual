// An HTTP handler module that is server-agnostic: `src/api/` means "handlers no
// server owns", not "handlers both servers mount". This one is mounted on both
// the admin server and the public/hosted site server.
import { getCardPrintingsResult } from '../scryfall'
import { printingsAreComplete } from '../card-printing'
import { getErrorMessage } from '../errors'
import { invalidLimitMessage, parsePositiveInteger } from '../parse-number'
import { printingKey } from '../printing-key'
import { scryfallCardLanguage, sortLanguages } from '../card-language'
import type { ScryfallCard } from '../types'

/**
 * The card resolved; `printings` holds at least the newest printing.
 *
 * With an `all_cards`-backed cache, `printings` can hold several card objects
 * per physical printing — one per language, sharing a set:collector-number.
 * The pagination vocabulary counts **distinct printings** (set:cn), never
 * per-language objects: `limit` caps how many distinct printings the response
 * covers (keeping *every* language object of each included printing, so a
 * client never sees a printing with its languages half-missing), and
 * `totalPrintings` reports the distinct set:cn count found before truncation.
 */
export type CardPrintingsSuccess = {
  success: true
  printings: ScryfallCard[]
  /**
   * Distinct set:collector-number printings found before `limit` truncated the
   * list; absent when nothing was dropped.
   */
  totalPrintings?: number
  /**
   * Every language the card's full printing list exists in (before any `limit`
   * truncation), folding an absent or unrecognized `lang` to `en`
   * (`scryfallCardLanguage`). Ordered canonically (`en` first) per
   * `sortLanguages`. `["en"]` for any `default_cards`-backed lookup.
   */
  languages: string[]
  /**
   * Whether the list is the card's complete printing set. False when the local
   * card cache holds no bulk-downloaded entry for the name and a single-card
   * Scryfall lookup supplied the one printing shown — a client must not present
   * that as "the only printing of this card".
   */
  complete: boolean
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
 * With `limit` the newest N **distinct printings** (set:collector-number) are
 * returned — every language object of each included printing rides along — and
 * `totalPrintings` reports how many distinct printings there were. Pickers
 * paginate on printings, not on language duplicates.
 */
export async function handleCardPrintings(req: Request): Promise<Response> {
  try {
    const parsed = parseCardPrintingsParams(new URL(req.url).searchParams)
    if (typeof parsed === 'string') return failure(parsed, 400)

    // The cache first; a name it does not hold falls back to a single-card
    // Scryfall lookup, whose one result is reported as incomplete.
    const result = await getCardPrintingsResult(parsed.name)
    const printings = result.printings

    // Rank each distinct set:cn by first appearance in the sorted list, so the
    // limit below counts printings while preserving the response order.
    const printingRank = new Map<string, number>()
    const languages = new Set<string>()
    for (const card of printings) {
      const key = printingKey(card.set, card.collector_number)
      if (!printingRank.has(key)) printingRank.set(key, printingRank.size)
      languages.add(scryfallCardLanguage(card))
    }

    const body: CardPrintingsSuccess = {
      success: true,
      printings,
      languages: sortLanguages(languages),
      complete: printingsAreComplete(result),
    }
    if (parsed.limit !== undefined && printingRank.size > parsed.limit) {
      const limit = parsed.limit
      body.printings = printings.filter(
        (card) => (printingRank.get(printingKey(card.set, card.collector_number)) ?? 0) < limit,
      )
      body.totalPrintings = printingRank.size
    }
    return Response.json(body)
  } catch (error) {
    return failure(getErrorMessage(error), 500)
  }
}
