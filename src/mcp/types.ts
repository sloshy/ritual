import type { ListType } from '../list-type'
import type { ParsedWantedEntry } from '../editor/wanted-entries'

/**
 * Named result shapes for the subset of admin API responses the MCP layer reads.
 * The load-endpoint shapes are shared with the change-bundle import engine and
 * live next to the handlers (see `src/admin/api/load-results.ts`); they are
 * re-exported here so MCP code keeps one import site for its response types.
 */
export type {
  CollectionEntry,
  DeckLoadResult,
  CollectionLoadResult,
  WantedLoadResult,
} from '../admin/api/load-results'

/** A wanted-list entry as returned by `GET /api/wanted/:slug`. */
export type { ParsedWantedEntry }

/** Response shape shared by the deck/collection/wanted save endpoints. */
export interface SaveResult {
  success: boolean
  message: string
  contentHash: string
}

/** A list summary as returned by `GET /api/lists` (every list across all three types). */
export interface ListSummary {
  type: ListType
  slug: string
  name: string
}

/** `GET /api/lists` body — used by the resource enumerator and `list_lists`. */
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
