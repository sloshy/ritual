import { csvCell } from '../csv'
import {
  aggregateQuantities,
  formatCollectionLine,
  formatWantedListLine,
  printingSuffix,
  variantKey,
  type CardPrinting,
} from '../card-line'
import { serializeCardLine } from '../deck-text'
import { archidektCsvCondition, archidektModifier } from '../importers/archidekt-collection'
import type { Card } from '../types'
import type { ExportEntry } from './entries'

/**
 * Every property a card entry can export, in the canonical display order used
 * when presenting the catalog. Card `&N` IDs are internal and intentionally
 * absent.
 */
export const EXPORT_PROPERTIES = [
  'name',
  'quantity',
  'set',
  'collectorNumber',
  'edition',
  'scryfallId',
  'finish',
  'isFoil',
  'condition',
  'labels',
  'note',
  'section',
  'listName',
  'listType',
] as const

export type ExportProperty = (typeof EXPORT_PROPERTIES)[number]

export function isExportProperty(value: string): value is ExportProperty {
  return (EXPORT_PROPERTIES as readonly string[]).includes(value)
}

/** Human-facing labels, used as CSV header cells and in the interactive column picker. */
export const EXPORT_PROPERTY_LABELS: Record<ExportProperty, string> = {
  name: 'Name',
  quantity: 'Quantity',
  set: 'Set',
  collectorNumber: 'Collector Number',
  edition: 'Edition',
  scryfallId: 'Scryfall ID',
  finish: 'Finish',
  isFoil: 'Is Foil',
  condition: 'Condition',
  labels: 'Labels',
  note: 'Note',
  section: 'Section',
  listName: 'List',
  listType: 'List Type',
}

/**
 * Parenthetical hints appended to a column's label wherever columns are being
 * *chosen* (the wizard picker) — never in CSV headers, where the bare label is
 * the cell value.
 */
export const EXPORT_PROPERTY_HINTS: Partial<Record<ExportProperty, string>> = {
  edition: 'set + collector number',
  scryfallId: 'resolved from the local Scryfall cache',
  isFoil: 'true when foil or etched',
  labels: "effective labels — the card's override or its list default",
}

/**
 * The vocabulary an export is written in. `ritual` (the default) writes Ritual's
 * own spellings — the file format's values, unchanged. A non-default dialect
 * writes another tool's spellings for the same properties, so an export can be
 * fed straight into that tool's importer without a translation step.
 *
 * `archidekt` differs from `ritual` in exactly three ways, all in
 * {@link propertyValue} / {@link exportPropertyLabel}:
 *
 * - `finish` renders Archidekt's modifier (`Normal` / `Foil` / `Etched`) and is
 *   labelled `Variant`, the name Archidekt's own CSV importer uses.
 * - `condition` renders Archidekt's CSV short codes, where Damaged is `D`.
 * - Both render the *effective* value when a line marks none (`Normal` / `NM`):
 *   Archidekt's CSV has no "unmarked" spelling, so an empty cell would be a
 *   row Archidekt has to guess about.
 */
export type ExportDialect = 'ritual' | 'archidekt'

export const EXPORT_DIALECTS = ['ritual', 'archidekt'] as const satisfies readonly ExportDialect[]

export function isExportDialect(value: string): value is ExportDialect {
  return (EXPORT_DIALECTS as readonly string[]).includes(value)
}

/** Labels a dialect spells differently from {@link EXPORT_PROPERTY_LABELS}. */
const DIALECT_PROPERTY_LABELS: Record<ExportDialect, Partial<Record<ExportProperty, string>>> = {
  ritual: {},
  archidekt: { finish: 'Variant' },
}

/** A property's header/picker label in a dialect. */
export function exportPropertyLabel(
  property: ExportProperty,
  dialect: ExportDialect = 'ritual',
): string {
  return DIALECT_PROPERTY_LABELS[dialect][property] ?? EXPORT_PROPERTY_LABELS[property]
}

/** The property keys joined for help text, with parenthetical hints where one exists. */
export function describeExportProperties(): string {
  return EXPORT_PROPERTIES.map((property) => {
    const hint = EXPORT_PROPERTY_HINTS[property]
    return hint ? `${property} (${hint})` : property
  }).join(', ')
}

/** Default column set and order, matching the site's fixed CSV export columns. */
export const DEFAULT_EXPORT_COLUMNS: ExportProperty[] = [
  'name',
  'set',
  'collectorNumber',
  'finish',
  'condition',
  'quantity',
]

