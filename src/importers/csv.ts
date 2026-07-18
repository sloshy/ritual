import { DEFAULT_SECTION, type Condition, type Finish } from '../types'
import type { ListType } from '../list-type'

/**
 * CSV import support: a validating CSV parser plus the column-mapping and
 * value-normalization logic that turns arbitrary third-party CSV exports
 * (Moxfield, Deckbox, ManaBox, TCGplayer, ...) into Ritual card entries.
 *
 * Everything in this module is pure so it can be unit tested; the file I/O and
 * interactive wizard live in `src/commands/import.ts`.
 */

/** One parsed CSV record, with enough source info to report failures usefully. */
export type CsvRow = {
  cells: string[]
  /** 1-based line number in the source file where this record starts. */
  lineNumber: number
  /** The raw source text of the record (may span lines for quoted fields). */
  raw: string
}

export type CsvParseResult = { rows: CsvRow[] } | { error: string }

/**
 * Parse RFC-4180-style CSV text: comma separators, optional double-quoted
 * fields (with `""` escaping and embedded newlines), LF or CRLF row breaks.
 * Blank lines are skipped. Returns an error for an unterminated quoted field.
 */
export function parseCsv(content: string): CsvParseResult {
  const rows: CsvRow[] = []
  let cells: string[] = []
  let cell = ''
  let raw = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1
  let quoteStartLine = 1

  const endRow = (): void => {
    cells.push(cell)
    // A record that is a single empty cell came from a blank line; skip it.
    if (cells.length > 1 || cells[0]!.trim() !== '') {
      rows.push({ cells, lineNumber: rowStartLine, raw })
    }
    cells = []
    cell = ''
    raw = ''
    rowStartLine = line
  }

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          cell += '"'
          raw += '""'
          i++
        } else {
          inQuotes = false
          raw += ch
        }
      } else {
        if (ch === '\n') line++
        cell += ch
        raw += ch
      }
      continue
    }

    if (ch === '"' && cell === '') {
      inQuotes = true
      quoteStartLine = line
      raw += ch
    } else if (ch === ',') {
      cells.push(cell)
      cell = ''
      raw += ch
    } else if (ch === '\n') {
      line++
      endRow()
    } else if (ch === '\r' && content[i + 1] === '\n') {
      // Consumed with the upcoming \n.
      continue
    } else {
      cell += ch
      raw += ch
    }
  }

  if (inQuotes) {
    return { error: `Unterminated quoted field starting on line ${quoteStartLine}` }
  }
  if (cell !== '' || cells.length > 0 || raw !== '') {
    endRow()
  }

  return { rows }
}

/** The card fields a CSV column can be mapped to, in canonical display order. */
export const CSV_FIELDS = [
  'name',
  'set',
  'collector-number',
  'condition',
  'finish',
  'section',
  'quantity',
] as const
export type CsvField = (typeof CSV_FIELDS)[number]

/** Human-readable labels for each CSV field, shared by the CLI wizard and the admin page. */
export const CSV_FIELD_LABELS: Record<CsvField, string> = {
  name: 'Card name',
  set: 'Set code',
  'collector-number': 'Collector number',
  condition: 'Condition',
  finish: 'Finish',
  section: 'Section',
  quantity: 'Quantity',
}

/**
 * Whether a field must be mapped to a column for the given list type: the card
 * name always, plus the printing (set + collector number) for collections.
 * The single source of the rule that `validateMapping` enforces, shared by the
 * CLI wizard and the admin page so their required markers never drift.
 */
export function isRequiredCsvField(field: CsvField, listType: ListType): boolean {
  return (
    field === 'name' ||
    (listType === 'collection' && (field === 'set' || field === 'collector-number'))
  )
}

/** Maps card fields to 0-based column indexes. Only `name` is always required. */
export type ColumnMapping = {
  name: number
  set?: number
  collectorNumber?: number
  condition?: number
  finish?: number
  section?: number
  quantity?: number
}

