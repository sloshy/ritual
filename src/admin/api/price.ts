import {
  cardKingdomReportPricing,
  getCardKingdomFeed,
  missingFeedApiAdvice,
} from '../../cardkingdom'
import { type PriceListDetailPayload, type ReportPricing } from '../../pricing/price-report'
import { VALID_PRICE_SOURCES, type PriceSource } from '../../pricing/price-source'
import { loadAndBuildPriceReport, pricesRefreshedAt } from '../../pricing/price-runtime'
import { getDefaultPriceSource } from '../../config/ritual-config'
import { listLocationForSlug } from './list-info'
import { listIdentityOf } from '../../list/list-info'
import { findByListIdentity } from '../../list/list-identity'
import { parseListTarget } from './target'
import { apiError, badRequest, errorResponse, nestedRefusal } from '../../api/http'
import { apiMessage, enumQueryParam, isApiMessage, type ApiMessage } from '../../api/result'
import { isSyncMessage, type SyncMessage } from '../../sync/message'
import { requireCardCache } from './save-helpers'

/** GET /api/price/:type/:slug body — the CLI single-list payload plus the prices' age. */
export type PriceListDetailResponse = PriceListDetailPayload & {
  success: true
  /**
   * When the prices were last refreshed (epoch ms, `null` when unknown): the
   * Card Kingdom feed's download for `cardkingdom`, the card cache's last bulk
   * refresh for every other store (`pricesRefreshedAt`).
   */
  lastRefreshedAt: number | null
}

/**
 * `?source=` as a store: `undefined` when absent or blank, the store, or the
 * refusal naming the stores there are. The one reading every priced route
 * shares.
 */
export function sourceParam(params: URLSearchParams): PriceSource | undefined | ApiMessage {
  return enumQueryParam(params, 'source', VALID_PRICE_SOURCES)
}

/**
 * The pricing a server route prices `source` with. `cardkingdom` prices from
 * the cached buyer feed — strictly cache-backed, like every other server read:
 * no feed is the refresh advice (a message the caller decides how to report),
 * never a silent fallback to Scryfall prices or a download.
 */
export async function serverReportPricing(
  source: PriceSource,
): Promise<ReportPricing | SyncMessage> {
  if (source !== 'cardkingdom') return { source }
  const feed = await getCardKingdomFeed()
  if (!feed) return missingFeedApiAdvice()
  return cardKingdomReportPricing(feed)
}

/**
 * Resolve `?source=` to the store the report is priced at: the named store,
 * else the configured `defaultPriceSource` (a store names its own currency, so
 * there is no currency to choose). An unknown store is a 400; Card Kingdom with
 * no cached feed is refused (503) with the refresh advice.
 */
async function parsePricingParam(url: URL): Promise<ReportPricing | Response> {
  const source = sourceParam(url.searchParams)
  if (isApiMessage(source)) return badRequest(source)
  const pricing = await serverReportPricing(source ?? getDefaultPriceSource())
  return isSyncMessage(pricing) ? nestedRefusal(pricing, 503) : pricing
}

/**
 * GET /api/price/:type/:slug — one list's price summary plus its priced card
 * entries (in file order), priced at `?source=`. Mirrors the CLI's
 * single-list `price <name> --output json` payload.
 */
export async function handlePriceList(req: Request): Promise<Response> {
  try {
    const target = parseListTarget(req)
    if (isApiMessage(target)) return apiError(target, 400)
    const pricing = await parsePricingParam(new URL(req.url))
    if (pricing instanceof Response) return pricing

    const location = await listLocationForSlug(target.listType, target.slug)
    if (!location) {
      return apiError(
        apiMessage('admin.api.list.notFound', { listType: target.listType, slug: target.slug }),
        404,
      )
    }

    const unavailable = await requireCardCache('prices')
    if (unavailable) return unavailable

    const lastRefreshedAt = await pricesRefreshedAt(pricing)
    const { built, warnings } = await loadAndBuildPriceReport(
      target.listType,
      [location],
      pricing,
      {
        refresh: 'never',
      },
    )
    // By type + slug, the list's identity — never by position or display name.
    const list = findByListIdentity(built.report.lists, listIdentityOf(location))
    // Only a file gone between the lookup and the read leaves no row.
    if (!list) {
      return apiError(
        apiMessage('admin.api.list.notFound', { listType: target.listType, slug: target.slug }),
        404,
      )
    }
    const body: PriceListDetailResponse = {
      success: true,
      source: built.report.source,
      currency: built.report.currency,
      lastRefreshedAt,
      list,
      cards: built.report.entries,
      warnings,
    }
    return Response.json(body)
  } catch (err) {
    return errorResponse(err)
  }
}
