import type { Condition, DeckData, Finish } from '../../types'
import type { CardArtRecord } from '../../card-art'
import type { CardLabel } from '../../card-labels'
import type { ListImageRef } from '../../list-image'
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
  /**
   * What was wrong with the list's `<list>.art.json` sidecar: unreadable, or
   * holding art for cards the list no longer has. Kept apart from
   * {@link ListLoadBase.warnings} on purpose — that channel means "lines this
   * file would lose if you saved it", and a save refuses on it. Custom art is
   * display metadata in a file no card save touches, so it is reported and
   * nothing more. Omitted when the sidecar is clean or absent.
   */
  artWarnings?: string[]
  /**
   * The custom art of the cards in this body, keyed by their `&N` id — the raw
   * references, not display URLs, because a client that can edit them (the
   * admin editor, via `PUT /api/art/:type/:slug`) needs the file path or URL
   * the user typed. Omitted when none of the returned cards has any.
   */
  customArt?: CardArtRecord
}

/** `GET /api/deck/:slug?view=cards` — the deck's lines and front matter. */
export interface DeckCardsLoadResult extends ListLoadBase {
  view: 'cards'
  deck: DeckData
  frontMatter: Record<string, unknown>
  /**
   * The deck's default card labels from its front matter (`proxy` alone).
   * Projected out of `frontMatter` so every list type reports its list-level
   * default the same way; a card's own `labels` override it.
   */
  labels?: CardLabel[]
  /**
   * The list's cover image override from its front matter, absent when the
   * built-in rule chooses the cover. Projected out of `frontMatter` for the same
   * reason `labels` is: every list type reports it the same way, and a flat list
   * has no `frontMatter` field to read it out of.
   */
  image?: ListImageRef
}

/** `GET /api/deck/:slug` (`view=full`) — the editor payload: the cards view plus Scryfall data. */
export interface DeckFullLoadResult extends ListLoadBase, DeckCardLoadResult {
  view: 'full'
  deck: DeckData
  frontMatter: Record<string, unknown>
  /** See {@link DeckCardsLoadResult.labels}. */
  labels?: CardLabel[]
  /** See {@link DeckCardsLoadResult.image}. */
  image?: ListImageRef
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
  /** See {@link DeckCardsLoadResult.image}. Carried by both flat list types. */
  image?: ListImageRef
}

/** `view=full` body for a flat list — the cards view plus Scryfall data. */
export interface FlatFullLoadResult<T> extends ListLoadBase, EntryCardLoadResult {
  view: 'full'
  entries: T[]
  sectionOrder?: string[]
  /** The list's default card labels from its front matter — collections only. */
  labels?: CardLabel[]
  /** See {@link DeckCardsLoadResult.image}. Carried by both flat list types. */
  image?: ListImageRef
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
