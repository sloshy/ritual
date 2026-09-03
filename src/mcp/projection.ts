import type { ListCounts, ListSummaryLoadResult } from '../admin/api/load-results'
import type { CardArtRecord } from '../list/card-art'
import type { CardLabel } from '../card/card-labels'
import type { ListImageRef } from '../list/list-image'
import type { ListType } from '../list/list-type'
import type { CardCategoriesJson } from '../list/card-categories-sidecar'
import { callApi } from './dispatch'
import type {
  CollectionEntry,
  CollectionLoadResult,
  DeckLoadData,
  DeckLoadResult,
  ParsedWantedEntry,
  WantedLoadResult,
  WithCardCategories,
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
 *
 * Language: an entry (deck card, collection entry, wanted entry) carries a
 * `language` field only when it is not English — an absent value always means
 * `en`, mirroring the card lines themselves, where the `[ja]`-style token is
 * omitted for English.
 *
 * Tags: every entry shape carries the line's `#tags` as `tags` — canonical
 * (lowercase, sorted) and without the sigil — on every list type, absent when
 * the line has none. The list-level `labels` default has no tag counterpart: a
 * deck's front-matter `tags` describe the deck, not its cards.
 *
 * Custom art rides beside the entries rather than on them, as `customArt` keyed
 * by `&N` — the shape the load routes and the `<list>.art.json` sidecar both
 * use, and the raw references `set_card_art` takes back rather than display
 * URLs.
 *
 * Categories ride beside the entries as `categories` — the list's vocabulary and
 * its per-name assignments — and on each entry as its own resolved `categories`,
 * so a client never re-implements the name fold. Absent means none, at both
 * levels.
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
  deck: DeckLoadData
  frontMatter: Record<string, unknown>
  /**
   * The deck's default card labels (`proxy` alone) — its front matter's, read
   * out here so every list type reports its list-level default the same way. A
   * card's own `labels` override it.
   */
  labels?: CardLabel[]
  /**
   * The list's cover image override from its front matter, absent when the
   * built-in rule (commander, else the most expensive printing) chooses the
   * cover. Projected out beside `labels` for the same reason: every list type
   * reports its list-level settings the same way, and a flat list has no
   * `frontMatter` field to read one out of. Write it with `set_list_metadata`.
   */
  image?: ListImageRef
  /** See the module comment: custom art by `&N`, absent when no card has any. */
  customArt?: CardArtRecord
  /**
   * The list's categories, beside the entries and keyed by card *name*: the
   * vocabulary's `order` and each name's ordered assignments. Absent when the
   * list has none, exactly as {@link DeckProjection.customArt} is.
   */
  categories?: CardCategoriesJson
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
  /**
   * What was wrong with the `<list>.art.json` sidecar, kept apart from
   * {@link DeckProjection.warnings}: a mutation refuses a list whose *lines* are
   * unreadable, and bad custom art must never be mistaken for that. Absent when
   * the sidecar is clean or there is none.
   */
  artWarnings?: string[]
  /**
   * What was wrong with the `<list>.categories.json` sidecar, kept apart from
   * {@link DeckProjection.warnings} for the same reason
   * {@link DeckProjection.artWarnings} is. Absent when the sidecar is clean or
   * there is none.
   */
  categoryWarnings?: string[]
}

/** Projected flat-list (collection/wanted) load payload: entries plus section order. */
export type FlatListProjection = {
  view: 'cards'
  listType: 'collection' | 'wanted'
  slug: string
  entries: WithCardCategories<CollectionEntry>[] | WithCardCategories<ParsedWantedEntry>[]
  sectionOrder?: string[]
  /**
   * The list's prose blurb from its front matter, absent when it declares none.
   * A deck's rides in `DeckProjection.deck.description` instead. Write it with
   * `set_list_metadata`.
   */
  description?: string
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
  /** See {@link DeckProjection.image}. Carried by both flat list types. */
  image?: ListImageRef
  /** See {@link DeckProjection.customArt}. */
  customArt?: CardArtRecord
  /** See {@link DeckProjection.categories}. */
  categories?: CardCategoriesJson
  /** See {@link DeckProjection.totalCount}. */
  totalCount: number
  /** See {@link DeckProjection.warnings}. */
  warnings: string[]
  /** See {@link DeckProjection.artWarnings}. */
  artWarnings?: string[]
  /** See {@link DeckProjection.categoryWarnings}. */
  categoryWarnings?: string[]
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
  // The categories fields are spread conditionally, the same idiom
  // `applyMutation` uses: an `undefined`-valued key survives an in-process
  // transport and advertises a field the client cannot read, and absent means
  // none at both levels.
  if (listType === 'deck') {
    const data = (await callApi('GET', path)) as DeckLoadResult
    const projection: DeckProjection = {
      view: 'cards',
      listType: 'deck',
      slug,
      deck: data.deck,
      frontMatter: data.frontMatter,
      labels: data.labels,
      image: data.image,
      customArt: data.customArt,
      ...(data.categories === undefined ? {} : { categories: data.categories }),
      totalCount: data.totalCount,
      warnings: data.warnings,
      artWarnings: data.artWarnings,
      ...(data.categoryWarnings === undefined ? {} : { categoryWarnings: data.categoryWarnings }),
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
    description: data.description,
    labels: data.labels,
    image: data.image,
    customArt: data.customArt,
    ...(data.categories === undefined ? {} : { categories: data.categories }),
    totalCount: data.totalCount,
    warnings: data.warnings,
    artWarnings: data.artWarnings,
    ...(data.categoryWarnings === undefined ? {} : { categoryWarnings: data.categoryWarnings }),
  }
  return projection
}
