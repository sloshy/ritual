import { fetchSearchPage } from '../scryfall'
import { getErrorMessage } from '../errors'
import { parsePositiveInteger } from '../parse-number'
import { summarizeCard, type CardSummary } from './card-summary'

/** One page of a raw Scryfall search. */
export type CardSearchSuccess = {
  success: true
  /** 1-based page number actually fetched. */
  page: number
  /** Whether Scryfall reports further pages. */
  hasMore: boolean
  /** Total matches across all pages, as Scryfall reports them (absent when it 404s). */
  totalCards?: number
  cards: CardSummary[]
}

/** A rejected query or a failed Scryfall call. The empty arrays keep the wire shape stable. */
export type CardSearchFailure = {
  success: false
  page: number
  hasMore: false
  cards: []
  message: string
}

/** `GET /api/card-search` body. */
export type CardSearchResponse = CardSearchSuccess | CardSearchFailure

/** Validated query params of `GET /api/card-search`. */
export type CardSearchParams = { query: string; page: number }

/**
 * Parse the query string of `GET /api/card-search` into {@link CardSearchParams},
 * or return the error message explaining why it is not usable. Both values are
 * trimmed first, since a query string carries whatever whitespace the caller
 * encoded; `page` is then held to {@link parsePositiveInteger}, the same rule
 * every other positive-integer input in Ritual uses. A blank `page` means the
 * first page, matching how the other routes treat a blank filter as absent. The
 * query is returned trimmed, since that is what is actually sent to Scryfall.
 */
export function parseCardSearchParams(params: URLSearchParams): CardSearchParams | string {
  const rawQuery = params.get('q')
  if (rawQuery === null || rawQuery.trim() === '') return 'q is required.'
  const query = rawQuery.trim()

  const rawPage = params.get('page')
  if (rawPage === null || rawPage.trim() === '') return { query, page: 1 }
  const page = parsePositiveInteger(rawPage.trim())
  if (page === undefined) return `page must be a positive integer, got '${rawPage}'.`
  return { query, page }
}

function errorResponse(message: string, page: number, status: number): Response {
  const body: CardSearchFailure = { success: false, page, hasMore: false, cards: [], message }
  return Response.json(body, { status })
}

/**
 * `GET /api/card-search?q=&page=` — run a raw Scryfall query (the full Scryfall
 * search syntax, exactly as the CLI `scry` command sends it) and return one page
 * of card summaries, most popular first.
 *
 * Exactly one page is fetched per request; walk further pages with `page=2`, and
 * so on, while `hasMore` is true. Unlike `POST /api/search-cards`, this route
 * **does not write to the local card cache** — it is a lookup, not a warm-up.
 * A Scryfall 404 (no matches) is an empty 200, not an error; a query Scryfall
 * refuses is a 400 carrying its explanation.
 */
export async function handleCardSearch(req: Request): Promise<Response> {
  const parsed = parseCardSearchParams(new URL(req.url).searchParams)
  if (typeof parsed === 'string') return errorResponse(parsed, 1, 400)

  try {
    const result = await fetchSearchPage(parsed.query, parsed.page, 'json')
    if (result.kind === 'failed') {
      // Scryfall blames the query for a 4xx (a syntax error, an unknown filter);
      // anything else is its problem, not the caller's.
      const status = result.status >= 400 && result.status < 500 ? 400 : 500
      return errorResponse(result.message, parsed.page, status)
    }
    if (result.data === null) {
      const empty: CardSearchSuccess = {
        success: true,
        page: parsed.page,
        hasMore: false,
        cards: [],
      }
      return Response.json(empty)
    }
    const body: CardSearchSuccess = {
      success: true,
      page: parsed.page,
      hasMore: result.hasMore,
      cards: result.data.data.map(summarizeCard),
    }
    if (result.data.total_cards !== undefined) body.totalCards = result.data.total_cards
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), parsed.page, 500)
  }
}