/** The `ColumnMapping` property each spec/wizard field name corresponds to. */
export const FIELD_TO_KEY: Record<CsvField, keyof ColumnMapping> = {
  name: 'name',
  set: 'set',
  'collector-number': 'collectorNumber',
  condition: 'condition',
  finish: 'finish',
  section: 'section',
  quantity: 'quantity',
}

/**
 * Validate a column mapping against a list type: collections require a
 * printing (set + collector number), and wanted lists carry no condition.
 * Returns an error message, or null when the mapping is valid.
 */
export function validateMapping(mapping: ColumnMapping, listType: ListType): string | null {
  if (listType === 'collection') {
    if (mapping.set === undefined || mapping.collectorNumber === undefined) {
      return 'Collection imports require both a set and a collector-number column'
    }
  }
  if (listType === 'wanted' && mapping.condition !== undefined) {
    return 'Wanted lists do not track condition; remove the condition column'
  }
  const used = new Map<number, CsvField>()
  for (const field of CSV_FIELDS) {
    const index = mapping[FIELD_TO_KEY[field]]
    if (index === undefined) continue
    const existing = used.get(index)
    if (existing !== undefined) {
      return `Fields '${existing}' and '${field}' are mapped to the same column ${index + 1}`
    }
    used.set(index, field)
  }
  return null
}

/**
 * Parse a `--columns` flag value like `name=1,set=2,collector-number=3` into a
 * column mapping (1-based in the flag, 0-based in the result). Returns an error
 * message string when the spec is malformed or invalid for the list type.
 */
export function parseColumnsSpec(spec: string, listType: ListType): ColumnMapping | string {
  const partial: Partial<ColumnMapping> = {}
  for (const token of spec.split(',')) {
    const trimmed = token.trim()
    if (trimmed === '') continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) return `Invalid column assignment '${trimmed}': expected field=column`
    const field = trimmed.slice(0, eq).trim().toLowerCase()
    const value = trimmed.slice(eq + 1).trim()
    if (!(CSV_FIELDS as readonly string[]).includes(field)) {
      return `Unknown field '${field}'. Valid fields: ${CSV_FIELDS.join(', ')}`
    }
    const key = FIELD_TO_KEY[field as CsvField]
    if (partial[key] !== undefined) return `Field '${field}' is mapped more than once`
    if (!/^\d+$/.test(value) || Number.parseInt(value, 10) < 1) {
      return `Invalid column number '${value}' for field '${field}': expected a 1-based column number`
    }
    partial[key] = Number.parseInt(value, 10) - 1
  }
  if (partial.name === undefined) return `Missing required field 'name' in column mapping`
  const mapping = partial as ColumnMapping
  return validateMapping(mapping, listType) ?? mapping
}

/** Format a column mapping back into the canonical `--columns` flag value (1-based). */
export function formatColumnsSpec(mapping: ColumnMapping): string {
  const parts: string[] = []
  for (const field of CSV_FIELDS) {
    const index = mapping[FIELD_TO_KEY[field]]
    if (index !== undefined) parts.push(`${field}=${index + 1}`)
  }
  return parts.join(',')
}

/** Lowercase and strip spaces, hyphens, and underscores for alias matching. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[\s\-_]+/g, '')
}

/**
 * The result of normalizing one CSV cell: a valid value (`undefined` meaning
 * "not specified" for an empty cell), or an error describing the bad input.
 */
export type NormalizedField<T> = { ok: true; value: T | undefined } | { ok: false; error: string }

const CONDITION_ALIASES: Record<string, Condition> = {
  nm: 'NM',
  n: 'NM',
  m: 'NM',
  mint: 'NM',
  nearmint: 'NM',
  lp: 'LP',
  l: 'LP',
  lightlyplayed: 'LP',
  lightplayed: 'LP',
  slightlyplayed: 'LP',
  sp: 'LP',
  mp: 'MP',
  moderatelyplayed: 'MP',
  played: 'MP',
  pl: 'MP',
  hp: 'HP',
  h: 'HP',
  heavilyplayed: 'HP',
  heavyplayed: 'HP',
  dmg: 'DMG',
  d: 'DMG',
  damaged: 'DMG',
  poor: 'DMG',
}

