import type { CollectionCardEntry, WantedListCardEntry } from '../site/data-types'
import type { SelectedCard } from '../site/useCardSelection'
import { serializeSectionedList } from '../section-format'
import { formatCollectionLine, formatWantedListLine } from '../card-line'

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

/** Quote a CSV field when it contains a comma, quote, or newline, escaping embedded quotes per RFC 4180. */
export const csvCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value

/**
 * Build the parenthesised printing suffix for a selected card's text line, e.g.
 * ` (LEA:161)`. Empty when the card has no resolved set/collector number
 * (a name-only entry whose printing never resolved).
 */
function selectionPrintingSuffix(card: SelectedCard): string {
  if (!card.set || !card.collectorNumber) return ''
  return ` (${card.set.toUpperCase()}:${card.collectorNumber})`
}

/** Aggregation key grouping identical selected printings so quantities sum. */
function selectionKey(card: SelectedCard): string {
  return `${card.name}|${card.set ?? ''}|${card.collectorNumber ?? ''}|${card.finish ?? ''}|${card.condition ?? ''}`
}

type AggregatedSelection = { card: SelectedCard; quantity: number }

/** Collapse identical selected printings, summing their quantities, preserving first-seen order. */
function aggregateSelection(cards: SelectedCard[]): AggregatedSelection[] {
  const counts = new Map<string, AggregatedSelection>()
  for (const card of cards) {
    const key = selectionKey(card)
    const existing = counts.get(key)
    if (existing) existing.quantity += card.quantity
    else counts.set(key, { card, quantity: card.quantity })
  }
  return [...counts.values()]
}

/**
 * Serialize selected cards to a plain-text list, one line per distinct printing:
 * `N {Name} ({SET}:{Collector Number})`. Matches the deck "Copy" text shape and
 * the canonical set-code uppercasing.
 */
export function selectionToText(cards: SelectedCard[]): string {
  return aggregateSelection(cards)
    .map(({ card, quantity }) => `${quantity} ${card.name}${selectionPrintingSuffix(card)}`)
    .join('\n')
}

/**
 * Serialize selected cards to CSV (`Name,Set,Collector Number,Finish,Condition,Quantity`).
 * Mirrors {@link collectionToCsv} so a "Copy as CSV" of a whole collection matches
 * its "Download CSV", but works across decks and wanted lists too.
 */
export function selectionToCsv(cards: SelectedCard[]): string {
  const lines = ['Name,Set,Collector Number,Finish,Condition,Quantity']
  for (const { card, quantity } of aggregateSelection(cards)) {
    lines.push(
      `${csvCell(card.name)},${card.set?.toUpperCase() ?? ''},${card.collectorNumber ?? ''},${card.finish ?? ''},${card.condition ?? ''},${quantity}`,
    )
  }
  return lines.join('\n')
}

/**
 * Serialize a collection to CSV (`Name,Set,Collector Number,Finish,Condition,Quantity`).
 * Collection entries are atomic (one copy each), so identical printings are grouped
 * and counted into the Quantity column.
 */
export function collectionToCsv(entries: CollectionCardEntry[]): string {
  type Row = { name: string; set: string; cn: string; finish: string; condition: string }
  type CountedRow = { row: Row; quantity: number }
  const counts = new Map<string, CountedRow>()
  for (const entry of entries) {
    const row: Row = {
      name: entry.name,
      set: entry.set.toUpperCase(),
      cn: entry.collectorNumber,
      finish: entry.finish || '',
      condition: entry.condition || '',
    }
    const key = `${row.name}|${row.set}|${row.cn}|${row.finish}|${row.condition}`
    const existing = counts.get(key)
    if (existing) existing.quantity += 1
    else counts.set(key, { row, quantity: 1 })
  }
  const lines = ['Name,Set,Collector Number,Finish,Condition,Quantity']
  for (const { row, quantity } of counts.values()) {
    lines.push(
      `${csvCell(row.name)},${row.set},${row.cn},${row.finish},${row.condition},${quantity}`,
    )
  }
  return lines.join('\n')
}
