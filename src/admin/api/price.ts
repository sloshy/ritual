import { cardCache } from '../../cache'
import { detailBuylistContext, getCardKingdomFeed, missingFeedApiAdvice } from '../../cardkingdom'
import { getErrorMessage } from '../../errors'
import { isListType, type ListType } from '../../list-type'
import { parseEnumField } from '../../parse-enum'
import { VALID_CURRENCIES, type PriceCurrency } from '../../price-currency'
import type {
  CardKingdomPricing,
  PriceListDetailPayload,
  PriceSummaryPayload,
  ReportPriceSource,
} from '../../price-report'
import { VALID_PRICE_SOURCES, resolveSourceCurrency } from '../../price-source'
import { loadAndBuildPriceReport } from '../../price-runtime'
import { getDefaultCurrency } from '../../ritual-config'
import { listLocationForSlug } from './list-info'
import { parseListTarget } from './target'
import { apiError, badRequest, requireCardCache } from './save-helpers'

/**
 * GET /api/price/summary body — the CLI summary payload plus parser warnings.
 *
 * `mode` discriminates the two price bodies (matching `ExportResponseBody`'s
 * precedent), so a client that can receive either — the MCP `get_price_report`
 * tool does — reads one field to know which it got.
 */
export type PriceSummaryResponse = PriceSummaryPayload & {
  success: true
  mode: 'summary'
  warnings: string[]
}

/** GET /api/price/:type/:slug body — the CLI single-list payload plus cache age and warnings. */
export type PriceListDetailResponse = PriceListDetailPayload & {
  success: true
  mode: 'list'
  lastRefreshedAt: number | null
  warnings: string[]
}

/** Resolve `?currency=` (absent → the configured default); 400 on an unknown value. */
function parseCurrencyParam(url: URL): PriceCurrency | Response {
  const raw = url.searchParams.get('currency')
  if (!raw) return getDefaultCurrency()
  const parsed = parseEnumField(raw, VALID_CURRENCIES, 'currency')
  if (!parsed.ok) return badRequest(parsed.message)
  return parsed.value
}

/** The resolved price view of one request: currency plus the optional CK retail lookup. */
type PriceView = {
  currency: PriceCurrency
  /** Set when `?source=cardkingdom`: echoed in the payload and passed to the engine. */
  source?: ReportPriceSource
  cardKingdom?: CardKingdomPricing
}

/**
 * Resolve `?currency=` and `?source=` together, mirroring the CLI's rules: a
 * source names its own currency (tcgplayer/cardkingdom → usd, cardmarket →
 * eur), an explicit conflicting currency is a 400, and `cardkingdom` prices
 * from the cached buyer feed — strictly cache-backed, like every other server
 * read; a missing feed is refused with the refresh advice rather than
 * silently answered with Scryfall prices.
 */
async function parsePriceViewParams(url: URL): Promise<PriceView | Response> {
  const currency = parseCurrencyParam(url)
  if (currency instanceof Response) return currency
  const rawSource = url.searchParams.get('source')
  if (!rawSource) return { currency }
  const parsed = parseEnumField(rawSource, VALID_PRICE_SOURCES, 'source')
  if (!parsed.ok) return badRequest(parsed.message)
  const resolved = resolveSourceCurrency(
    parsed.value,
    url.searchParams.get('currency') ? currency : undefined,
  )
  if (!resolved.ok) {
    return badRequest(`source '${resolved.source}' prices in ${resolved.implied}, not ${currency}`)
  }
  if (parsed.value !== 'cardkingdom') return { currency: resolved.currency }
  const feed = await getCardKingdomFeed()
  if (!feed) return apiError(missingFeedApiAdvice(), 503)
  return {
    currency: resolved.currency,
    source: 'cardkingdom',
    cardKingdom: { quote: detailBuylistContext(feed).quote },
  }
}

/**
 * GET /api/price/summary — per-list price totals across every list, optionally
 * restricted with `?type=` and priced in `?currency=` (default: the configured
 * defaultCurrency). Mirrors the CLI's `price --summary --output json` payload.
 */
export async function handlePriceSummary(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const rawType = url.searchParams.get('type')
    let type: ListType | undefined
    if (rawType) {
      if (!isListType(rawType)) return apiError(`Invalid list type '${rawType}'`, 400)
      type = rawType
    }
    const view = await parsePriceViewParams(url)
    if (view instanceof Response) return view

    const unavailable = await requireCardCache('prices are unavailable')
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    // `refresh: 'never'` makes the lookup cache-only, honoring this module's
    // "prices come strictly from the local cache" contract: a server handler
    // must not fire (and wait on) a per-card Scryfall fetch for every name the
    // cache happens not to hold.
    const { built, warnings } = await loadAndBuildPriceReport(type, undefined, view.currency, {
      refresh: 'never',
      ...(view.cardKingdom ? { cardKingdom: view.cardKingdom } : {}),
    })
    const body: PriceSummaryResponse = {
      success: true,
      mode: 'summary',
      currency: view.currency,
      ...(view.source ? { source: view.source } : {}),
      lastRefreshedAt,
      lists: built.report.lists,
      typeTotals: built.report.typeTotals,
      totals: built.report.totals,
      warnings,
    }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}

/**
 * GET /api/price/:type/:slug — one list's price summary plus its priced card
 * entries (in file order), priced in `?currency=`. Mirrors the CLI's
 * single-list `price <name> --output json` payload.
 */
export async function handlePriceList(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)
    const view = await parsePriceViewParams(new URL(req.url))
    if (view instanceof Response) return view

    const location = await listLocationForSlug(target.type, target.slug)
    if (!location) return apiError(`List '${target.slug}' not found`, 404)

    const unavailable = await requireCardCache('prices are unavailable')
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    const { built, warnings } = await loadAndBuildPriceReport(
      target.type,
      [location],
      view.currency,
      {
        refresh: 'never',
        ...(view.cardKingdom ? { cardKingdom: view.cardKingdom } : {}),
      },
    )
    const body: PriceListDetailResponse = {
      success: true,
      mode: 'list',
      currency: view.currency,
      ...(view.source ? { source: view.source } : {}),
      lastRefreshedAt,
      list: built.report.lists[0],
      cards: built.report.entries,
      warnings,
    }
    return Response.json(body)
  } catch (err) {
    return apiError(getErrorMessage(err), 500)
  }
}