/**
 * Normalize a condition cell. Matches the canonical codes (NM/LP/MP/HP/DMG),
 * spelled-out names ("Near Mint", "Heavily Played"), and single letters,
 * all case-insensitively. An empty cell means "no condition".
 */
export function normalizeCondition(rawValue: string): NormalizedField<Condition> {
  const key = squash(rawValue)
  if (key === '') return { ok: true, value: undefined }
  const condition = CONDITION_ALIASES[key]
  if (condition === undefined) return { ok: false, error: `Unrecognized condition '${rawValue}'` }
  return { ok: true, value: condition }
}

const FINISH_ALIASES: Record<string, Finish> = {
  foil: 'foil',
  f: 'foil',
  yes: 'foil',
  true: 'foil',
  '1': 'foil',
  etched: 'etched',
  e: 'etched',
  etchedfoil: 'etched',
  foiletched: 'etched',
  nonfoil: 'nonfoil',
  normal: 'nonfoil',
  regular: 'nonfoil',
  no: 'nonfoil',
  false: 'nonfoil',
  '0': 'nonfoil',
}

/**
 * Normalize a finish cell: "F"/"foil" (and truthy flags like "yes") mean foil,
 * "E"/"etched" mean etched, and an empty cell, "non-foil"/"nonfoil", or
 * "normal" all mean non-foil. Case-insensitive. An empty cell normalizes to
 * `undefined`, which serializes identically to an explicit non-foil.
 */
export function normalizeFinish(rawValue: string): NormalizedField<Finish> {
  const key = squash(rawValue)
  if (key === '') return { ok: true, value: undefined }
  const finish = FINISH_ALIASES[key]
  if (finish === undefined) return { ok: false, error: `Unrecognized finish '${rawValue}'` }
  return { ok: true, value: finish }
}

const DECK_SECTION_ALIASES: Record<string, string> = {
  main: 'Main',
  mainboard: 'Main',
  maindeck: 'Main',
  deck: 'Main',
  side: 'Sideboard',
  sideboard: 'Sideboard',
  sb: 'Sideboard',
  maybe: 'Maybeboard',
  maybeboard: 'Maybeboard',
  commander: 'Commander',
  command: 'Commander',
  commandzone: 'Commander',
}

/**
 * Normalize a section cell. Empty cells fall back to the implicit Main
 * section. For decks, common board names ("side", "sideboard", "maybe",
 * "maybeboard", "commander", ...) normalize to the canonical board headers;
 * anything else is kept verbatim as a custom section name.
 */
export function normalizeSection(rawValue: string, listType: ListType): string {
  const trimmed = rawValue.trim()
  if (trimmed === '') return DEFAULT_SECTION
  if (listType === 'deck') {
    const board = DECK_SECTION_ALIASES[squash(trimmed)]
    if (board !== undefined) return board
  }
  return trimmed
}

/**
 * Normalize a quantity cell: a positive integer, tolerating a leading or
 * trailing `x` (`4x`, `x4`). An empty cell means "unspecified" (one copy).
 */
export function normalizeQuantity(rawValue: string): NormalizedField<number> {
  const trimmed = rawValue.trim()
  if (trimmed === '') return { ok: true, value: undefined }
  const digits = trimmed.replace(/^[xX]/, '').replace(/[xX]$/, '')
  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: `Invalid quantity '${rawValue}'` }
  }
  const quantity = Number.parseInt(digits, 10)
  if (quantity < 1)
    return { ok: false, error: `Invalid quantity '${rawValue}': must be at least 1` }
  return { ok: true, value: quantity }
}

