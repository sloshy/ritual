import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { ask } from './prompts-helpers'
import { type Card, type DeckData, type DeckSection } from '../types'
import { isListType, LIST_TYPES, type ListType } from '../list-type'
import {
  DECK_FORMAT_KEYS,
  getDeckFormatLabel,
  normalizeFormatKey,
  type DeckFormatKey,
} from '../deck-format'
import {
  CSV_FIELDS,
  FIELD_TO_KEY,
  convertCsvRows,
  formatColumnsSpec,
  guessColumns,
  guessHasHeader,
  parseColumnsSpec,
  parseCsv,
  validateMapping,
  type ColumnMapping,
  type CsvCardEntry,
  type CsvField,
  type CsvRow,
  type CsvRowFailure,
} from '../importers/csv'
import { serializeDeckToMarkdown } from '../deck-file'
import { formatCollectionLine, formatWantedListLine } from '../card-line'
import { serializeSectionedList } from '../section-format'
import { allocateId, createIdPool } from '../card-id'
import { writeFileWithHash } from '../content-hash'
import { dirForType } from '../resolve-list'
import { sanitizeDeckFileName } from '../utils'
import { ExitCode } from './scripting'
import { getLogger } from '../logger'

type ImportCsvCommandOptions = {
  type?: string
  name?: string
  format?: string
  columns?: string
  /** Commander sets this to false for --no-header; defaults to true. */
  header: boolean
  overwrite?: boolean
  nonInteractive?: boolean
}

/** The fields shared by every CSV import plan, whatever the list type. */
type CsvImportPlanBase = {
  /** The list's display name (H1 / frontmatter name), also used for the filename. */
  name: string
  entries: CsvCardEntry[]
  targetDir: string
  overwrite: boolean
}

export type DeckCsvImportPlan = CsvImportPlanBase & {
  listType: 'deck'
  format: DeckFormatKey
}

export type FlatCsvImportPlan = CsvImportPlanBase & {
  listType: 'collection' | 'wanted'
}

/** Everything needed to write an import to disk, resolved from flags or the wizard. */
export type CsvImportPlan = DeckCsvImportPlan | FlatCsvImportPlan

export type CsvImportResult = { filePath: string; cardCount: number } | { error: string }

const FIELD_LABELS: Record<CsvField, string> = {
  name: 'Card name',
  set: 'Set code',
  'collector-number': 'Collector number',
  condition: 'Condition',
  finish: 'Finish',
  section: 'Section',
  quantity: 'Quantity',
}

function buildDeckMarkdown(name: string, format: DeckFormatKey, entries: CsvCardEntry[]): string {
  const sectionsByName = new Map<string, Card[]>()
  for (const entry of entries) {
    const card: Card = {
      quantity: entry.quantity,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
    }
    const cards = sectionsByName.get(entry.section)
    if (cards) cards.push(card)
    else sectionsByName.set(entry.section, [card])
  }
  const sections: DeckSection[] = [...sectionsByName.entries()].map(([sectionName, cards]) => ({
    name: sectionName,
    cards,
  }))
  const deck: DeckData = { name, format, sections }
  return serializeDeckToMarkdown(deck, {
    name,
    format,
    created: new Date().toISOString(),
    tags: [],
  })
}

type FlatCopy = CsvCardEntry & { cardId: number }

function buildFlatListMarkdown(
  listType: 'collection' | 'wanted',
  name: string,
  entries: CsvCardEntry[],
): string {
  const pool = createIdPool([])
  const copies: FlatCopy[] = []
  const sectionOrder: string[] = []
  for (const entry of entries) {
    if (!sectionOrder.includes(entry.section)) sectionOrder.push(entry.section)
    for (let i = 0; i < entry.quantity; i++) {
      copies.push({ ...entry, quantity: 1, cardId: allocateId(pool) })
    }
  }
  const formatLine =
    listType === 'collection'
      ? (copy: FlatCopy): string =>
          formatCollectionLine(
            copy.name,
            copy.set ?? '',
            copy.collectorNumber ?? '',
            copy.finish ?? 'nonfoil',
            copy.condition,
            undefined,
            copy.cardId,
          )
      : (copy: FlatCopy): string =>
          formatWantedListLine(
            copy.name,
            copy.set && copy.collectorNumber
              ? { set: copy.set, collectorNumber: copy.collectorNumber }
              : undefined,
            copy.finish,
            undefined,
            copy.cardId,
          )
  return serializeSectionedList(name, copies, sectionOrder, formatLine)
}

