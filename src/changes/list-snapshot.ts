/**
 * List snapshots for the `history` command's "rewrite with defaults" action: load any
 * list type into a uniform snapshot, then derive a single change set's worth of
 * raw changelog lines describing that current state.
 */

import { loadListEntries, type ListEntryRef, type LoadedListEntries } from '../list/entry-load'
import { DEFAULT_SECTION } from '../list/deck'
import {
  createAddChange,
  createAddSectionChange,
  createSetCommanderChange,
  createSetLabelChange,
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
 * set-note for noted cards, a set-label for cards with a label override, and a
 * set-section for cards outside the default section.
 */
export function buildDefaultChangeEvents(snapshot: ListSnapshot): ChangeEvent[] {
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
    if (entry.section !== DEFAULT_SECTION) {
      events.push(createSetSectionChange(entry.name, entry.section, entry.cardId))
    }
  }

  return events
}

/**
 * {@link buildDefaultChangeEvents} rendered as the prose lines the changelog
 * writer emits (past tense, quoted card names), so the result is
 * indistinguishable from an organically written change set.
 */
export function buildDefaultChangeLines(snapshot: ListSnapshot): string[] {
  return buildDefaultChangeEvents(snapshot).map(formatChangelogLine)
}