/** A card entry produced from one CSV row, normalized but not yet written. */
export type CsvCardEntry = {
  name: string
  quantity: number
  /** Lowercase set code. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  section: string
}

/** A row that could not be imported, with its source location and reason. */
export type CsvRowFailure = {
  lineNumber: number
  raw: string
  reason: string
}

export type CsvConversionResult = {
  entries: CsvCardEntry[]
  failures: CsvRowFailure[]
}

/**
 * Convert parsed CSV rows into card entries using a column mapping. Rows that
 * fail validation are collected as failures (with source line numbers) without
 * aborting the rest of the import.
 */
export function convertCsvRows(
  rows: CsvRow[],
  mapping: ColumnMapping,
  listType: ListType,
): CsvConversionResult {
  const entries: CsvCardEntry[] = []
  const failures: CsvRowFailure[] = []

  for (const row of rows) {
    const cellAt = (index: number | undefined): string =>
      index === undefined ? '' : (row.cells[index] ?? '').trim()

    const problems: string[] = []

    const name = cellAt(mapping.name)
    if (name === '') problems.push('Missing card name')

    const set = cellAt(mapping.set).toLowerCase()
    const collectorNumber = cellAt(mapping.collectorNumber)
    if (listType === 'collection') {
      if (set === '') problems.push('Missing set code (required for collections)')
      if (collectorNumber === '') {
        problems.push('Missing collector number (required for collections)')
      }
    }

    const condition = normalizeCondition(cellAt(mapping.condition))
    if (!condition.ok) problems.push(condition.error)

    const finish = normalizeFinish(cellAt(mapping.finish))
    if (!finish.ok) problems.push(finish.error)

    const quantity = normalizeQuantity(cellAt(mapping.quantity))
    if (!quantity.ok) problems.push(quantity.error)

    // The `ok` checks are implied by `problems.length` but narrow the
    // normalized result types for the success path below.
    if (problems.length > 0 || !condition.ok || !finish.ok || !quantity.ok) {
      failures.push({ lineNumber: row.lineNumber, raw: row.raw, reason: problems.join('; ') })
      continue
    }

    entries.push({
      name,
      quantity: quantity.value ?? 1,
      set: set === '' ? undefined : set,
      collectorNumber: collectorNumber === '' ? undefined : collectorNumber,
      finish: finish.value,
      condition: listType === 'wanted' ? undefined : condition.value,
      section: normalizeSection(cellAt(mapping.section), listType),
    })
  }

  return { entries, failures }
}

const HEADER_ALIASES: Record<string, CsvField> = {
  name: 'name',
  cardname: 'name',
  card: 'name',
  set: 'set',
  setcode: 'set',
  edition: 'set',
  editioncode: 'set',
  collectornumber: 'collector-number',
  cardnumber: 'collector-number',
  number: 'collector-number',
  no: 'collector-number',
  cn: 'collector-number',
  condition: 'condition',
  finish: 'finish',
  foil: 'finish',
  printing: 'finish',
  section: 'section',
  board: 'section',
  category: 'section',
  quantity: 'quantity',
  count: 'quantity',
  qty: 'quantity',
  amount: 'quantity',
}

/**
 * Guess whether the first CSV row is a header by checking its cells against
 * known column-header names.
 */
export function guessHasHeader(firstRowCells: string[]): boolean {
  return firstRowCells.some((cell) => HEADER_ALIASES[squash(cell)] !== undefined)
}

/**
 * Guess a column mapping from header cells. Used only to pre-select wizard
 * defaults; the user always confirms. The first matching column wins per field.
 */
export function guessColumns(headerCells: string[]): Partial<ColumnMapping> {
  const guessed: Partial<ColumnMapping> = {}
  headerCells.forEach((cell, index) => {
    const field = HEADER_ALIASES[squash(cell)]
    if (field === undefined) return
    const key = FIELD_TO_KEY[field]
    if (guessed[key] === undefined) guessed[key] = index
  })
  return guessed
}
