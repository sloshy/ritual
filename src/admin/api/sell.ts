import { headlessPolicy } from '../../cache/refresh'
import {
  adoptCardKingdomFeed,
  ensureCardKingdomFeed,
  type LoadedCardKingdomFeed,
} from '../../cardkingdom'
import { getErrorMessage } from '../../util/errors'
import { isListType, type ListType } from '../../list/list-type'
import type { ListLocation } from '../../list/resolve-list'
import type { BuylistFeedStamp, SellCartCsv } from '../../buylist'
import {
  applySellFilters,
  buildSellCartCsv,
  parseMinPrice,
  type SellEntryFilters,
  type SellReportPayload,
  type SellReportView,
} from '../../pricing/sell-report'
import { loadAndBuildSellReport } from '../../pricing/sell-runtime'
import { parseSetCodesInput } from '../../card/set-codes'
import { listLocationForSlug } from './list-info'
import { apiError, badRequest, requireBuylistFeed, requireCardCache } from './save-helpers'

/** GET /api/sell/report body — the CLI's `sell --output json` payload. */
export type SellReportResponse = SellReportPayload & {
  success: true
}

/** GET /api/sell/cart body — the CK sell-cart CSV over the same scope/filters. */
export type SellCartResponse = SellCartCsv & {
  success: true
}

/** POST /api/sell/refresh body — the state of the feed after the refresh. */
export type SellRefreshResponse = Omit<BuylistFeedStamp, 'stale'> & {
  success: true
  /** Whether this call downloaded a new feed. */
  refreshed: boolean
  /**
   * Failures that degraded the result instead of failing it — a wanted
   * download that fell back to the stale cached feed. Empty on a clean run,
   * so `refreshed: false` with empty warnings really means "still fresh".
   */
  warnings: string[]
}

/** Parse `?lists=type:slug,...` into locations; 400/404 on bad or empty refs. */
async function parseListsParam(url: URL): Promise<ListLocation[] | undefined | Response> {
  const raw = url.searchParams.get('lists')
  if (raw === null) return undefined
  const locations: ListLocation[] = []
  for (const ref of raw.split(',')) {
    const trimmed = ref.trim()
    if (trimmed === '') continue
    const separator = trimmed.indexOf(':')
    const type = separator > 0 ? trimmed.slice(0, separator) : ''
    const slug = separator > 0 ? trimmed.slice(separator + 1) : ''
    if (!isListType(type) || slug === '') {
      return badRequest(`Invalid list reference '${trimmed}' (expected type:slug)`)
    }
    const location = await listLocationForSlug(type, slug)
    if (!location) return apiError(`List '${trimmed}' not found`, 404)
    locations.push(location)
  }
  // `?lists=` was given but named nothing: refusing beats silently widening
  // the scope to every collection.
  if (locations.length === 0) return badRequest(`No list references in 'lists'`)
  return locations
}

/** The scope/filter query contract shared by the report and cart endpoints. */
type SellQuery = {
  type: ListType | undefined
  locations: ListLocation[] | undefined
  filters: SellEntryFilters
}

/** Parse the shared `?type=`/`?lists=`/`?sets=`/`?min=` params; a Response on refusal. */
async function parseSellQuery(url: URL): Promise<SellQuery | Response> {
  const rawType = url.searchParams.get('type')
  let type: ListType | undefined
  if (rawType) {
    if (!isListType(rawType)) return badRequest(`Invalid list type '${rawType}'`)
    type = rawType
  }
  const locations = await parseListsParam(url)
  if (locations instanceof Response) return locations
  const rawMin = url.searchParams.get('min')
  let minPrice: number | undefined
  if (rawMin !== null && rawMin !== '') {
    const parsed = parseMinPrice(rawMin)
    if (typeof parsed === 'string') return badRequest(parsed)
    minPrice = parsed
  }
  const rawSets = url.searchParams.get('sets')
  return {
    type,
    locations,
    filters: { sets: rawSets ? parseSetCodesInput(rawSets) : undefined, minPrice },
  }
}