/**
 * Validate a raw column-key list (from a flag, a preset, or an API body) into
 * an ordered column selection, or an error message. Rejects unknown keys,
 * duplicates, non-strings, and an empty selection. Shared by every surface so
 * the rule (and its error wording) can never drift between them.
 */
export function parseExportColumns(keys: readonly unknown[]): ExportProperty[] | string {
  if (keys.length === 0) {
    return `No columns given. Available columns: ${EXPORT_PROPERTIES.join(', ')}`
  }
  const columns: ExportProperty[] = []
  for (const key of keys) {
    if (typeof key !== 'string' || !isExportProperty(key)) {
      return `Unknown column '${String(key)}'. Available columns: ${EXPORT_PROPERTIES.join(', ')}`
    }
    if (columns.includes(key)) {
      return `Duplicate column '${key}'.`
    }
    columns.push(key)
  }
  return columns
}

/**
 * Parse a `--columns` flag value (comma-separated property keys, in output
 * order) into a validated column list, or an error message.
 */
export function parseColumnsFlag(value: string): ExportProperty[] | string {
  return parseExportColumns(
    value
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0),
  )
}

/**
 * The `edition` column: the pinned printing as a `set:collectorNumber` pair,
 * or undefined when the entry has no printing. Only the set code's case varies
 * by output format, so it is passed in — the collector number is kept verbatim
 * (they can carry meaningful lowercase letters, e.g. `161a`).
 */
function editionValue(entry: ExportEntry, uppercaseSet: boolean): string | undefined {
  if (!entry.set || !entry.collectorNumber) return undefined
  const set = uppercaseSet ? entry.set.toUpperCase() : entry.set
  return `${set}:${entry.collectorNumber}`
}

/**
 * The value an entry exports for one property, or undefined when the entry has
 * none. Set codes stay lowercase here (the internal convention); the CSV
 * renderer uppercases them at the output boundary. The dialect only reaches the
 * properties named in {@link ExportDialect} — every other value is identical in
 * every dialect.
 */
function propertyValue(
  entry: ExportEntry,
  property: ExportProperty,
  dialect: ExportDialect,
): string | number | boolean | undefined {
  switch (property) {
    case 'name':
      return entry.name
    case 'quantity':
      return entry.quantity
    case 'set':
      return entry.set
    case 'collectorNumber':
      return entry.collectorNumber
    case 'edition':
      return editionValue(entry, false)
    case 'scryfallId':
      return entry.scryfallId
    case 'finish':
      // An unmarked line means nonfoil; only a foreign dialect spells that out
      // (Ritual's own output keeps "unmarked" and "nonfoil" distinguishable).
      return dialect === 'archidekt' ? archidektModifier(entry.finish ?? 'nonfoil') : entry.finish
    case 'isFoil':
      return entry.finish === 'foil' || entry.finish === 'etched'
    case 'condition':
      return dialect === 'archidekt'
        ? archidektCsvCondition(entry.condition ?? 'NM')
        : entry.condition
    case 'labels':
      // Same spelling in every dialect — labels are Ritual-specific, so no
      // foreign importer defines a vocabulary to translate into.
      return entry.labels?.length ? entry.labels.join(', ') : undefined
    case 'note':
      return entry.note
    case 'section':
      return entry.section
    case 'listName':
      return entry.listName
    case 'listType':
      return entry.listType
  }
}

/** One exported card as a plain JSON object; keys follow the selected columns. */
export type ExportRecord = Partial<Record<ExportProperty, string | number | boolean>>

/**
 * Render entries as a JSON array of objects, one per entry, containing only the
 * selected properties. Absent properties are omitted rather than emitted as
 * null; key order follows the column order. Set codes stay lowercase (JSON is
 * a data format, matching the internal convention). Keys are the property names
 * in every dialect — a dialect changes values, not the JSON schema.
 */
export function renderJsonExport(
  entries: ExportEntry[],
  columns: ExportProperty[],
  dialect: ExportDialect = 'ritual',
): string {
  const records = entries.map((entry): ExportRecord => {
    const record: ExportRecord = {}
    for (const column of columns) {
      const value = propertyValue(entry, column, dialect)
      if (value !== undefined) record[column] = value
    }
    return record
  })
  return JSON.stringify(records, null, 2)
}

/**
 * Render entries as ONE flat plain-text decklist: `${qty} ${name} (SET:CN)`
 * per distinct variant (finish and condition distinguish variants even though
 * the line prints neither), quantities summed across sections and lists (a
 * multi-list export merges into a single list). No headers or sections; lines
 * appear in first-seen entry order. The printing suffix is omitted for entries
 * without a pinned printing; set codes are uppercased (user-facing output).
 */
