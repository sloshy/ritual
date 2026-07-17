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
 * the `load_list` tool and the `ritual://{type}/{slug}` resource reads so the
 * two surfaces can never drift apart.
 */

/** Projected `GET /api/deck/:slug` payload: sections/cards plus front matter. */
export type DeckProjection = {
  slug: string
  deck: DeckData
  frontMatter: Record<string, unknown>
}

/** Projected flat-list (collection/wanted) load payload: entries plus section order. */
export type FlatListProjection = {
  slug: string
  entries: CollectionEntry[] | ParsedWantedEntry[]
  sectionOrder?: string[]
}

export type ListProjection = DeckProjection | FlatListProjection

/**
 * Load one list through its admin endpoint and project the payload down to the
 * agent-facing shape (dropping card data, printings, prices, and the content
 * hash — mutations manage hashes internally via {@link import('./mutations')}).
 */
export async function loadProjectedList(listType: ListType, slug: string): Promise<ListProjection> {
  const encoded = encodeURIComponent(slug)
  if (listType === 'deck') {
    const data = (await callApi('GET', `/api/deck/${encoded}`)) as DeckLoadResult
    return { slug, deck: data.deck, frontMatter: data.frontMatter }
  }
  if (listType === 'collection') {
    const data = (await callApi('GET', `/api/collection/${encoded}`)) as CollectionLoadResult
    return { slug, entries: data.entries, sectionOrder: data.sectionOrder }
  }
  const data = (await callApi('GET', `/api/wanted/${encoded}`)) as WantedLoadResult
  return { slug, entries: data.entries, sectionOrder: data.sectionOrder }
}
