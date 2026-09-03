/**
 * List snapshots for the `history` command's "rewrite with defaults" action: load any
 * list type into a uniform snapshot, then derive a single change set's worth of
 * raw changelog lines describing that current state.
 */

import { loadListEntries, type ListEntryRef, type LoadedListEntries } from '../list/entry-load'
import {
  type CardCategoriesRecord,
  loadCardCategories,
  orderedCategoryEntries,
} from '../list/card-categories-sidecar'
import type { ListType } from '../list/list-type'
import { DEFAULT_SECTION } from '../list/deck'
import {
  createAddChange,
  createAddSectionChange,
  createSetCommanderChange,
  createSetLabelChange,
  createAddTagChange,
  createSetCategoriesChange,
  createSetCategoryOrderChange,
  createSetNoteChange,
  createSetSectionChange,
  printingOptionsFrom,
  type ChangeEvent,
} from './change-event'
import { formatChangelogLine } from './changelog-blocks'

/** A single list entry, normalized across decks, collections, and wanted lists. */
export type SnapshotEntry = ListEntryRef

/** A list's current contents, normalized for default-changelog generation. */
export type ListSnapshot = LoadedListEntries

/** Load a list of any type into a uniform {@link ListSnapshot}. */
export { loadListEntries as loadListSnapshot }

/**
 * Build the events of a single "current state" change set. Emits, in order: an
 * add-section per non-default section, then per entry — one add per copy
 * (matching how the diff logs quantities), a set-commander for commanders, a
 * set-note for noted cards, a set-label for cards with a label override, an
 * add-tag per tag on a tagged card, and a set-section for cards outside the
 * default section. When the list's categories sidecar is supplied, a
 * set-category-order and one set-categories per categorized card follow, so a
 * rebuilt history describes the categories as well.
 *
 * The sidecar is a parameter rather than part of {@link ListSnapshot}: the
 * loader (`src/list/entry-load.ts`) sits inside the persistence fence and has no
 * business reading it, so each caller loads it and passes it in.
 */
export function buildDefaultChangeEvents(
  snapshot: ListSnapshot,
  categories?: CardCategoriesRecord,
): ChangeEvent[] {
  const events: ChangeEvent[] = []

  for (const section of snapshot.sectionOrder) {
    if (section !== DEFAULT_SECTION) events.push(createAddSectionChange(section))
  }

  for (const entry of snapshot.entries) {
    const copies = Math.max(1, entry.quantity)
    for (let i = 0; i < copies; i++) {
      events.push(createAddChange(entry.name, printingOptionsFrom(entry)))
    }
    if (entry.isCommander) {
      events.push(createSetCommanderChange(entry.name, { cardId: entry.cardId }))
    }
    if (entry.note) {
      events.push(createSetNoteChange(entry.name, { note: entry.note, cardId: entry.cardId }))
    }
    if (entry.labels && entry.labels.length > 0) {
      events.push(createSetLabelChange(entry.name, { labels: entry.labels, cardId: entry.cardId }))
    }
    for (const tag of entry.tags ?? []) {
      events.push(createAddTagChange(entry.name, { tag, cardId: entry.cardId }))
    }
    if (entry.section !== DEFAULT_SECTION) {
      events.push(createSetSectionChange(entry.name, entry.section, entry.cardId))
    }
  }

  // After the entries, so the cards a categories event names already exist.
  if (categories !== undefined) {
    if (categories.order.length > 0) {
      events.push(createSetCategoryOrderChange(categories.order))
    }
    for (const entry of orderedCategoryEntries(categories)) {
      if (entry.categories.length === 0) continue
      events.push(createSetCategoriesChange(entry.name, entry.categories))
    }
  }

  return events
}

/** {@link buildDefaultChangeEventsForList}'s answer. */
export type ListDefaultEvents = {
  events: ChangeEvent[]
  /**
   * Why the list's categories contributed nothing: the sidecar exists but could
   * not be read. Present only then — the caller reports it, since a rewrite is
   * destructive and a silently dropped set of assignments is news.
   */
  categoriesWarning?: string
}

/**
 * The whole "rewrite with defaults" input for one list: its snapshot and its
 * categories sidecar, composed once. An unreadable sidecar contributes no
 * category events rather than failing the rebuild — a rebuild must not fail over
 * metadata beside the list — and the reason rides back for the caller to report.
 */
export async function buildDefaultChangeEventsForList(
  type: ListType,
  filePath: string,
): Promise<ListDefaultEvents> {
  const snapshot = await loadListEntries(type, filePath)
  const categories = await loadCardCategories(filePath)
  if (!categories.ok) {
    return { events: buildDefaultChangeEvents(snapshot), categoriesWarning: categories.message }
  }
  return { events: buildDefaultChangeEvents(snapshot, categories.categories) }
}

/**
 * {@link buildDefaultChangeEvents} rendered as the prose lines the changelog
 * writer emits (past tense, quoted card names), so the result is
 * indistinguishable from an organically written change set.
 */
export function buildDefaultChangeLines(
  snapshot: ListSnapshot,
  categories?: CardCategoriesRecord,
): string[] {
  return buildDefaultChangeEvents(snapshot, categories).map(formatChangelogLine)
}