export function renderTextExport(entries: ExportEntry[]): string {
  return aggregateQuantities(
    entries,
    (entry) =>
      variantKey(entry.name, entry.set, entry.collectorNumber, entry.finish, entry.condition),
    (entry) => entry.quantity,
  )
    .map(
      ({ entry, quantity }) =>
        `${quantity} ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`,
    )
    .join('\n')
}

/** One list's group of entries for the markdown export, in first-seen order. */
type MarkdownListGroup = { listName: string; entries: ExportEntry[] }

/**
 * The canonical markdown line for one entry, per its list type, WITHOUT a
 * trailing newline (the collection/wanted formatters are newline-terminated
 * while the deck serializer is not, so both are normalized here) and without a
 * `&N` id (ExportEntry deliberately carries none).
 */
function markdownLine(entry: ExportEntry): string {
  if (entry.listType === 'deck') {
    const card: Card = {
      quantity: entry.quantity,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      note: entry.note,
    }
    return serializeCardLine(card)
  }
  if (entry.listType === 'collection' && entry.set && entry.collectorNumber) {
    return formatCollectionLine(
      entry.name,
      entry.set,
      entry.collectorNumber,
      entry.finish ?? 'nonfoil',
      entry.condition,
      entry.labels,
      entry.note,
    ).replace(/\n$/, '')
  }
  // Wanted entries — and, as a type-level fallback, a collection entry missing
  // its printing (the collection parser never produces one) — use the
  // wanted-list grammar, where the printing and finish are optional.
  const printing: CardPrinting | undefined =
    entry.set && entry.collectorNumber
      ? { set: entry.set, collectorNumber: entry.collectorNumber }
      : undefined
  return formatWantedListLine(entry.name, printing, entry.finish, entry.note).replace(/\n$/, '')
}

/**
 * Render entries as grouped canonical markdown: one `# ${listName}` H1 per
 * list (in first-seen order), `## ${section}` H2 blocks (first-seen order
 * within the list), and each entry's canonical line for its list type — deck
 * quantity lines, collection/wanted `- ` bullet lines — without `&N` ids.
 * Returns without a trailing newline (the writer appends exactly one, like
 * every renderer here).
 */
export function renderMarkdownExport(entries: ExportEntry[]): string {
  const groups = new Map<string, MarkdownListGroup>()
  for (const entry of entries) {
    const key = `${entry.listType}|${entry.listName}`
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { listName: entry.listName, entries: [entry] })
  }
  const listBlocks = [...groups.values()].map((group) => {
    const sections = new Map<string, string[]>()
    for (const entry of group.entries) {
      const lines = sections.get(entry.section)
      if (lines) lines.push(markdownLine(entry))
      else sections.set(entry.section, [markdownLine(entry)])
    }
    const sectionBlocks = [...sections.entries()].map(
      ([section, lines]) => `## ${section}\n${lines.join('\n')}`,
    )
    return `# ${group.listName}\n\n${sectionBlocks.join('\n\n')}`
  })
  return listBlocks.join('\n\n')
}

export type CsvRenderOptions = {
  /** Emit the header row of column labels. */
  header: boolean
  /** Quote every cell instead of only cells that need it. */
  quoteAll: boolean
  /** Value (and header) vocabulary; `ritual` by default. */
  dialect?: ExportDialect
}

/**
 * Render entries as CSV in the selected column order. Missing values are empty
 * cells; set codes are uppercased (user-facing output convention); in the
 * `ritual` dialect an explicit or implicit `nonfoil` finish is written as stored
 * (blank when unmarked) so the export mirrors the markdown data.
 */
export function renderCsvExport(
  entries: ExportEntry[],
  columns: ExportProperty[],
  options: CsvRenderOptions,
): string {
  const dialect = options.dialect ?? 'ritual'
  const rows: string[] = []
  if (options.header) {
    rows.push(
      columns
        .map((column) => csvCell(exportPropertyLabel(column, dialect), options.quoteAll))
        .join(','),
    )
  }
  for (const entry of entries) {
    const cells = columns.map((column) => {
      // Edition uppercases only its set-code half, so it can't reuse the
      // generic whole-value uppercasing the set column gets.
      const value =
        column === 'edition' ? editionValue(entry, true) : propertyValue(entry, column, dialect)
      if (value === undefined) return csvCell('', options.quoteAll)
      const text = column === 'set' ? String(value).toUpperCase() : String(value)
      return csvCell(text, options.quoteAll)
    })
    rows.push(cells.join(','))
  }
  return rows.join('\n')
}
