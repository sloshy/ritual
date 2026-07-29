import type { ConfigResponse } from '../admin/api/config'
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

/**
 * Response shape shared by the deck/collection/wanted save endpoints, and the
 * per-entry effects it reports. Re-exported from the handler rather than
 * redeclared — an MCP-side copy silently went stale against `droppedNotes`.
 */
export type { ListSaveResponse } from '../admin/api/move-save'
export type { SaveEffect, SaveEffectAction, SaveEffectPrinting } from '../editor/save-effects'

/**
 * A tool result never carries `success`: `callApi` throws on a non-2xx response
 * *and* on a 2xx body with `success: false`, so on every pass-through tool the
 * key is a constant. Stripping it is a client-side projection of an honest
 * handler response, which the API-First rule allows; distributive so it survives
 * a response union (`ExportResponseBody`, the two price bodies).
 */
export type OmitSuccess<T> = T extends unknown ? Omit<T, 'success'> : never

/**
 * `get_config` and `update_config` return the same thing, and they live in
 * different tool modules — so the alias lives here rather than being declared
 * once in each, which is how the two copies came to exist.
 */
export type ConfigResult = OmitSuccess<ConfigResponse>

/**
 * `get_cache_status` result.
 *
 * `CacheStatusResponse` is the collector's own `CacheStatusResult` plus the
 * `success` envelope, so stripping the envelope lands exactly back on it. The
 * canonical type is re-exported rather than re-derived under the same name,
 * which is what kept two different `CacheStatusResult`s in play.
 */
export type { CacheStatusResult } from '../cache/status'

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
export type {
  PrintingIdentity,
  PrintingListing,
  PrintingSummary,
  CardSummary,
  CardDetails,
} from '../api/card-summary'
