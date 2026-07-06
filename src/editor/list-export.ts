import type { DeckData } from '../types'
import type { CollectionCardEntry, WantedListCardEntry } from '../site/data-types'
import type { SelectedCard } from '../site/useCardSelection'
import { serializeSectionedList } from '../section-format'
import { formatCollectionLine, formatWantedListLine, printingSuffix } from '../card-line'
import { csvCell } from '../csv'
import { DEFAULT_EXPORT_COLUMNS, EXPORT_PROPERTY_LABELS } from '../export/render'

/**
 * Header row shared by every fixed-column CSV export
 * (`Name,Set,Collector Number,Finish,Condition,Quantity`). Derived from the
 * `ritual export` property labels so the two CSV surfaces can never drift.
 */
export const CSV_HEADER = DEFAULT_EXPORT_COLUMNS.map(
  (column) => EXPORT_PROPERTY_LABELS[column],
).join(',')

/**
 * Markdown/CSV serializers for collection and wanted-list entries. Shared by the
 * admin save handlers and the public editor's export so a downloaded file is
 * byte-identical to what a server save would write (canonical card lines, `&N`
 * IDs and all).
 */

/** Serialize one collection entry to its canonical markdown line. */
export function serializeCollectionEntry(entry: CollectionCardEntry): string {
  return formatCollectionLine(
    entry.name,
    entry.set,
    entry.collectorNumber,
    entry.finish,
    entry.condition,
    entry.note,
    entry.cardId,
  )
}

/** Serialize one wanted-list entry to its canonical markdown line. */
export function serializeWantedListEntry(entry: WantedListCardEntry): string {
  const printing =
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined
  return formatWantedListLine(entry.name, printing, entry.finish, entry.note, entry.cardId)
}

/** Serialize a whole collection (sectioned, with an `# H1` title) to markdown. */
export function collectionToMarkdown(
  title: string,
  entries: CollectionCardEntry[],
  sectionOrder: string[],
): string {
  return serializeSectionedList(title, entries, sectionOrder, serializeCollectionEntry)
}

/** Serialize a whole wanted list (sectioned, with an `# H1` title) to markdown. */
export function wantedToMarkdown(
  title: string,
  entries: WantedListCardEntry[],
  sectionOrder: string[],
): string {
  return serializeSectionedList(title, entries, sectionOrder, serializeWantedListEntry)
}

/**
 * Build one CSV data row in the canonical {@link CSV_HEADER} column order. Only the
 * name is quoted (the other columns are simple tokens); the set code is uppercased
 * here so every export path applies the rule in one place. Callers pass already
 * caller-specific normalisation (e.g. stripping a `nonfoil` finish).
 */
function csvRow(
  name: string,
  set: string,
  collectorNumber: string,
  finish: string,
  condition: string,
  quantity: number,
): string {
  return [csvCell(name), set.toUpperCase(), collectorNumber, finish, condition, quantity].join(',')
}

/** One grouped item plus its summed quantity, preserving first-seen order. */
type Aggregated<E> = { entry: E; quantity: number }

/** Group items by a string key, summing per-item quantities, preserving first-seen order. */
function aggregate<E>(
  items: E[],
  key: (item: E) => string,
  quantity: (item: E) => number,
): Aggregated<E>[] {
  const counts = new Map<string, Aggregated<E>>()
  for (const item of items) {
    const k = key(item)
    const existing = counts.get(k)
    if (existing) existing.quantity += quantity(item)
    else counts.set(k, { entry: item, quantity: quantity(item) })
  }
  return [...counts.values()]
}

/** Aggregation key grouping identical printings (name + printing + finish + condition). */
const variantKey = (
  name: string,
  set: string | undefined,
  collectorNumber: string | undefined,
  finish: string | undefined,
  condition: string | undefined,
): string => `${name}|${set ?? ''}|${collectorNumber ?? ''}|${finish ?? ''}|${condition ?? ''}`

