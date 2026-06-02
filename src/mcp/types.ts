import type { Condition, DeckData, Finish } from '../types'
import type { ListType } from '../list-type'

/**
 * Named result shapes for the subset of admin API responses the MCP layer reads.
 * Each interface captures only the fields a tool or mutation flow actually consumes;
 * the admin handlers return more, but narrowing to these keeps tool output focused
 * and the casts in `dispatch`/`mutations` honest.
 */

/** A collection entry as returned by `GET /api/collection/:slug`. */
export interface CollectionEntry {
  name: string
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
  section?: string
}

/** A wanted-list entry as returned by `GET /api/wanted/:slug`. */
export interface ParsedWantedEntry {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  note?: string
  cardId?: number
  section?: string
}

/** `GET /api/deck/:slug` — the fields the deck read and mutation flows consume. */
export interface DeckLoadResult {
  deck: DeckData
  frontMatter: Record<string, unknown>
  contentHash: string
}

/** `GET /api/collection/:slug` — entries plus the section order and content hash. */
export interface CollectionLoadResult {
  entries: CollectionEntry[]
  sectionOrder?: string[]
  contentHash: string
}

/** `GET /api/wanted/:slug` — entries plus the section order and content hash. */
export interface WantedLoadResult {
  entries: ParsedWantedEntry[]
  sectionOrder?: string[]
  contentHash: string
}

/** Response shape shared by the deck/collection/wanted save endpoints. */
export interface SaveResult {
  success: boolean
  message: string
  contentHash: string
}

/** A list summary as returned by `GET /api/history` (every list across all three types). */
export interface ListSummary {
  type: ListType
  slug: string
  name: string
}

/** `GET /api/history` body — used by the resource enumerator. */
export interface ListsResponse {
  lists: ListSummary[]
}

/** A compact, agent-friendly projection of one Scryfall printing. */
export interface PrintingSummary {
  scryfallId?: string
  name: string
  set?: string
  collectorNumber?: string
  rarity?: string
  releasedAt?: string
  finishes?: string[]
  prices?: Record<string, string | null>
}
