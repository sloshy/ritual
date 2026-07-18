import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { ask, promptListType } from './prompts-helpers'
import { isListType, listTypeLabel, LIST_TYPES, type ListType } from '../list-type'
import {
  DECK_FORMAT_KEYS,
  getDeckFormatLabel,
  invalidDeckFormatMessage,
  parseDeckFormat,
  type DeckFormatKey,
} from '../deck-format'
import {
  CSV_FIELDS,
  CSV_FIELD_LABELS,
  FIELD_TO_KEY,
  convertCsvRows,
  formatColumnsSpec,
  guessColumns,
  guessHasHeader,
  isRequiredCsvField,
  parseColumnsSpec,
  parseCsv,
  validateMapping,
  type ColumnMapping,
  type CsvRow,
  type CsvRowFailure,
} from '../importers/csv'
import { applyCsvImport, type CsvImportMode } from '../importers/csv-apply'
import { listFilePath } from '../resolve-list'

import {
  addScriptingOptions,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type OutputFormat,
} from './scripting'
import { getLogger } from '../logger'
import { isNoInput } from '../no-input'

type ImportCsvCommandOptions = {
  type?: string
  name?: string
  format?: string
  columns?: string
  /** Commander sets this to false for --no-header; defaults to true. */
  header: boolean
  overwrite?: boolean
  append?: boolean
  output: OutputFormat
  quiet: boolean
}

/** One failed CSV row in the `--output json`/`ndjson` result. */
type ImportCsvFailureOutput = { line: number; reason: string }