/** A built and filtered sell view plus the feed it was matched against. */
type BuiltSellView = {
  view: SellReportView
  feed: LoadedCardKingdomFeed
  warnings: string[]
}

/** Build the filtered sell view for a parsed query; a Response on a 503. */
async function buildSellView(query: SellQuery): Promise<BuiltSellView | Response> {
  const unavailable = await requireCardCache('buylist matching requires it')
  if (unavailable) return unavailable
  const feed = await requireBuylistFeed()
  if (feed instanceof Response) return feed

  const { report, warnings } = await loadAndBuildSellReport(
    query.locations ? undefined : (query.type ?? 'collection'),
    query.locations,
    feed,
    // Cache-only lookup: a server handler must not fire per-card Scryfall
    // fetches for names the cache does not hold.
    { refresh: 'never' },
  )
  return { view: applySellFilters(report, query.filters), feed, warnings }
}

/**
 * GET /api/sell/report — every listed card matched against the cached Card
 * Kingdom buylist. Scope with `?type=` (default: collections) or
 * `?lists=type:slug,...`; filter with `?sets=` (comma-separated codes) and
 * `?min=` (minimum per-copy offer). Strictly cache-backed: the card cache and
 * a downloaded feed are prerequisites (503 otherwise), and no download is ever
 * triggered here — that is POST /api/sell/refresh's job.
 */
export async function handleSellReport(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const query = await parseSellQuery(url)
    if (query instanceof Response) return query
    const built = await buildSellView(query)
    if (built instanceof Response) return built

    const body: SellReportResponse = {
      success: true,
      feedCreatedAt: built.feed.file.feed.createdAt,
      feedRetrievedAt: built.feed.file.retrievedAt,
      filters: query.filters,
      lists: built.view.lists,
      entries: built.view.entries,
      totals: built.view.totals,
      warnings: built.warnings,
    }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}

/**
 * GET /api/sell/cart — the entries CK is buying, rendered as their header-less sell-cart
 * CSV import format (CK's own listing titles — variant note included — and
 * edition spellings, quantities capped at their buy limits), over the same `?type=`/`?lists=`/`?sets=`/`?min=` scope
 * as the report. The capability behind the CLI's `sell --output csv`; carries
 * the title/card counts against CK's upload caps alongside the CSV itself.
 */
export async function handleSellCart(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const query = await parseSellQuery(url)
    if (query instanceof Response) return query
    const built = await buildSellView(query)
    if (built instanceof Response) return built

    const body: SellCartResponse = { success: true, ...buildSellCartCsv(built.view.entries) }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}

/**
 * POST /api/sell/refresh — download the Card Kingdom pricelist feed when it is
 * stale or missing; `?force=true` redownloads regardless. The one route that
 * reaches the network for the buylist, so report views stay fast and
 * side-effect free. A failed download returns 502 when no feed is cached at
 * all; with a stale cache it answers 200 with the stale feed's stamps,
 * `refreshed: false`, and the failure in `warnings`.
 */
export async function handleSellRefresh(req: Request): Promise<Response> {
  try {
    const force = new URL(req.url).searchParams.get('force') === 'true'
    const result = await ensureCardKingdomFeed(headlessPolicy('auto'), { force })
    if (typeof result === 'string') {
      return apiError(result, 502)
    }
    // Index the feed we just wrote rather than leaving the memo to re-read it.
    if (result.refreshed) await adoptCardKingdomFeed(result)
    const body: SellRefreshResponse = {
      success: true,
      refreshed: result.refreshed,
      feedRetrievedAt: result.retrievedAt,
      feedCreatedAt: result.feed.createdAt,
      productCount: result.feed.products.length,
      warnings: result.staleFallback === undefined ? [] : [result.staleFallback],
    }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}
