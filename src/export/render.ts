import { csvCell } from '../changes/csv'
import { aggregateQuantities, printingSuffix, variantKey } from '../card/card-line'
import { canonicalCardLine } from '../list/deck-text'
import {
  aggregateDialectCards,
  isDecklistSection,
  renderDialectText,
  type SectionedDialectCard,
} from './dialects'
import { storedLanguage } from '../card/card-language'
import { formatCardTags } from '../card/card-tags'
import {
  archidektCsvCondition,
  archidektCsvLanguage,
  archidektModifier,
} from '../importers/archidekt-collection'
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
  'language',
  'labels',
  'tags',
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
  language: 'Language',
  labels: 'Labels',
  tags: 'Tags',
  note: 'Note',
  section: 'Section',
  listName: 'List',
  listType: 'List Type',
}

/**
 * The vocabulary an export is written in. `ritual` (the default) writes Ritual's
 * own spellings — the file format's values, unchanged. A non-default dialect
 * writes another tool's spellings for the same properties, so an export can be
 * fed straight into that tool's importer without a translation step.
 *
 * Which half of the export a dialect reaches depends on the format:
 *
 * - `csv` / `json` — a dialect changes **values** (and one header label). Only
 *   `ritual` and `archidekt` say anything different here; `arena` and
 *   `moxfield` publish no column vocabulary, so they render as `ritual` does.
 * - `text` — a dialect chooses the **line and board form** ({@link renderTextExport}).
 *   `arena` and `moxfield` write the bulletless decklist their sites import
 *   (`src/export/dialects.ts`), which is a decklist and so carries no
 *   maybeboard or token cards; `ritual` and `archidekt` write Ritual's own
 *   `(SET:CN)` line, since Archidekt's importer has no plain-text dialect of
 *   its own — its lane is the `archidekt` CSV preset.
 * - `md` — always Ritual's canonical markdown; a dialect would make it a
 *   different file format, not a different spelling.
 *
 * `archidekt` differs from `ritual` in exactly four ways, all in
 * {@link propertyValue} / {@link exportPropertyLabel}:
 *
 * - `finish` renders Archidekt's modifier (`Normal` / `Foil` / `Etched`) and is
 *   labelled `Variant`, the name Archidekt's own CSV importer uses.
 * - `condition` renders Archidekt's CSV short codes, where Damaged is `D`.
 * - `language` renders Archidekt's CSV language codes (`EN CT DE FR IT JP KR PT
 *   RU CS SP`); a language Archidekt has no code for renders `EN`, matching how
 *   a push's record API degrades it.
 * - All three render the *effective* value when a line marks none (`Normal` /
 *   `NM` / `EN`): Archidekt's CSV has no "unmarked" spelling, so an empty cell
 *   would be a row Archidekt has to guess about.
 */
export type ExportDialect = 'ritual' | 'archidekt' | 'arena' | 'moxfield'

export const EXPORT_DIALECTS = [
  'ritual',
  'archidekt',
  'arena',
  'moxfield',
] as const satisfies readonly ExportDialect[]

export function isExportDialect(value: string): value is ExportDialect {
  return (EXPORT_DIALECTS as readonly string[]).includes(value)
}

/** Labels a dialect spells differently from {@link EXPORT_PROPERTY_LABELS}. */
const DIALECT_PROPERTY_LABELS: Record<ExportDialect, Partial<Record<ExportProperty, string>>> = {
  ritual: {},
  archidekt: { finish: 'Variant' },
  // Text dialects: they shape decklist lines, not columns, so a csv/json export
  // in one of them keeps Ritual's own headers.
  arena: {},
  moxfield: {},
}

/** A property's header/picker label in a dialect. */
export function exportPropertyLabel(
  property: ExportProperty,
  dialect: ExportDialect = 'ritual',
): string {
  return DIALECT_PROPERTY_LABELS[dialect][property] ?? EXPORT_PROPERTY_LABELS[property]
}

