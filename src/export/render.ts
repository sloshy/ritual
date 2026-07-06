import { csvCell } from '../csv'
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
  'finish',
  'isFoil',
  'condition',
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
  finish: 'Finish',
  isFoil: 'Is Foil',
  condition: 'Condition',
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
  isFoil: 'true when foil or etched',
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
 * renderer uppercases them at the output boundary.
 */
function propertyValue(
  entry: ExportEntry,
  property: ExportProperty,
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
    case 'finish':
      return entry.finish
    case 'isFoil':
      return entry.finish === 'foil' || entry.finish === 'etched'
    case 'condition':
      return entry.condition
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
 * a data format, matching the internal convention).
 */
export function renderJsonExport(entries: ExportEntry[], columns: ExportProperty[]): string {
  const records = entries.map((entry): ExportRecord => {
    const record: ExportRecord = {}
    for (const column of columns) {
      const value = propertyValue(entry, column)
      if (value !== undefined) record[column] = value
    }
    return record
  })
  return JSON.stringify(records, null, 2)
}

export type CsvRenderOptions = {
  /** Emit the header row of column labels. */
  header: boolean
  /** Quote every cell instead of only cells that need it. */
  quoteAll: boolean
}

/**
 * Render entries as CSV in the selected column order. Missing values are empty
 * cells; set codes are uppercased (user-facing output convention); an explicit
 * or implicit `nonfoil` finish is written as stored (blank when unmarked) so
 * the export mirrors the markdown data.
 */
export function renderCsvExport(
  entries: ExportEntry[],
  columns: ExportProperty[],
  options: CsvRenderOptions,
): string {
  const rows: string[] = []
  if (options.header) {
    rows.push(
      columns.map((column) => csvCell(EXPORT_PROPERTY_LABELS[column], options.quoteAll)).join(','),
    )
  }
  for (const entry of entries) {
    const cells = columns.map((column) => {
      // Edition uppercases only its set-code half, so it can't reuse the
      // generic whole-value uppercasing the set column gets.
      const value = column === 'edition' ? editionValue(entry, true) : propertyValue(entry, column)
      if (value === undefined) return csvCell('', options.quoteAll)
      const text = column === 'set' ? String(value).toUpperCase() : String(value)
      return csvCell(text, options.quoteAll)
    })
    rows.push(cells.join(','))
  }
  return rows.join('\n')
}