/**
 * Write a resolved CSV import to disk as a new list file. Refuses to replace
 * an existing file unless `overwrite` is set. Returns the written path and
 * total card count (copies, not rows), or an error message.
 */
export async function writeCsvImport(plan: CsvImportPlan): Promise<CsvImportResult> {
  const safeName = sanitizeDeckFileName(plan.name)
  if (safeName === '') {
    return { error: `List name '${plan.name}' contains no usable filename characters` }
  }
  const filePath = path.join(plan.targetDir, `${safeName}.md`)

  if (!plan.overwrite && (await Bun.file(filePath).exists())) {
    return {
      error: `File already exists: ${filePath}. Re-run with --overwrite to replace it.`,
    }
  }

  const content =
    plan.listType === 'deck'
      ? buildDeckMarkdown(plan.name, plan.format, plan.entries)
      : buildFlatListMarkdown(plan.listType, plan.name, plan.entries)

  await fs.mkdir(plan.targetDir, { recursive: true })
  await writeFileWithHash(filePath, content)

  const cardCount = plan.entries.reduce((sum, entry) => sum + entry.quantity, 0)
  return { filePath, cardCount }
}

/** Quote a value for the echoed scripting command when it needs it. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Build the non-interactive command equivalent to the wizard's answers, so the
 * same import can be scripted without the setup wizard.
 */
export function formatScriptingCommand(
  file: string,
  listType: ListType,
  name: string,
  format: DeckFormatKey | undefined,
  mapping: ColumnMapping,
  hasHeader: boolean,
): string {
  const parts = [
    'ritual',
    'import-csv',
    shellQuote(file),
    '--type',
    listType,
    '--name',
    shellQuote(name),
  ]
  if (format !== undefined) parts.push('--format', format)
  parts.push('--columns', shellQuote(formatColumnsSpec(mapping)))
  if (!hasHeader) parts.push('--no-header')
  return parts.join(' ')
}

type ColumnChoice = { title: string; value: number }

function buildColumnChoices(
  headerCells: string[] | null,
  sampleCells: string[],
  columnCount: number,
  usedColumns: Set<number>,
  optional: boolean,
): ColumnChoice[] {
  const choices: ColumnChoice[] = []
  if (optional) choices.push({ title: '(not in this file)', value: -1 })
  for (let i = 0; i < columnCount; i++) {
    if (usedColumns.has(i)) continue
    const header = headerCells?.[i]
    const sample = sampleCells[i]
    let title =
      header !== undefined && header !== '' ? `Column ${i + 1}: "${header}"` : `Column ${i + 1}`
    if (sample !== undefined && sample !== '') title += ` — e.g. "${sample}"`
    choices.push({ title, value: i })
  }
  return choices
}

type WizardMappingResult = { mapping: ColumnMapping; cancelled: false } | { cancelled: true }

/** Interactively map CSV columns to card fields. */
async function promptColumnMapping(
  listType: ListType,
  rows: CsvRow[],
  hasHeader: boolean,
): Promise<WizardMappingResult> {
  if (rows.length === 0) return { cancelled: true }
  const headerCells = hasHeader ? (rows[0]?.cells ?? null) : null
  const sampleCells = (hasHeader ? rows[1]?.cells : rows[0]?.cells) ?? []
  const columnCount = Math.max(...rows.map((row) => row.cells.length))
  const guessed = headerCells ? guessColumns(headerCells) : {}

  const mapping: Partial<ColumnMapping> = {}
  const usedColumns = new Set<number>()

  for (const field of CSV_FIELDS) {
    if (field === 'condition' && listType === 'wanted') continue
    const required =
      field === 'name' ||
      (listType === 'collection' && (field === 'set' || field === 'collector-number'))
    const choices = buildColumnChoices(
      headerCells,
      sampleCells,
      columnCount,
      usedColumns,
      !required,
    )
    const guessedIndex = guessed[FIELD_TO_KEY[field]]
    const initial =
      guessedIndex === undefined ? 0 : choices.findIndex((c) => c.value === guessedIndex)
    const selection = await ask<number>({
      type: 'select',
      message: `Which column holds: ${FIELD_LABELS[field]}?${required ? '' : ' (optional)'}`,
      choices,
      initial: initial === -1 ? 0 : initial,
    })
    if (selection === undefined) return { cancelled: true }
    if (selection === -1) continue
    mapping[FIELD_TO_KEY[field]] = selection
    usedColumns.add(selection)
  }

  return { mapping: mapping as ColumnMapping, cancelled: false }
}

