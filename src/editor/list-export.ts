import type { CollectionCardEntry, WantedListCardEntry } from '../site/data-types'
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

const csvCell = (value: string): string => (value.includes(',') ? `"${value}"` : value)

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
