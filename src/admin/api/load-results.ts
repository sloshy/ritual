import type { Condition, DeckData, Finish } from '../../types'
import type { ParsedWantedEntry } from '../../editor/wanted-entries'

/**
 * Response shapes of the deck/collection/wanted load endpoints, as consumed by
 * in-process callers — the MCP layer and the change-bundle import engine. Each
 * captures only the fields those callers actually read; the handlers return
 * more (card data, printings, symbol maps). Kept in one place so the two
 * consumers can never drift apart in how they describe the same endpoints.
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
