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

/**
 * `GET /api/lists` body — used by the resource enumerator and `list_lists`.
 * Re-exported from the handler so a shape change there breaks MCP at compile
 * time instead of yielding `undefined` fields at runtime.
 */
export type { ListsResponse } from '../admin/api/lists'

/**
 * The compact, agent-friendly projections of a Scryfall card, owned by
 * `src/api/card-summary.ts` (the routes emit them) and re-exported here so MCP
 * code keeps one import site for its response types.
 */
export type { PrintingSummary, CardSummary, CardDetails } from '../api/card-summary'