/** Success payload for `--output json`/`ndjson` (also emitted on partial failure). */
type ImportCsvJsonResult = {
  imported: number
  failed: number
  failures: ImportCsvFailureOutput[]
  filePath: string
  mode: CsvImportMode
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
  mode: CsvImportMode,
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
  if (mode === 'overwrite') parts.push('--overwrite')
  if (mode === 'append') parts.push('--append')
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
    const required = isRequiredCsvField(field, listType)
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
      message: `Which column holds: ${CSV_FIELD_LABELS[field]}?${required ? '' : ' (optional)'}`,
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

/** Map an engine row failure onto the JSON output shape. */
function toFailureOutput(failure: CsvRowFailure): ImportCsvFailureOutput {
  return { line: failure.lineNumber, reason: failure.reason }
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
  addScriptingOptions(
    program
      .command('import-csv')
      .description('Import cards from a CSV file into a deck, collection, or wanted list')
      .argument('<file>', 'Path to the CSV file')
      .option('-t, --type <type>', 'List type to import into: deck, collection, or wanted')
      .option('--name <name>', 'Name of the list to create or append to')
      .option('-f, --format <format>', 'Deck format when creating a deck (e.g. commander, modern)')
      .option(
        '-c, --columns <mapping>',
        `Column mapping like 'name=1,set=2,collector-number=3' (1-based; fields: ${CSV_FIELDS.join(', ')}). Skips the interactive setup wizard.`,
      )
      .option('--no-header', 'Treat the first row as data instead of a header row')
      .option('-o, --overwrite', 'Replace an existing list file with the same name')
      .option('-a, --append', 'Append the cards to an existing list instead of creating a new one'),
  ).action(async (file: string, options: ImportCsvCommandOptions) => {
    const logger = getLogger()
    const scripting = normalizeScriptingOptions(options)

    if (options.overwrite === true && options.append === true) {
      emitError('usage_error', '--overwrite and --append are mutually exclusive', scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch (error) {
      const failure = classifyFileReadError(error)
      emitError(failure.errorCode, `Could not read CSV file: ${file}`, scripting)
      process.exitCode = failure.exitCode
      return
    }

    const parsed = parseCsv(content)
    if ('error' in parsed) {
      emitError('runtime_error', `Failed to parse CSV: ${parsed.error}`, scripting)
      process.exitCode = ExitCode.RuntimeError
      return
    }
    if (parsed.rows.length === 0) {
      emitError('runtime_error', 'CSV file contains no rows', scripting)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    // Resolve list type, name, mode, and format from flags first; the wizard
    // only asks for whatever is missing.
    let listType: ListType | undefined
    if (options.type !== undefined) {
      const normalized = options.type.toLowerCase()
      if (!isListType(normalized)) {
        emitError(
          'usage_error',
          `Invalid list type '${options.type}'. Use: ${LIST_TYPES.join(', ')}`,
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      listType = normalized
    }

    let name = options.name?.trim()
    if (name === '') {
      emitError('usage_error', 'List name cannot be empty', scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    let format: DeckFormatKey | undefined
    if (options.format !== undefined) {
      const normalized = parseDeckFormat(options.format)
      if (normalized === null) {
        emitError('usage_error', invalidDeckFormatMessage(options.format), scripting)
        process.exitCode = ExitCode.UsageError
        return
      }
      format = normalized
    }

    // Prompts are unavailable when they are disabled (--no-input), when stdin
    // is not a terminal, or when --columns says the user is scripting.
    const scripted = isNoInput() || !process.stdin.isTTY || options.columns !== undefined
    const flagMode: CsvImportMode | undefined =
      options.append === true ? 'append' : options.overwrite === true ? 'overwrite' : undefined

    if (scripted) {
      const missing: string[] = []
      if (listType === undefined) missing.push('--type')
      if (name === undefined) missing.push('--name')
      if (options.columns === undefined) missing.push('--columns')
      if (listType === 'deck' && flagMode !== 'append' && format === undefined) {
        missing.push('--format')
      }
      if (missing.length > 0) {
        emitError(
          'usage_error',
          `Missing required flags for a scripted import (prompts are unavailable): ${missing.join(', ')}`,
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
    }

    const cancelled = (): void => {
      logger.info('Import cancelled.')
    }

    if (listType === undefined) {
      const picked = await promptListType()
      if (picked === undefined) return cancelled()
      listType = picked
    }

    if (format !== undefined && listType !== 'deck') {
      emitError('usage_error', '--format only applies to deck imports', scripting)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (format !== undefined && flagMode === 'append') {
      emitError(
        'usage_error',
        '--format only applies when creating a deck, not when appending',
        scripting,
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    if (name === undefined) {
      const picked = await ask<string>({
        type: 'text',
        message: `Name of the ${listTypeLabel(listType)} to create or append to:`,
        validate: (value: string) => (value.trim().length > 0 ? true : 'Name cannot be empty'),
      })
      if (picked === undefined) return cancelled()
      name = picked.trim()
    }

    // Resolve the import mode: explicit flags win; otherwise an existing file
    // of the same name prompts append / overwrite / cancel.
    let mode: CsvImportMode
    if (flagMode !== undefined) {
      mode = flagMode
    } else {
      const targetPath = listFilePath(listType, name)
      const exists = targetPath !== null && (await Bun.file(targetPath).exists())
      if (!exists) {
        mode = 'create'
      } else if (scripted) {
        emitError(
          'runtime_error',
          `File already exists: ${targetPath}. Re-run with --append to add to it or --overwrite to replace it.`,
          scripting,
        )
        process.exitCode = ExitCode.RuntimeError
        return
      } else {
        const picked = await ask<CsvImportMode | 'cancel'>({
          type: 'select',
          message: `'${path.basename(targetPath)}' already exists. What should happen?`,
          choices: [
            { title: 'Append the cards to it', value: 'append' },
            { title: 'Overwrite it with the import', value: 'overwrite' },
            { title: 'Cancel', value: 'cancel' },
          ],
        })
        if (picked === undefined || picked === 'cancel') return cancelled()
        mode = picked
      }
    }

    if (listType === 'deck' && mode !== 'append' && format === undefined) {
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
        emitError('usage_error', result, scripting)
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
        emitError('runtime_error', 'CSV file contains a header row but no data rows', scripting)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const wizardResult = await promptColumnMapping(listType, parsed.rows, hasHeader)
      if (wizardResult.cancelled) return cancelled()
      mapping = wizardResult.mapping
    }

    const mappingError = validateMapping(mapping, listType)
    if (mappingError !== null) {
      emitError('usage_error', mappingError, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    if (wizardRan && scripting.output === 'text' && !scripting.quiet) {
      logger.info('\nTo repeat this import without the setup wizard, run:')
      logger.info(
        `  ${formatScriptingCommand(file, listType, name, mode, format, mapping, hasHeader)}\n`,
      )
    }

    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
    if (dataRows.length === 0) {
      emitError('runtime_error', 'CSV file contains no data rows', scripting)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    const { entries, failures } = convertCsvRows(dataRows, mapping, listType)
    if (entries.length === 0) {
      emitError('runtime_error', 'No rows could be imported.', scripting, {
        failures: failures.map(toFailureOutput),
      })
      if (scripting.output === 'text') reportFailures(failures)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    const result = await applyCsvImport({ listType, name, mode, format }, entries)
    if ('error' in result) {
      emitError('runtime_error', result.error, scripting)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (scripting.output === 'text') {
      if (!scripting.quiet) {
        const verb = result.mode === 'append' ? 'Appended' : 'Imported'
        const preposition = result.mode === 'append' ? 'to' : 'into'
        logger.info(
          `${verb} ${result.cardCount} card(s) ${preposition} ${listType} '${name}': ${result.filePath}`,
        )
      }
      if (failures.length > 0) reportFailures(failures)
    } else {
      const payload: ImportCsvJsonResult = {
        imported: result.cardCount,
        failed: failures.length,
        failures: failures.map(toFailureOutput),
        filePath: result.filePath,
        mode: result.mode,
      }
      emitOutput(payload, scripting)
    }
    // A partial failure still writes the import, but the run must not look clean.
    if (failures.length > 0) {
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
