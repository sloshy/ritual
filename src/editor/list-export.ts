import type { DeckData } from '../types'
import type { CollectionCardEntry, WantedListCardEntry } from '../site/data-types'
import type { SelectedCard } from '../site/useCardSelection'
import { normalizeCardLabels, type CardLabel } from '../card-labels'
import { serializeListImageRef, type ListImageRef } from '../list-image'
import type { FlatListFrontMatter } from '../flat-list-front-matter'
import { serializeSectionedList } from '../section-format'
import {
  aggregateQuantities,
  formatCollectionLine,
  formatWantedListLine,
  printingSuffix,
  variantKey,
  type Aggregated,
} from '../card-line'
import { assignMissingEntryIds } from '../card-id'
import { storedLanguage, type CardLanguage } from '../card-language'
import { csvCell } from '../csv'
import { DEFAULT_EXPORT_COLUMNS, EXPORT_PROPERTY_LABELS } from '../export/render'

/**
 * Header row shared by every fixed-column CSV export
 * (`Name,Set,Collector Number,Finish,Condition,Language,Quantity`). Derived
 * from the `ritual export` property labels so the two CSV surfaces can never
 * drift.
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
  return formatCollectionLine({
    cardName: entry.name,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition: entry.condition,
    language: entry.language,
    labels: entry.labels,
    note: entry.note,
    cardId: entry.cardId,
  })
}

/**
 * Prepend a flat list's front-matter block to a serialized body, with the
 * canonical single blank line between the closing `---` and the `# Title`.
 * Plain string concatenation on purpose: the block is carried verbatim from
 * parse (see `FlatListFrontMatter.raw`), and this module runs in the browser,
 * where a YAML dumper has no place.
 */
export function withFrontMatter(
  frontMatter: FlatListFrontMatter | undefined,
  body: string,
): string {
  if (!frontMatter) return body
  return `${frontMatter.raw}\n${body}`
}

/** The front-matter fields a list detail bakes, and so a download can re-emit. */
export type ListFrontMatterFields = {
  /** The list's prose blurb, when it declares one. */
  description?: string
  /** The list's default card labels, when it declares any. */
  labels?: readonly CardLabel[]
  /** The list's cover image override, when it declares one. */
  image?: ListImageRef
}

/**
 * Synthesize a front-matter block from the metadata a list detail bakes — for
 * the browser-side .md downloads, where only `CollectionDetail.labels` and
 * `CollectionDetail.listImage` are available. Any *other* hand-authored
 * front-matter key is not baked into site data, so it cannot appear in a
 * downloaded file.
 *
 * Emitted by hand rather than dumped: this module runs in the browser, where a
 * YAML dumper has no place. String scalars go through `JSON.stringify` — a
 * double-quoted YAML scalar and a JSON string agree on escaping — and `card` is
 * a plain integer.
 */
export function frontMatterFor(fields: ListFrontMatterFields): FlatListFrontMatter | undefined {
  const data: Record<string, unknown> = {}
  const lines: string[] = []
  const description = fields.description
  if (description) {
    data.description = description
    // Always double-quoted: a description is free prose, so an unquoted scalar
    // could open a YAML mapping, a comment, or a multi-line block.
    lines.push(`description: ${JSON.stringify(description)}`)
  }
  const labels = fields.labels
  if (labels && labels.length > 0) {
    const normalized = normalizeCardLabels(labels)
    data.labels = normalized
    lines.push(`labels: [${normalized.join(', ')}]`)
  }
  const image = fields.image
  if (image) {
    const serialized = serializeListImageRef(image)
    data.image = serialized
    const [key, value] = Object.entries(serialized)[0] as [string, string | number]
    lines.push(`image:\n  ${key}: ${typeof value === 'number' ? value : JSON.stringify(value)}`)
  }
  if (lines.length === 0) return undefined
  return { raw: `---\n${lines.join('\n')}\n---\n`, data }
}

/** Serialize one wanted-list entry to its canonical markdown line. */
export function serializeWantedListEntry(entry: WantedListCardEntry): string {
  const printing =
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined
  return formatWantedListLine({
    name: entry.name,
    printing,
    finish: entry.finish,
    language: entry.language,
    note: entry.note,
    cardId: entry.cardId,
  })
}

/**
 * Serialize a whole collection (sectioned, with an `# H1` title) to markdown.
 *
 * Entries without a `&N` id — or repeating one an earlier entry already claimed
 * — are healed by {@link assignMissingEntryIds} first, so a collection file is
 * never written with an id-less or ambiguous card line. Mirrors the invariant
 * `serializeDeckToMarkdown` enforces for decks.
 */
export function collectionToMarkdown(
  title: string,
  entries: CollectionCardEntry[],
  sectionOrder: string[],
  frontMatter?: FlatListFrontMatter,
): string {
  return withFrontMatter(
    frontMatter,
    serializeSectionedList(
      title,
      assignMissingEntryIds(entries),
      sectionOrder,
      serializeCollectionEntry,
    ),
  )
}

/** Serialize a whole wanted list (sectioned, with an `# H1` title) to markdown. */
export function wantedToMarkdown(
  title: string,
  entries: WantedListCardEntry[],
  sectionOrder: string[],
  frontMatter?: FlatListFrontMatter,
): string {
  return withFrontMatter(
    frontMatter,
    serializeSectionedList(
      title,
      assignMissingEntryIds(entries),
      sectionOrder,
      serializeWantedListEntry,
    ),
  )
}

/**
 * Build one CSV data row in the canonical {@link CSV_HEADER} column order. Only the
 * name is quoted (the other columns are simple tokens); the set code is uppercased
 * here so every export path applies the rule in one place. Callers pass already
 * caller-specific normalisation (e.g. stripping a `nonfoil` finish); the Language
 * column carries the code and is blank for English, mirroring the markdown token.
 */
function csvRow(
  name: string,
  set: string,
  collectorNumber: string,
  finish: string,
  condition: string,
  language: CardLanguage | undefined,
  quantity: number,
): string {
  return [
    csvCell(name),
    set.toUpperCase(),
    collectorNumber,
    finish,
    condition,
    storedLanguage(language) ?? '',
    quantity,
  ].join(',')
}

const aggregateSelection = (cards: SelectedCard[]): Aggregated<SelectedCard>[] =>
  aggregateQuantities(
    cards,
    (c) => variantKey(c.name, c.set, c.collectorNumber, c.finish, c.condition, c.language),
    (c) => c.quantity,
  )

/** Collection entries are atomic (one copy each), so each contributes a quantity of 1. */
const aggregateCollection = (entries: CollectionCardEntry[]): Aggregated<CollectionCardEntry>[] =>
  aggregateQuantities(
    entries,
    (e) => variantKey(e.name, e.set, e.collectorNumber, e.finish, e.condition, e.language),
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
      entry.language,
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
      entry.language,
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
    csvRow(
      entry.name,
      entry.set ?? '',
      entry.collectorNumber ?? '',
      entry.finish ?? '',
      '',
      entry.language,
      1,
    ),
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
        card.language,
        card.quantity,
      ),
    ),
  )
  return [CSV_HEADER, ...rows].join('\n')
}
