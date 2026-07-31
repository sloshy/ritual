import { cardCache } from '../../cache'
import { CACHE_REFRESH_REMEDY } from '../../cache/status'
import { getErrorMessage } from '../../errors'
import { isListType, type ListType } from '../../list-type'
import { parseEnumField } from '../../parse-enum'
import { VALID_CURRENCIES, type PriceCurrency } from '../../price-currency'
import type { PriceListDetailPayload, PriceSummaryPayload } from '../../price-report'
import { loadAndBuildPriceReport } from '../../price-runtime'
import type { ListLocation } from '../../resolve-list'
import { getDefaultCurrency } from '../../ritual-config'
import { resolveListFile } from './list-info'
import { listSlug } from '../../list-info'
import { parseListTarget } from './target'
import { apiError, badRequest } from './save-helpers'

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
 * 503 when the card cache is empty, null when prices are servable. Prices come
 * strictly from the local cache — a handler must never prompt for or trigger a
 * bulk download the way the CLI's `ensureFreshPriceData` flow does.
 */
async function requireCardCache(): Promise<Response | null> {
  if (await cardCache.isEmpty()) {
    return apiError(
      `The card cache is empty; prices are unavailable. ${CACHE_REFRESH_REMEDY}.`,
      503,
    )
  }
  return null
}

/** Resolve `?currency=` (absent → the configured default); 400 on an unknown value. */
function parseCurrencyParam(url: URL): PriceCurrency | Response {
  const raw = url.searchParams.get('currency')
  if (!raw) return getDefaultCurrency()
  const parsed = parseEnumField(raw, VALID_CURRENCIES, 'currency')
  if (!parsed.ok) return badRequest(parsed.message)
  return parsed.value
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
    const currency = parseCurrencyParam(url)
    if (currency instanceof Response) return currency

    const unavailable = await requireCardCache()
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    // `refresh: 'never'` makes the lookup cache-only, honoring this module's
    // "prices come strictly from the local cache" contract: a server handler
    // must not fire (and wait on) a per-card Scryfall fetch for every name the
    // cache happens not to hold.
    const { built, warnings } = await loadAndBuildPriceReport(type, undefined, currency, {
      refresh: 'never',
    })
    const body: PriceSummaryResponse = {
      success: true,
      mode: 'summary',
      currency,
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
    const currency = parseCurrencyParam(new URL(req.url))
    if (currency instanceof Response) return currency

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return apiError(`List '${target.slug}' not found`, 404)

    const unavailable = await requireCardCache()
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    const location: ListLocation = { type: target.type, name: listSlug(filePath), filePath }
    const { built, warnings } = await loadAndBuildPriceReport(target.type, [location], currency, {
      refresh: 'never',
    })
    const body: PriceListDetailResponse = {
      success: true,
      mode: 'list',
      currency,
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
