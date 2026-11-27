import { pricesRefreshedAt } from '../../pricing/price-runtime'
import { CARD_LABELS } from '../../card/card-labels'
import { DECK_FORMAT_KEYS } from '../../list/deck-format'
import { loadListInfos } from '../../list/list-info'
import type { ListInfo } from '../../list/list-identity'
import { LIST_TYPES } from '../../list/list-type'
import type { PriceSource } from '../../pricing/price-source'
import {
  isListsSummaryRefusal,
  LISTS_SUMMARY_SORTS,
  summarizeLists,
  summaryPricing,
  type ListsSummaryOptions,
  type ListsSummaryPayload,
} from '../../summary/lists'
import { isSyncMessage } from '../../sync/message'
import { badRequest, errorResponse, nestedRefusal } from '../../api/http'
import {
  booleanQueryParam,
  enumQueryParam,
  isApiMessage,
  positiveIntegerParam,
  type ApiMessage,
} from '../../api/result'
import { apiHandler } from '../utils'
import { parseListRefParams } from './list-refs'
import { serverReportPricing, sourceParam } from './price'

export type ListsResponse = { success: true; lists: ListInfo[] }

/** GET /api/lists — every list across all three types as lightweight summaries. */
export function handleLists(): Promise<Response> {
  return apiHandler(async () => {
    const body: ListsResponse = { success: true, lists: await loadListInfos() }
    return Response.json(body)
  })
}

/** GET /api/lists/summary body — the cross-list summary, plus the cache age when priced. */
export type ListsSummaryResponse = ListsSummaryPayload & { success: true }

/**
 * The summary's query string, parsed: the engine's options, with the store to
 * price at in place of the resolved pricing. Its keys are the route's (and so
 * `summarize_lists`') whole parameter set.
 */
export type ListsSummaryQuery = Omit<ListsSummaryOptions, 'priced'> & { source?: PriceSource }

/** Every parameter the summary takes, by name. */
export type ListsSummaryQueryKey = keyof ListsSummaryQuery

/**
 * Parse the summary's query string: `listType`, `nameContains`, `list`
 * (repeated, each `type:slug`), `label`, `includeEmpty`, `format`, `section`
 * (repeated), `source`, `sort`, `descending` and `limit`. A blank parameter is
 * absent, but a repeated one given only blank values is an empty selection,
 * which the engine refuses rather than widening to every list (or section).
 * The shapes are checked here; what the engine itself refuses (no section
 * named, `sort=value` without a store) is left to `parseListsSummaryOptions`,
 * so the rule lives once.
 */
export function parseListsSummaryParams(params: URLSearchParams): ListsSummaryQuery | ApiMessage {
  const query: ListsSummaryQuery = {}

  const listType = enumQueryParam(params, 'listType', LIST_TYPES)
  if (isApiMessage(listType)) return listType
  if (listType !== undefined) query.listType = listType

  const nameContains = params.get('nameContains')?.trim()
  if (nameContains) query.nameContains = nameContains

  const rawRefs = params.getAll('list')
  if (rawRefs.length > 0) {
    const lists = parseListRefParams(rawRefs)
    if (isApiMessage(lists)) return lists
    query.lists = lists
  }

  const label = enumQueryParam(params, 'label', CARD_LABELS)
  if (isApiMessage(label)) return label
  if (label !== undefined) query.label = label

  const includeEmpty = booleanQueryParam(params, 'includeEmpty')
  if (isApiMessage(includeEmpty)) return includeEmpty
  if (includeEmpty !== undefined) query.includeEmpty = includeEmpty

  const format = enumQueryParam(params, 'format', DECK_FORMAT_KEYS)
  if (isApiMessage(format)) return format
  if (format !== undefined) query.format = format

  const sections = params.getAll('section')
  if (sections.length > 0) query.sections = sections

  const source = sourceParam(params)
  if (isApiMessage(source)) return source
  if (source !== undefined) query.source = source

  const sort = enumQueryParam(params, 'sort', LISTS_SUMMARY_SORTS)
  if (isApiMessage(sort)) return sort
  if (sort !== undefined) query.sort = sort

  const descending = booleanQueryParam(params, 'descending')
  if (isApiMessage(descending)) return descending
  if (descending !== undefined) query.descending = descending

  const limit = positiveIntegerParam(params, 'limit')
  if (isApiMessage(limit)) return limit
  if (limit !== undefined) query.limit = limit

  return query
}

/**
 * GET /api/lists/summary — counts (and, with `?source=`, value at that store)
 * across many lists in one call, filtered and ordered by the query (see
 * {@link parseListsSummaryParams}). Counting reads only the list files; pricing
 * is strictly cache-backed (`refresh: 'never'`). Prices that cannot be had are
 * a warning beside the counts, never a refusal — an empty card cache, a list
 * that fails to price, or Card Kingdom with no cached feed — except that
 * `sort=value` is refused (503) when the card cache is empty or Card Kingdom
 * has no cached feed, since the order asked for cannot be had (the engine's
 * rule).
 */
export async function handleListsSummary(req: Request): Promise<Response> {
  try {
    const query = parseListsSummaryParams(new URL(req.url).searchParams)
    if (isApiMessage(query)) return badRequest(query)

    const { source, ...options } = query
    const selection: ListsSummaryOptions = options
    const pricing = source === undefined ? undefined : await serverReportPricing(source)
    if (pricing !== undefined) selection.priced = summaryPricing(pricing, 'never')

    const summary = await summarizeLists(selection)
    if (isListsSummaryRefusal(summary)) {
      return nestedRefusal(summary.reason, summary.refused === 'prices' ? 503 : 400)
    }

    const body: ListsSummaryResponse = { success: true, ...summary }
    if (summary.source !== undefined && pricing !== undefined && !isSyncMessage(pricing)) {
      body.lastRefreshedAt = await pricesRefreshedAt(pricing)
    }
    return Response.json(body)
  } catch (err) {
    return errorResponse(err)
  }
}
