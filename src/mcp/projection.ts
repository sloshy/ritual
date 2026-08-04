import type { ListCounts, ListSummaryLoadResult } from '../admin/api/load-results'
import type { CardLabel } from '../card-labels'
import type { ListType } from '../list-type'
import type { DeckData } from '../types'
import { callApi } from './dispatch'
import type {
  CollectionEntry,
  CollectionLoadResult,
  DeckLoadResult,
  ParsedWantedEntry,
  WantedLoadResult,
} from './types'

/**
 * Agent-facing projections of the admin load endpoints. The endpoints return
 * heavy editor payloads (Scryfall card data, printings, prices, symbol maps)
 * that agents never need; these shapes keep only the list contents. Shared by
 * the `get_list` tool and the `ritual://{type}/{slug}` resource reads so the
 * two surfaces can never drift apart.
 *
 * Every load here asks for `view=cards` (or `summary`), which is what makes the
 * projection cheap rather than merely small: the route returns before loading
 * any of the payload this shape would otherwise discard.
 */

/** Read options `get_list` and the resource reader pass to the load routes. */
export interface ListLoadQuery {
  view?: 'cards' | 'summary'
  section?: string
  nameContains?: string
  limit?: number
  offset?: number
}

/**
 * Projected `GET /api/deck/:slug` payload: sections/cards plus front matter.
 *
 * `view` and `listType` are the discriminants of {@link ListProjection}: a
 * client reads two fields to know which of the three shapes it was handed,
 * rather than probing for `deck` vs `entries`.
 */
export type DeckProjection = {
  view: 'cards'
  listType: 'deck'
  slug: string
  deck: DeckData
  frontMatter: Record<string, unknown>
  /**
   * Lines that matched before `limit`/`offset` applied. Always present; on an
   * unfiltered read it is the deck's whole line count.
   */
  totalCount: number
  /**
   * Lines the parser could not read. Always present — an empty array is the
   * honest report for a clean file, and an unread list that merely loaded
   * shorter is exactly the failure an optional field hides.
   */
  warnings: string[]
}

/** Projected flat-list (collection/wanted) load payload: entries plus section order. */
export type FlatListProjection = {
  view: 'cards'
  listType: 'collection' | 'wanted'
  slug: string
  entries: CollectionEntry[] | ParsedWantedEntry[]
  sectionOrder?: string[]
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
  /** See {@link DeckProjection.totalCount}. */
  totalCount: number
  /** See {@link DeckProjection.warnings}. */
  warnings: string[]
}

/** Projected `?view=summary` payload: how much is in the list, and nothing else. */
export type ListSummaryProjection = {
  view: 'summary'
  listType: ListType
  slug: string
  counts: ListCounts
  /** See {@link DeckProjection.warnings}. */
  warnings: string[]
}

export type ListProjection = DeckProjection | FlatListProjection | ListSummaryProjection

/**
 * Build the load route's query string. `view` always ends up set — `cards` when
 * the caller did not ask for a summary — so no MCP read ever pays for the
 * editor payload.
 */
export function buildListLoadQuery(query: ListLoadQuery | undefined): string {
  const params = new URLSearchParams({ view: query?.view ?? 'cards' })
  if (query?.section !== undefined) params.set('section', query.section)
  if (query?.nameContains !== undefined) params.set('nameContains', query.nameContains)
  if (query?.limit !== undefined) params.set('limit', String(query.limit))
  if (query?.offset !== undefined) params.set('offset', String(query.offset))
  return `?${params}`
}

/**
 * Load one list through its admin endpoint and project the payload down to the
 * agent-facing shape (dropping card data, printings, prices, and the content
 * hash — mutations manage hashes internally via {@link import('./mutations')}).
 */
export async function loadProjectedList(
  listType: ListType,
  slug: string,
  query?: ListLoadQuery,
): Promise<ListProjection> {
  const path = `/api/${listType}/${encodeURIComponent(slug)}${buildListLoadQuery(query)}`

  if (query?.view === 'summary') {
    const data = (await callApi('GET', path)) as ListSummaryLoadResult
    const summary: ListSummaryProjection = {
      view: 'summary',
      listType,
      slug,
      counts: data.counts,
      warnings: data.warnings,
    }
    return summary
  }
  if (listType === 'deck') {
    const data = (await callApi('GET', path)) as DeckLoadResult
    const projection: DeckProjection = {
      view: 'cards',
      listType: 'deck',
      slug,
      deck: data.deck,
      frontMatter: data.frontMatter,
      totalCount: data.totalCount,
      warnings: data.warnings,
    }
    return projection
  }
  const data = (await callApi('GET', path)) as CollectionLoadResult | WantedLoadResult
  const projection: FlatListProjection = {
    view: 'cards',
    listType,
    slug,
    entries: data.entries,
    sectionOrder: data.sectionOrder,
    labels: data.labels,
    totalCount: data.totalCount,
    warnings: data.warnings,
  }
  return projection
}
