import { cardCache } from '../../cache'
import { getErrorMessage } from '../../errors'
import { isListType, type ListType } from '../../list-type'
import { isPriceCurrency, VALID_CURRENCIES, type PriceCurrency } from '../../price-currency'
import type { PriceListDetailPayload, PriceSummaryPayload } from '../../price-report'
import { loadAndBuildPriceReport } from '../../price-runtime'
import type { ListLocation } from '../../resolve-list'
import { getDefaultCurrency } from '../../ritual-config'
import { listSlug, resolveListFile } from './list-info'
import { parseListTarget } from './target'

/** GET /api/price/summary body — the CLI summary payload plus parser warnings. */
export type PriceSummaryResponse = PriceSummaryPayload & { success: true; warnings: string[] }

/** GET /api/price/:type/:slug body — the CLI single-list payload plus cache age and warnings. */
export type PriceListDetailResponse = PriceListDetailPayload & {
  success: true
  lastRefreshedAt: number | null
  warnings: string[]
}

export type PriceErrorResponse = { success: false; message: string }

function error(message: string, status: number): Response {
  const body: PriceErrorResponse = { success: false, message }
  return Response.json(body, { status })
}

/**
 * 503 when the card cache is empty, null when prices are servable. Prices come
 * strictly from the local cache — a handler must never prompt for or trigger a
 * bulk download the way the CLI's `ensureFreshPriceData` flow does.
 */
async function requireCardCache(): Promise<Response | null> {
  if (await cardCache.isEmpty()) {
    return error(
      'The card cache is empty; prices are unavailable. Run `ritual cache preload-all` first.',
      503,
    )
  }
  return null
}

/** Resolve `?currency=` (absent → the configured default); 400 on an unknown value. */
function parseCurrencyParam(url: URL): PriceCurrency | Response {
  const raw = url.searchParams.get('currency')
  if (!raw) return getDefaultCurrency()
  const lower = raw.toLowerCase()
  if (!isPriceCurrency(lower)) {
    return error(`Invalid currency '${raw}'. Must be one of: ${VALID_CURRENCIES.join(', ')}`, 400)
  }
  return lower
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
      if (!isListType(rawType)) return error(`Invalid list type '${rawType}'`, 400)
      type = rawType
    }
    const currency = parseCurrencyParam(url)
    if (currency instanceof Response) return currency

    const unavailable = await requireCardCache()
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    const { built, warnings } = await loadAndBuildPriceReport(type, undefined, currency)
    const body: PriceSummaryResponse = {
      success: true,
      currency,
      lastRefreshedAt,
      lists: built.report.lists,
      typeTotals: built.report.typeTotals,
      totals: built.report.totals,
      warnings,
    }
    return Response.json(body)
  } catch (err) {
    return error(getErrorMessage(err), 500)
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
    if (target instanceof Response) return target
    const currency = parseCurrencyParam(new URL(req.url))
    if (currency instanceof Response) return currency

    const filePath = await resolveListFile(target.type, target.slug)
    if (!filePath) return error(`List '${target.slug}' not found`, 404)

    const unavailable = await requireCardCache()
    if (unavailable) return unavailable

    const lastRefreshedAt = await cardCache.getLastRefreshedAt()
    const location: ListLocation = { type: target.type, name: listSlug(filePath), filePath }
    const { built, warnings } = await loadAndBuildPriceReport(target.type, [location], currency)
    const body: PriceListDetailResponse = {
      success: true,
      currency,
      lastRefreshedAt,
      list: built.report.lists[0],
      cards: built.report.entries,
      warnings,
    }
    return Response.json(body)
  } catch (err) {
    return error(getErrorMessage(err), 500)
  }
}
