import { cardCache } from '../../cache'
import {
  cardKingdomReportPricing,
  getCardKingdomFeed,
  missingFeedApiAdvice,
} from '../../cardkingdom'
import { getErrorMessage } from '../../util/errors'
import { isListType, type ListType } from '../../list/list-type'
import { parseEnumField } from '../../util/parse-enum'
import type {
  PriceListDetailPayload,
  PriceSummaryPayload,
  ReportPricing,
} from '../../pricing/price-report'
import { VALID_PRICE_SOURCES, type PriceSource } from '../../pricing/price-source'
import { loadAndBuildPriceReport } from '../../pricing/price-runtime'
import { getDefaultPriceSource } from '../../config/ritual-config'
import { listLocationForSlug } from './list-info'
import { parseListTarget } from './target'
import { apiError, badRequest } from '../../api/http'
import { requireCardCache } from './save-helpers'

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

/**
 * Resolve `?source=` to the store the report is priced at: the named store,
 * else the configured `defaultPriceSource` (a store names its own currency, so
 * there is no currency to choose). An unknown store is a 400. `cardkingdom`
 * prices from the cached buyer feed — strictly cache-backed, like every other
 * server read; a missing feed is refused with the refresh advice rather than
 * silently answered with Scryfall prices.
 */
async function parsePricingParam(url: URL): Promise<ReportPricing | Response> {
  const raw = url.searchParams.get('source')
  let source: PriceSource = getDefaultPriceSource()
  if (raw) {
    const parsed = parseEnumField(raw, VALID_PRICE_SOURCES, 'source')
    if (!parsed.ok) return badRequest(parsed.message)
    source = parsed.value
  }
  if (source !== 'cardkingdom') return { source }
  const feed = await getCardKingdomFeed()
  if (!feed) return apiError(missingFeedApiAdvice(), 503)
  return cardKingdomReportPricing(feed)
}

/**
 * GET /api/price/summary — per-list price totals across every list, optionally
 * restricted with `?type=` and priced at `?source=` (default: the configured
 * defaultPriceSource). Mirrors the CLI's `price --summary --output json` payload.
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
    const pricing = await parsePricingParam(url)
    if (pricing instanceof Response) return pricing

    const unavailable = await requireCardCache('prices are unavailable')
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    // `refresh: 'never'` makes the lookup cache-only, honoring this module's
    // "prices come strictly from the local cache" contract: a server handler
    // must not fire (and wait on) a per-card Scryfall fetch for every name the
    // cache happens not to hold.
    const { built, warnings } = await loadAndBuildPriceReport(type, undefined, pricing, {
      refresh: 'never',
    })
    const body: PriceSummaryResponse = {
      success: true,
      mode: 'summary',
      source: built.report.source,
      currency: built.report.currency,
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
 * entries (in file order), priced at `?source=`. Mirrors the CLI's
 * single-list `price <name> --output json` payload.
 */
export async function handlePriceList(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (typeof target === 'string') return apiError(target, 400)
    const pricing = await parsePricingParam(new URL(req.url))
    if (pricing instanceof Response) return pricing

    const location = await listLocationForSlug(target.type, target.slug)
    if (!location) return apiError(`List '${target.slug}' not found`, 404)

    const unavailable = await requireCardCache('prices are unavailable')
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    const { built, warnings } = await loadAndBuildPriceReport(target.type, [location], pricing, {
      refresh: 'never',
    })
    const body: PriceListDetailResponse = {
      success: true,
      mode: 'list',
      source: built.report.source,
      currency: built.report.currency,
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
