// An HTTP handler module that is server-agnostic: `src/api/` means "handlers no
// server owns", not "handlers both servers mount". This one is currently mounted
// on the admin server only.
import { cacheRealPrintings, fetchSearchPage } from '../scryfall'
import { getErrorMessage } from '../errors'
import { parseEnumField } from '../parse-enum'
import { invalidLimitMessage, parsePositiveInteger } from '../parse-number'
import { promoteFullNameMatches } from '../term-match'
import { summarizeCard, type CardSummary } from './card-summary'

/** The largest page Scryfall serves, and therefore the largest `limit` worth asking for. */
export const SCRYFALL_PAGE_SIZE = 175

/** How many results a warming search returns when the caller does not say. */
export const DEFAULT_WARM_LIMIT = 20

/** One page of a raw Scryfall search. */
export type CardSearchSuccess = {
  success: true
  /** 1-based page number actually fetched. */
  page: number
  /** Whether Scryfall reports further pages. */
  hasMore: boolean
  /** Total matches across all pages, as Scryfall reports them (absent when it 404s). */
  totalCards?: number
  /** Whether the results were also written into the local card cache. */
  warmed: boolean
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
export type CardSearchParams = {
  query: string
  page: number
  /** Write results under names the local cache lacks, and promote full-name matches. */
  warm: boolean
  /** Max cards returned; absent means the whole page. */
  limit?: number
}

/**
 * Parse the query string of `GET /api/card-search` into {@link CardSearchParams},
 * or return the error message explaining why it is not usable. Values are
 * trimmed first, since a query string carries whatever whitespace the caller
 * encoded; `page` and `limit` are then held to {@link parsePositiveInteger}, the
 * same rule every other positive-integer input in Ritual uses. A blank value
 * means absent, matching how the other routes treat a blank filter. The query is
 * returned trimmed, since that is what is actually sent to Scryfall.
 *
 * `warm` is **validated, never coerced** (the sync-request convention): it
 * decides whether the request writes to the local card cache, so an
 * unrecognized value is refused rather than quietly read as "no". When `warm` is
 * on and no `limit` was given, `limit` defaults to {@link DEFAULT_WARM_LIMIT} —
 * the cap the folded-in `POST /api/search-cards` always applied.
 */
export function parseCardSearchParams(params: URLSearchParams): CardSearchParams | string {
  const rawQuery = params.get('q')
  if (rawQuery === null || rawQuery.trim() === '') return 'q is required.'
  const query = rawQuery.trim()

  let page = 1
  const rawPage = params.get('page')
  if (rawPage !== null && rawPage.trim() !== '') {
    const parsed = parsePositiveInteger(rawPage.trim())
    if (parsed === undefined) return `page must be a positive integer, got '${rawPage}'.`
    page = parsed
  }

  let warm = false
  const rawWarm = params.get('warm')
  if (rawWarm !== null && rawWarm.trim() !== '') {
    const parsed = parseEnumField(rawWarm.trim(), ['true', 'false'] as const, 'warm')
    if (!parsed.ok) return parsed.message
    warm = parsed.value === 'true'
  }

  const parsed: CardSearchParams = { query, page, warm }

  const rawLimit = params.get('limit')
  if (rawLimit !== null && rawLimit.trim() !== '') {
    const limit = parsePositiveInteger(rawLimit.trim())
    if (limit === undefined) return invalidLimitMessage(rawLimit)
    if (limit > SCRYFALL_PAGE_SIZE) {
      return `limit must be at most ${SCRYFALL_PAGE_SIZE} (one Scryfall page), got '${rawLimit}'.`
    }
    parsed.limit = limit
  } else if (warm) {
    parsed.limit = DEFAULT_WARM_LIMIT
  }

  return parsed
}

function errorResponse(message: string, page: number, status: number): Response {
  const body: CardSearchFailure = { success: false, page, hasMore: false, cards: [], message }
  return Response.json(body, { status })
}

/**
 * `GET /api/card-search?q=&page=&limit=&warm=` — run a raw Scryfall query (the
 * full Scryfall search syntax, exactly as the CLI `scry` command sends it) and
 * return one page of card summaries, most popular first.
 *
 * Exactly one page is fetched per request; walk further pages with `page=2`, and
 * so on, while `hasMore` is true.
 *
 * `warm=true` folds in what `POST /api/search-cards` used to do, and does it on
 * the same footing as the plain read: printings are filtered to real ones and
 * mapped to the cache's card shape, names the cache does not already hold are
 * written into it (an already-cached name is left alone — this is a warm-up, not
 * a refresh), whole-name matches are promoted ahead of Scryfall's EDHREC order,
 * and the result is capped at {@link DEFAULT_WARM_LIMIT} unless `limit` says
 * otherwise.
 *
 * The error contract is the strict one on **both** modes: a Scryfall 404 (no
 * matches) is an empty 200, a query Scryfall refuses is a 400 carrying its
 * explanation, and a Scryfall server error is a 500 — never an empty result set,
 * which is what the old warming route reported for all three.
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
        warmed: parsed.warm,
        cards: [],
      }
      return Response.json(empty)
    }

    let cards = result.data.data
    if (parsed.warm) {
      cards = await cacheRealPrintings(cards)
      // Scryfall returns these in EDHREC order, which buries an unpopular card
      // even when the query is its exact name — promote whole-name matches
      // before the cut.
      cards = promoteFullNameMatches(cards, parsed.query, (card) => card.name)
    }
    if (parsed.limit !== undefined) cards = cards.slice(0, parsed.limit)

    const body: CardSearchSuccess = {
      success: true,
      page: parsed.page,
      hasMore: result.hasMore,
      warmed: parsed.warm,
      cards: cards.map(summarizeCard),
    }
    if (result.data.total_cards !== undefined) body.totalCards = result.data.total_cards
    return Response.json(body)
  } catch (error) {
    return errorResponse(getErrorMessage(error), parsed.page, 500)
  }
}