function reportFailures(failures: CsvRowFailure[]): void {
  const logger = getLogger()
  logger.error(`${failures.length} row(s) failed to import:`)
  for (const failure of failures) {
    logger.error(`  Line ${failure.lineNumber}: ${failure.raw}`)
    logger.error(`    ${failure.reason}`)
  }
}

export function registerImportCsvCommand(program: Command): void {
  program
    .command('import-csv')
    .description('Import cards from a CSV file into a new deck, collection, or wanted list')
    .argument('<file>', 'Path to the CSV file')
    .option('-t, --type <type>', 'List type to create: deck, collection, or wanted')
    .option('-n, --name <name>', 'Name for the new list')
    .option('-f, --format <format>', 'Deck format (deck imports only, e.g. commander, modern)')
    .option(
      '-c, --columns <mapping>',
      `Column mapping like 'name=1,set=2,collector-number=3' (1-based; fields: ${CSV_FIELDS.join(', ')}). Skips the interactive setup wizard.`,
    )
    .option('--no-header', 'Treat the first row as data instead of a header row')
    .option('-o, --overwrite', 'Overwrite an existing list file with the same name')
    .option('--non-interactive', 'Disable interactive prompts; fail when input is required')
    .action(async (file: string, options: ImportCsvCommandOptions) => {
      const logger = getLogger()

      let content: string
      try {
        content = await fs.readFile(file, 'utf-8')
      } catch {
        logger.error(`Could not read CSV file: ${file}`)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const parsed = parseCsv(content)
      if ('error' in parsed) {
        logger.error(`Failed to parse CSV: ${parsed.error}`)
        process.exitCode = ExitCode.RuntimeError
        return
      }
      if (parsed.rows.length === 0) {
        logger.error('CSV file contains no rows')
        process.exitCode = ExitCode.RuntimeError
        return
      }

      // Resolve list type, name, and format from flags first; the wizard only
      // asks for whatever is missing.
      let listType: ListType | undefined
      if (options.type !== undefined) {
        const normalized = options.type.toLowerCase()
        if (!isListType(normalized)) {
          logger.error(`Invalid list type '${options.type}'. Use: ${LIST_TYPES.join(', ')}`)
          process.exitCode = ExitCode.UsageError
          return
        }
        listType = normalized
      }

      let name = options.name?.trim()
      if (name === '') {
        logger.error('List name cannot be empty')
        process.exitCode = ExitCode.UsageError
        return
      }

      let format: DeckFormatKey | undefined
      if (options.format !== undefined) {
        const normalized = normalizeFormatKey(options.format)
        if (normalized === null) {
          logger.error(
            `Invalid deck format '${options.format}'. Valid formats: ${DECK_FORMAT_KEYS.join(', ')}`,
          )
          process.exitCode = ExitCode.UsageError
          return
        }
        format = normalized
      }

      const nonInteractive = options.nonInteractive === true
      const needsWizard =
        listType === undefined ||
        name === undefined ||
        options.columns === undefined ||
        (listType === 'deck' && format === undefined)

      if (nonInteractive && needsWizard) {
        const missing: string[] = []
        if (listType === undefined) missing.push('--type')
        if (name === undefined) missing.push('--name')
        if (options.columns === undefined) missing.push('--columns')
        if (listType === 'deck' && format === undefined) missing.push('--format')
        logger.error(`Missing required flags for non-interactive import: ${missing.join(', ')}`)
        process.exitCode = ExitCode.UsageError
        return
      }

      const cancelled = (): void => {
        logger.info('Import cancelled.')
      }

      if (listType === undefined) {
        const picked = await ask<ListType>({
          type: 'select',
          message: 'What kind of list is this?',
          choices: LIST_TYPES.map((type) => ({ title: type, value: type })),
        })
        if (picked === undefined) return cancelled()
        listType = picked
      }

      if (format !== undefined && listType !== 'deck') {
        logger.error('--format only applies to deck imports')
        process.exitCode = ExitCode.UsageError
        return
      }

      if (name === undefined) {
        const picked = await ask<string>({
          type: 'text',
          message: `Name for the new ${listType === 'wanted' ? 'wanted list' : listType}:`,
          validate: (value: string) => (value.trim().length > 0 ? true : 'Name cannot be empty'),
        })
        if (picked === undefined) return cancelled()
        name = picked.trim()
      }

      if (listType === 'deck' && format === undefined) {
        const picked = await ask<DeckFormatKey>({
          type: 'select',
          message: 'Deck format:',
          choices: DECK_FORMAT_KEYS.map((key) => ({ title: getDeckFormatLabel(key), value: key })),
        })
        if (picked === undefined) return cancelled()
        format = picked
      }

      // Column mapping: from the --columns flag when given, otherwise the wizard.
      let hasHeader = options.header
      let mapping: ColumnMapping
      let wizardRan = false
      if (options.columns !== undefined) {
        const result = parseColumnsSpec(options.columns, listType)
        if (typeof result === 'string') {
          logger.error(result)
          process.exitCode = ExitCode.UsageError
          return
        }
        mapping = result
      } else {
        wizardRan = true
        const firstRow = parsed.rows[0]!
        const headerAnswer = await ask<boolean>({
          type: 'confirm',
          message: 'Does the first row contain column headers?',
          initial: guessHasHeader(firstRow.cells),
        })
        if (headerAnswer === undefined) return cancelled()
        hasHeader = headerAnswer

        if (hasHeader && parsed.rows.length < 2) {
          logger.error('CSV file contains a header row but no data rows')
          process.exitCode = ExitCode.RuntimeError
          return
        }

        const wizardResult = await promptColumnMapping(listType, parsed.rows, hasHeader)
        if (wizardResult.cancelled) return cancelled()
        mapping = wizardResult.mapping
      }

      const mappingError = validateMapping(mapping, listType)
      if (mappingError !== null) {
        logger.error(mappingError)
        process.exitCode = ExitCode.UsageError
        return
      }

      if (wizardRan) {
        logger.info('\nTo repeat this import without the setup wizard, run:')
        logger.info(
          `  ${formatScriptingCommand(file, listType, name, format, mapping, hasHeader)}\n`,
        )
      }

      const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
      if (dataRows.length === 0) {
        logger.error('CSV file contains no data rows')
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const { entries, failures } = convertCsvRows(dataRows, mapping, listType)
      if (entries.length === 0) {
        logger.error('No rows could be imported.')
        reportFailures(failures)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const targetDir = dirForType(listType)
      let overwrite = options.overwrite === true

      if (!overwrite) {
        const safeName = sanitizeDeckFileName(name)
        const targetPath = path.join(targetDir, `${safeName}.md`)
        if (safeName !== '' && (await Bun.file(targetPath).exists())) {
          if (nonInteractive || options.columns !== undefined) {
            logger.error(
              `File already exists: ${targetPath}. Re-run with --overwrite to replace it.`,
            )
            process.exitCode = ExitCode.RuntimeError
            return
          }
          const confirmed = await ask<boolean>({
            type: 'confirm',
            message: `'${path.basename(targetPath)}' already exists. Overwrite it?`,
            initial: false,
          })
          if (confirmed !== true) return cancelled()
          overwrite = true
        }
      }

      // The wizard/flag validation above guarantees a format whenever the list
      // type is a deck, but the type system can't see across those branches.
      let plan: CsvImportPlan
      if (listType === 'deck') {
        if (format === undefined) {
          logger.error('Deck imports require a format')
          process.exitCode = ExitCode.UsageError
          return
        }
        plan = { listType, name, format, entries, targetDir, overwrite }
      } else {
        plan = { listType, name, entries, targetDir, overwrite }
      }

      const result = await writeCsvImport(plan)
      if ('error' in result) {
        logger.error(result.error)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      logger.info(
        `Imported ${result.cardCount} card(s) into ${listType} '${name}': ${result.filePath}`,
      )
      if (failures.length > 0) {
        reportFailures(failures)
        process.exitCode = ExitCode.RuntimeError
      }
    })
}