const aggregateSelection = (cards: SelectedCard[]): Aggregated<SelectedCard>[] =>
  aggregate(
    cards,
    (c) => variantKey(c.name, c.set, c.collectorNumber, c.finish, c.condition),
    (c) => c.quantity,
  )

/** Collection entries are atomic (one copy each), so each contributes a quantity of 1. */
const aggregateCollection = (entries: CollectionCardEntry[]): Aggregated<CollectionCardEntry>[] =>
  aggregate(
    entries,
    (e) => variantKey(e.name, e.set, e.collectorNumber, e.finish, e.condition),
    () => 1,
  )

/**
 * Serialize selected cards to a plain-text list, one line per distinct printing:
 * `N {Name} ({SET}:{Collector Number})`. Matches the deck "Copy" text shape and
 * the canonical set-code uppercasing.
 */
export function selectionToText(cards: SelectedCard[]): string {
  return aggregateSelection(cards)
    .map(
      ({ entry, quantity }) =>
        `${quantity} ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`,
    )
    .join('\n')
}

/**
 * Serialize selected cards to CSV ({@link CSV_HEADER}). Mirrors {@link collectionToCsv}
 * so a "Copy as CSV" of a whole collection matches its CSV export, but works across
 * decks and wanted lists too.
 */
export function selectionToCsv(cards: SelectedCard[]): string {
  const rows = aggregateSelection(cards).map(({ entry, quantity }) =>
    csvRow(
      entry.name,
      entry.set ?? '',
      entry.collectorNumber ?? '',
      entry.finish ?? '',
      entry.condition ?? '',
      quantity,
    ),
  )
  return [CSV_HEADER, ...rows].join('\n')
}

/**
 * Serialize a collection to CSV ({@link CSV_HEADER}). Collection entries are atomic
 * (one copy each), so identical printings are grouped and counted into the Quantity
 * column.
 */
export function collectionToCsv(entries: CollectionCardEntry[]): string {
  const rows = aggregateCollection(entries).map(({ entry, quantity }) =>
    csvRow(
      entry.name,
      entry.set,
      entry.collectorNumber,
      entry.finish || '',
      entry.condition || '',
      quantity,
    ),
  )
  return [CSV_HEADER, ...rows].join('\n')
}

/**
 * Serialize a collection to a plain-text list, one line per distinct printing:
 * `N {Name} ({SET}:{Collector Number})`. Identical printings are grouped and their
 * quantities summed, matching {@link collectionToCsv}.
 */
export function collectionToText(entries: CollectionCardEntry[]): string {
  return aggregateCollection(entries)
    .map(
      ({ entry, quantity }) =>
        `${quantity} ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`,
    )
    .join('\n')
}

/**
 * Serialize a wanted list to a plain-text list, one line per entry:
 * `1 {Name} ({SET}:{Collector Number})`. Wanted entries are atomic and may be
 * name-only (no printing suffix).
 */
export function wantedToText(entries: WantedListCardEntry[]): string {
  return entries
    .map((entry) => `1 ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`)
    .join('\n')
}

/**
 * Serialize a wanted list to CSV ({@link CSV_HEADER}). Wanted entries are atomic
 * (one per line, quantity 1) and never carry a condition.
 */
export function wantedToCsv(entries: WantedListCardEntry[]): string {
  const rows = entries.map((entry) =>
    csvRow(entry.name, entry.set ?? '', entry.collectorNumber ?? '', entry.finish ?? '', '', 1),
  )
  return [CSV_HEADER, ...rows].join('\n')
}

/**
 * Serialize a deck to CSV ({@link CSV_HEADER}), one row per card line using the
 * line's own quantity. Name-only deck entries leave the set/collector columns
 * blank.
 */
export function deckToCsv(deck: DeckData): string {
  const rows = deck.sections.flatMap((section) =>
    section.cards.map((card) =>
      csvRow(
        card.name,
        card.set ?? '',
        card.collectorNumber ?? '',
        card.finish && card.finish !== 'nonfoil' ? card.finish : '',
        card.condition ?? '',
        card.quantity,
      ),
    ),
  )
  return [CSV_HEADER, ...rows].join('\n')
}
