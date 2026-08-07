import type { Condition, DeckData, Finish } from '../../types'
import type { CardLabel } from '../../card-labels'
import type { CardLanguage } from '../../card-language'
import type { ParsedWantedEntry } from '../../editor/wanted-entries'
import type { DeckCardLoadResult, EntryCardLoadResult } from './card-data-loader'
import type { ListCounts, ListLoadView, ListSectionCount } from './list-load-params'

export type { ListCounts, ListLoadView, ListSectionCount }

/**
 * Response shapes of the deck/collection/wanted load endpoints.
 *
 * Every body the three handlers return is declared here and annotated at its
 * `return`, so a field a client reads cannot quietly stop being sent. In-process
 * callers — the MCP layer and the change-bundle import engine — cast the parsed
 * JSON to these same types, which is what keeps the consumers from drifting
 * apart in how they describe the same endpoint.
 */

/** A collection entry as returned by `GET /api/collection/:slug`. */
export interface CollectionEntry {
  name: string
  set: string
  collectorNumber: string
  finish?: Finish
  condition?: Condition
  /** The line's `[ja]`-style language token. Absent means `en` (a bare line). */
  language?: CardLanguage
  /**
   * The entry's label override. Effective labels are this when present, else
   * the list-level `labels` on the load body.
   */
  labels?: CardLabel[]
  note?: string
  cardId?: number
  section?: string
}

/**
 * The mutually exclusive `partial` / `contentHash` pair every load body carries,
 * whatever its view. Stamped by `stampLoadBody` in `list-load.ts`.
 */
export interface ListLoadStamp {
  /**
   * Present, and only ever `true`, when `section`/`nameContains`/`limit`/`offset`
   * narrowed the body — i.e. it describes a slice of the list rather than the
   * list.
   */
  partial?: true
  /**
   * The file's content hash, which the save routes require. Deliberately
   * **omitted on a `partial` body**: the deck and wanted save routes persist the
   * payload they are handed, so saving a slice back would truncate the file.
   * Withholding the hash makes that round trip impossible rather than merely
   * ill-advised — and it applies to a narrowed **summary** too, whose counts
   * likewise describe a slice.
   */
  contentHash?: string
}

/** Fields every non-summary load body carries, whatever the list type. */
export interface ListLoadBase extends ListLoadStamp {
  success: true
  slug: string
  /**
   * Lines that matched the filters, before `limit`/`offset` applied. Always
   * present; on an unfiltered load it is the list's whole line count.
   */
  totalCount: number
  /**
   * Lines the parser could not read. **Always present** — an empty array is the
   * honest report for a clean file, and an optional field is how a client that
   * never checks it silently accepts a list that loaded merely shorter than it
   * is (the `CardIndexResponse` precedent).
   *
   * The save routes refuse a file whose baseline parse produces any, since
   * re-serializing would delete those lines and recycle their `&N` ids.
   */
  warnings: string[]
}

/** `GET /api/deck/:slug?view=cards` — the deck's lines and front matter. */
export interface DeckCardsLoadResult extends ListLoadBase {
  view: 'cards'
  deck: DeckData
  frontMatter: Record<string, unknown>
}

/** `GET /api/deck/:slug` (`view=full`) — the editor payload: the cards view plus Scryfall data. */
export interface DeckFullLoadResult extends ListLoadBase, DeckCardLoadResult {
  view: 'full'
  deck: DeckData
  frontMatter: Record<string, unknown>
  symbolMap: Record<string, string>
}

/** `GET /api/deck/:slug` — the fields the deck read and mutation flows consume. */
export type DeckLoadResult = DeckCardsLoadResult | DeckFullLoadResult

/**
 * `?view=cards` body for a flat (collection | wanted) list — entries plus the
 * section order. Generic in the entry type so the shared flat-list load handler
 * can be typed once; the two concrete aliases below are what clients import.
 */
export interface FlatCardsLoadResult<T> extends ListLoadBase {
  view: 'cards'
  entries: T[]
  sectionOrder?: string[]
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
}

/** `view=full` body for a flat list — the cards view plus Scryfall data. */
export interface FlatFullLoadResult<T> extends ListLoadBase, EntryCardLoadResult {
  view: 'full'
  entries: T[]
  sectionOrder?: string[]
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
  symbolMap: Record<string, string>
}

/** `GET /api/collection/:slug?view=cards` — entries plus the section order. */
export type CollectionCardsLoadResult = FlatCardsLoadResult<CollectionEntry>

/** `GET /api/collection/:slug` (`view=full`) — the cards view plus Scryfall data. */
export type CollectionFullLoadResult = FlatFullLoadResult<CollectionEntry>

/** `GET /api/collection/:slug` — entries plus the section order and content hash. */
export type CollectionLoadResult = CollectionCardsLoadResult | CollectionFullLoadResult

/** `GET /api/wanted/:slug?view=cards` — entries plus the section order. Never carries `labels`. */
export type WantedCardsLoadResult = FlatCardsLoadResult<ParsedWantedEntry> & { labels?: never }

/** `GET /api/wanted/:slug` (`view=full`) — the cards view plus Scryfall data. Never carries `labels`. */
export type WantedFullLoadResult = FlatFullLoadResult<ParsedWantedEntry> & { labels?: never }

/** `GET /api/wanted/:slug` — entries plus the section order and content hash. */
export type WantedLoadResult = WantedCardsLoadResult | WantedFullLoadResult

/**
 * `?view=summary` body for any list type: how much is in the list (after any
 * `section`/`nameContains` filter), the parse warnings, and no card data at all.
 * Cheap by construction — the handler returns it before loading any Scryfall
 * data.
 *
 * The counts describe the whole filtered set: `limit`/`offset` page the *cards*
 * views and are ignored here, so a paging client can read the total it pages
 * against out of the same response.
 *
 * A narrowed summary is `partial` and carries no `contentHash`, exactly like a
 * narrowed cards/full body: the hash is the token the save routes take as "this
 * is the whole file", and a filtered read is not.
 */
export interface ListSummaryLoadResult
  extends Pick<ListLoadBase, 'success' | 'slug' | 'warnings'>, ListLoadStamp {
  view: 'summary'
  counts: ListCounts
}