/** Default column set and order, matching the site's fixed CSV export columns. */
export const DEFAULT_EXPORT_COLUMNS: ExportProperty[] = [
  'name',
  'set',
  'collectorNumber',
  'finish',
  'condition',
  'language',
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
    case 'language':
      // Archidekt's CSV code (effective — `EN` for a bare line, and for the
      // languages Archidekt cannot model); otherwise blank for English,
      // mirroring the markdown token: a bare line means `en`.
      if (dialect === 'archidekt') return archidektCsvLanguage(entry.language) ?? 'EN'
      return storedLanguage(entry.language)
    case 'labels':
      // Same spelling in every dialect — labels are Ritual-specific, so no
      // foreign importer defines a vocabulary to translate into.
      return entry.labels?.length ? entry.labels.join(', ') : undefined
    case 'tags':
      // Canonical order, comma-joined, and never the `#` sigil: the sigil is
      // card-line punctuation, not part of the value — the same rule the
      // change-bundle payload and the admin API follow. Ritual-specific like
      // labels, so every dialect spells it the same way.
      return entry.tags?.length ? formatCardTags(entry.tags) : undefined
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

/** A rendered decklist plus anything the caller should tell the user about it. */
export type RenderedText = {
  /** The decklist; no trailing newline (the writer appends one). */
  content: string
  /**
   * Plain-English warnings. English by construction: `src/export/**` is inside
   * the i18n persistence fence (AGENTS.md, "Localization") and must never
   * import `src/i18n`.
   */
  warnings: string[]
}

/**
 * The warning a dialect export raises when the selection reached cards a
 * decklist has no place for: a maybeboard or a token section. The user asked
 * for those cards by name, so dropping them silently would be a lie about what
 * the file contains — but writing them would be a lie about the deck.
 */
function omittedExtrasWarning(entries: readonly ExportEntry[]): string[] {
  const sections = new Map<string, number>()
  for (const entry of entries) {
    if (isDecklistSection(entry.section)) continue
    sections.set(entry.section, (sections.get(entry.section) ?? 0) + entry.quantity)
  }
  if (sections.size === 0) return []
  // Counts are written per section as `Name (n)` rather than as a summed "n
  // cards from m sections": it says strictly more, and it needs no plural
  // morphology — which this module could not localize anyway, being inside the
  // persistence fence.
  const named = [...sections].map(([section, quantity]) => `${section} (${quantity})`).join(', ')
  return [
    `Omitted cards a decklist has no board for: ${named}. ` +
      'Maybeboard and token sections are deck-building extras rather than part of a decklist, ' +
      'so neither Arena nor Moxfield writes them.',
  ]
}

/**
 * Render entries as a plain-text decklist, in the dialect's line form.
 *
 * Either way, identical variants are aggregated first: one line per distinct
 * variant (finish, condition and language distinguish variants even where the
 * line prints none of them), with quantities summed across sections and lists,
 * in first-seen entry order.
 *
 * `ritual` (and `archidekt`, which publishes no plain-text dialect) writes ONE
 * flat list of `${qty} ${name} (SET:CN)` lines with no headers or sections —
 * Ritual's own printing form, bulletless because this is a decklist for
 * pasting, not a list file. It is not a decklist for another site's importer,
 * so it carries every entry it was given, maybeboard and tokens included.
 *
 * `arena` and `moxfield` write their sites' importable form instead: bare board
 * markers over `${qty} ${name} (SET) CN` lines, `moxfield` splicing its `*F*` /
 * `*E*` finish marker between the set and the collector number. The printing is
 * omitted for entries without a pinned one; set codes are uppercased
 * (user-facing output). Maybeboard and token entries are **not** written — a
 * decklist has no board for them — and are reported in `warnings` instead.
 */
export function renderTextExport(
  entries: ExportEntry[],
  dialect: ExportDialect = 'ritual',
): RenderedText {
  const textDialect = dialect === 'arena' || dialect === 'moxfield' ? dialect : undefined
  if (textDialect === undefined) {
    const content = aggregateQuantities(
      entries,
      (entry) =>
        variantKey(
          entry.name,
          entry.set,
          entry.collectorNumber,
          entry.finish,
          entry.condition,
          entry.language,
        ),
      (entry) => entry.quantity,
    )
      .map(
        ({ entry, quantity }) =>
          `${quantity} ${entry.name}${printingSuffix(entry.set, entry.collectorNumber)}`,
      )
      .join('\n')
    return { content, warnings: [] }
  }
  // Boards partition the dialect's aggregation (`aggregateDialectCards`): two
  // copies of a card in different boards are two lines, exactly as they are two
  // lines in the deck they came from.
  const cards = entries.map(
    (entry): SectionedDialectCard => ({
      section: entry.section,
      quantity: entry.quantity,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      language: entry.language,
    }),
  )
  return {
    content: renderDialectText(aggregateDialectCards(cards), textDialect),
    warnings: omittedExtrasWarning(entries),
  }
}

/** One list's group of entries for the markdown export, in first-seen order. */
type MarkdownListGroup = { listName: string; entries: ExportEntry[] }

/**
 * The canonical markdown line for one entry, per its list type, without a `&N`
 * id (ExportEntry deliberately carries none) and — for decks — without labels:
 * `ExportEntry.labels` are *effective* labels and can hold collection-only
 * vocabulary a deck line could not re-parse.
 */
function markdownLine(entry: ExportEntry): string {
  const labels = entry.listType === 'deck' ? undefined : entry.labels
  return canonicalCardLine(entry.listType, { ...entry, labels, cardId: undefined })
}

/**
 * Render entries as grouped canonical markdown: one `# ${listName}` H1 per
 * list (in first-seen order), `## ${section}` H2 blocks (first-seen order
 * within the list), and each entry's canonical line for its list type — every
 * one a `- ` bullet, decks carrying their quantity — without `&N` ids.
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
