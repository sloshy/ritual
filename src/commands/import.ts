import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { IMPORT_TEXT_PARSE_OPTIONS, loadDeckFile } from '../importers/text-file'
import {
  saveDeck,
  saveFlatList,
  type SaveListAction,
  type SaveListOptions,
  type SaveListOutcome,
} from '../importers/save-list'
import { listFilePath } from '../list/resolve-list'
import {
  deckStatesPrintings,
  fetchDeckFromUrl,
  resolveImportSourceUrl,
  stripDeckPrintings,
} from '../importers/url-dispatch'
import { applyCsvImport, type CsvImportMode } from '../importers/csv-apply'
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
  finalizeMapping,
  validateMappingWidth,
  type ColumnMapping,
  type CsvRow,
  type CsvRowFailure,
} from '../importers/csv'
import {
  DECK_FORMAT_KEYS,
  getDeckFormatLabel,
  invalidDeckFormatMessage,
  parseDeckFormat,
  type DeckFormatKey,
} from '../list/deck-format'
import {
  addDryRunOption,
  addScriptingOptions,
  addSyncPrintingsOptions,
  readSyncPrintingsFlag,
  type SyncPrintingsOptions,
} from '../cli/options'
import {
  installScriptingLogger,
  markStdoutClosed,
  classifyFileReadError,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  type OutputFormat,
  type ScriptingOptions,
} from '../cli/output'
import { fail } from '../cli/action'
import { ExitCode, CardCommandError, getErrorMessage, isBrokenPipeError } from '../util/errors'
import { getLogger } from '../util/logger'
import { getDecksDir } from '../config/ritual-config'
import { isListType, listTypeLabel, LIST_TYPES, type ListType } from '../list/list-type'
import { ask, promptListType, resolveImportPrintings } from '../cli/prompts'
import { isNoInput, promptsUnavailable } from '../util/no-input'
import { t, type MessageParams } from '../i18n/t'

type ImportCommandOptions = {
  type?: string
  name?: string
  deckFormat?: string
  columns?: string
  /** Commander sets this to false for --no-header; defaults to true. */
  header: boolean
  overwrite?: boolean
  append?: boolean
  yes?: boolean
  csv?: boolean
  dryRun?: boolean
  moxfieldUserAgent?: string
  output: OutputFormat
  quiet: boolean
} & SyncPrintingsOptions

/** How an `import <source>` argument will be read. */
type ImportSourceKind = 'url' | 'csv' | 'text'

/** Structured `--output json`/`ndjson` payload for URL and text-file imports. */
type ImportJsonResult = {
  source: string
  listType: ListType
  name: string
  filePath: string
  action: SaveListAction
  dryRun: boolean
  /**
   * Parse warnings from a text-file source — one per skipped line or dropped
   * empty section (an empty *extras* section is an advisory instead; nothing is
   * lost by dropping it). Always present; URL imports have nothing to parse and
   * carry an empty array. Any entry means content was lost, and the command
   * exits 1.
   */
  warnings: string[]
  /**
   * Non-fatal notices about content that WAS read — a card name that still
   * carries a parenthesized printing token (an export dialect the parser does
   * not know), a skipped Arena `About` line, or an empty extras section the
   * write drops. Nothing was lost, so these do not affect the exit code.
   */
  advisories: string[]
  /**
   * Whether the written deck kept the exact printings the source listed. Only
   * a URL import can decline them (via prompt or flag), so the field appears
   * on URL imports alone — a text file's printings are its own lines.
   */
  syncPrintings?: boolean
}

/** One failed CSV row in the `--output json`/`ndjson` result. */
type ImportCsvFailureOutput = { line: number; reason: string }

/** Success payload for a CSV import under `--output json`/`ndjson` (also emitted on partial failure). */
type ImportCsvJsonResult = {
  imported: number
  failed: number
  failures: ImportCsvFailureOutput[]
  filePath: string
  mode: CsvImportMode
  dryRun: boolean
  /** Whether the import replaced — or, under `dryRun`, would replace — an existing list. */
  replacesExisting: boolean
}

/** Resolve the target list type for a text-file import: flag, prompt, or deck default. */
async function resolveImportListType(
  typeFlag: ListType | undefined,
): Promise<ListType | undefined> {
  if (typeFlag !== undefined) return typeFlag
  // Under --no-input the import keeps the command's historical deck behavior,
  // but says so — the type was defaulted, not chosen. Without --no-input the
  // prompt itself fails when no terminal is available (the ask() guard).
  if (isNoInput()) {
    getLogger().info(t('cli.import.defaultedToDeck'))
    return 'deck'
  }

  return promptListType()
}

/** Whether a file path names a CSV source by extension. */
function isCsvPath(source: string): boolean {
  return source.toLowerCase().endsWith('.csv')
}

/** The first CSV-only flag present on the command line, for per-source validation. */
function firstCsvOnlyFlag(options: ImportCommandOptions): string | undefined {
  if (options.csv === true) return '--csv'
  if (options.name !== undefined) return '--name'
  if (options.columns !== undefined) return '--columns'
  if (options.header === false) return '--no-header'
  if (options.append === true) return '--append'
  if (options.deckFormat !== undefined) return '--deck-format'
  return undefined
}

/** A usage-error message when a given flag does not apply to the resolved source kind. */
function rejectedFlagForSource(
  kind: ImportSourceKind,
  options: ImportCommandOptions,
  syncPrintingsFlag: boolean | undefined,
): string | undefined {
  if (kind === 'url' || kind === 'text') {
    const flag = firstCsvOnlyFlag(options)
    if (flag !== undefined) {
      return kind === 'url'
        ? t('cli.import.flagNotForUrl', { flag })
        : t('cli.import.flagNeedsCsv', { flag })
    }
  }
  if (kind !== 'url' && options.moxfieldUserAgent !== undefined) {
    return t('cli.import.moxfieldAgentSourceOnly', { kind })
  }
  // A local file's printings are the file's own data, so the URL-import
  // question makes no sense there in either direction.
  if (kind !== 'url' && syncPrintingsFlag !== undefined) {
    return t('cli.import.syncPrintingsUrlOnly', { kind })
  }
  return undefined
}

/**
 * A parse's two diagnostic channels, named rather than passed as two adjacent
 * positional `string[]`s — they have opposite consequences (warnings mean
 * content was lost and set a failing exit code; advisories do not), so a
 * transposition the compiler cannot catch must not be possible.
 */
type ImportSummaryDiagnostics = {
  /** Lines the parser could not read at all. */
  warnings: string[]
  /** Lines that WERE imported but whose shape deserves a word. */
  advisories: string[]
}

/** Emit the structured summary for a URL/text import. Text mode already logged its lines. */
function emitImportSummary(
  source: string,
  listType: ListType,
  outcome: SaveListOutcome,
  dryRun: boolean,
  scripting: ScriptingOptions,
  diagnostics: ImportSummaryDiagnostics = { warnings: [], advisories: [] },
  /** URL imports only: whether the deck kept the source's exact printings. */
  syncPrintings?: boolean,
): void {
  const { warnings, advisories } = diagnostics
  if (outcome.status === 'cancelled') {
    fail(scripting, 'usage_error', 'cli.import.cancelled')
    return
  }
  if (scripting.output === 'text') return
  const payload: ImportJsonResult = {
    source,
    listType,
    name: outcome.name,
    filePath: outcome.filePath,
    action: outcome.action,
    dryRun,
    warnings,
    advisories,
  }
  if (syncPrintings !== undefined) payload.syncPrintings = syncPrintings
  emitOutput(payload, scripting)
}

/**
 * Report a text-file source's parse warnings — lines the parser skipped are
 * content the import silently lost, so they are listed on stderr (mirroring
 * the CSV path's per-row failure report) and the run exits 1 even though the
 * import was written.
 */
function reportSkippedLines(warnings: string[], scripting: ScriptingOptions): void {
  if (warnings.length === 0) return
  if (scripting.output === 'text') {
    const logger = getLogger()
    logger.error(t('cli.import.linesNotImported', { count: warnings.length }))
    for (const warning of warnings) {
      logger.error(`  ${warning}`)
    }
  }
  // A partial import still writes the list, but the run must not look clean.
  process.exitCode = ExitCode.RuntimeError
}

/**
 * Report a text source's parse advisories: lines that WERE imported but whose
 * shape suggests the file's dialect was not understood. Essential output (they
 * survive `--quiet`, and JSON modes carry them in the payload as well), but not
 * a failure — nothing was lost, so the exit code is untouched.
 */
function reportAdvisories(advisories: string[]): void {
  if (advisories.length === 0) return
  const logger = getLogger()
  for (const advisory of advisories) {
    logger.warn(t('cli.import.advisory', { message: advisory }))
  }
}

// ── CSV source flow ─────────────────────────────────────────────────

/** Quote a value for the echoed scripting command when it needs it. */
function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Build the non-interactive command equivalent to the wizard's answers, so the
 * same CSV import can be scripted without the setup wizard. `forceCsv` adds the
 * `--csv` flag for files whose extension would not trigger CSV detection.
 */
export function formatScriptingCommand(
  file: string,
  listType: ListType,
  name: string,
  mode: CsvImportMode,
  format: DeckFormatKey | undefined,
  mapping: ColumnMapping,
  hasHeader: boolean,
  forceCsv: boolean,
): string {
  const parts = ['ritual', 'import', shellQuote(file)]
  if (forceCsv) parts.push('--csv')
  parts.push('--type', listType, '--name', shellQuote(name))
  if (mode === 'overwrite') parts.push('--overwrite')
  if (mode === 'append') parts.push('--append')
  if (format !== undefined) parts.push('--deck-format', format)
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
  if (optional) choices.push({ title: t('cli.import.columnNotPresent'), value: -1 })
  for (let i = 0; i < columnCount; i++) {
    if (usedColumns.has(i)) continue
    const header = headerCells?.[i]
    const sample = sampleCells[i]
    let title =
      header !== undefined && header !== ''
        ? t('cli.import.columnWithHeader', { number: i + 1, header })
        : t('cli.import.column', { number: i + 1 })
    if (sample !== undefined && sample !== '') title += t('cli.import.columnSample', { sample })
    choices.push({ title, value: i })
  }
  return choices
}

/** What the interactive column wizard settled on. */
type WizardMappingResult =
  | { status: 'cancelled' }
  | { status: 'mapped'; mapping: ColumnMapping }
  /** The answers do not make a usable mapping for this list type. */
  | { status: 'invalid'; message: string }

/** Interactively map CSV columns to card fields. */
async function promptColumnMapping(
  listType: ListType,
  rows: CsvRow[],
  hasHeader: boolean,
): Promise<WizardMappingResult> {
  if (rows.length === 0) return { status: 'cancelled' }
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
      message: required
        ? t('cli.import.promptWhichColumn', { field: CSV_FIELD_LABELS[field] })
        : t('cli.import.promptWhichColumnOptional', { field: CSV_FIELD_LABELS[field] }),
      choices,
      initial: initial === -1 ? 0 : initial,
    })
    if (selection === undefined) return { status: 'cancelled' }
    if (selection === -1) continue
    mapping[FIELD_TO_KEY[field]] = selection
    usedColumns.add(selection)
  }

  // The same checked exit `--columns` takes, rather than an assertion that the
  // required-field loop above happened to fill everything in.
  const finalized = finalizeMapping(mapping, listType)
  if (typeof finalized === 'string') return { status: 'invalid', message: finalized }
  return { status: 'mapped', mapping: finalized }
}

/** Map an engine row failure onto the JSON output shape. */
function toFailureOutput(failure: CsvRowFailure): ImportCsvFailureOutput {
  return { line: failure.lineNumber, reason: failure.reason }
}

function reportFailures(failures: CsvRowFailure[]): void {
  const logger = getLogger()
  logger.error(t('cli.import.rowsFailed', { count: failures.length }))
  for (const failure of failures) {
    logger.error(`  ${t('cli.import.failureLine', { line: failure.lineNumber, raw: failure.raw })}`)
    logger.error(`    ${failure.reason}`)
  }
}

/**
 * The CSV source path of `ritual import`: resolve the target from flags (or the
 * interactive wizard), convert the rows, and apply them through the shared CSV
 * import engine.
 */
async function runCsvImport(
  file: string,
  options: ImportCommandOptions,
  typeFlag: ListType | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  const logger = getLogger()
  const dryRun = options.dryRun === true

  if (options.overwrite === true && options.append === true) {
    fail(scripting, 'usage_error', 'cli.import.overwriteAppendExclusive')
    return
  }

  let content: string
  try {
    content = await fs.readFile(file, 'utf-8')
  } catch (error) {
    const failure = classifyFileReadError(error)
    emitError(
      failure.errorCode,
      t('cli.import.csvUnreadable', { path: file }),
      scripting,
      undefined,
      'cli.import.csvUnreadable',
    )
    process.exitCode = failure.exitCode
    return
  }

  const parsed = parseCsv(content)
  if ('error' in parsed) {
    fail(scripting, 'runtime_error', 'cli.import.csvParseFailed', {
      reason: parsed.error,
    })
    return
  }
  if (parsed.rows.length === 0) {
    fail(scripting, 'runtime_error', 'cli.import.csvNoRows')
    return
  }

  // Resolve list type, name, mode, and format from flags first; the wizard
  // only asks for whatever is missing.
  let listType: ListType | undefined = typeFlag

  let name = options.name?.trim()
  if (name === '') {
    fail(scripting, 'usage_error', 'cli.import.nameEmpty')
    return
  }

  let format: DeckFormatKey | undefined
  if (options.deckFormat !== undefined) {
    const normalized = parseDeckFormat(options.deckFormat)
    if (normalized === null) {
      emitError('usage_error', invalidDeckFormatMessage(options.deckFormat), scripting)
      process.exitCode = ExitCode.UsageError
      return
    }
    format = normalized
  }

  // Prompts are unavailable when they are disabled (--no-input), when stdin
  // is not a terminal, or when --columns says the user is scripting.
  const scripted = promptsUnavailable() || options.columns !== undefined
  const flagMode: CsvImportMode | undefined =
    options.append === true ? 'append' : options.overwrite === true ? 'overwrite' : undefined

  if (scripted) {
    const missing: string[] = []
    if (listType === undefined) missing.push('--type')
    if (name === undefined) missing.push('--name')
    if (options.columns === undefined) missing.push('--columns')
    if (listType === 'deck' && flagMode !== 'append' && format === undefined) {
      missing.push('--deck-format')
    }
    if (missing.length > 0) {
      fail(scripting, 'usage_error', 'cli.import.missingScriptedFlags', {
        flags: missing.join(', '),
      })
      return
    }
  }

  const cancelled = (): void => {
    fail(scripting, 'usage_error', 'cli.import.cancelled')
  }

  if (listType === undefined) {
    const picked = await promptListType()
    if (picked === undefined) return cancelled()
    listType = picked
  }

  if (format !== undefined && listType !== 'deck') {
    fail(scripting, 'usage_error', 'cli.import.deckFormatDeckOnly')
    return
  }
  if (format !== undefined && flagMode === 'append') {
    fail(scripting, 'usage_error', 'cli.import.deckFormatNotAppend')
    return
  }

  if (name === undefined) {
    const picked = await ask<string>({
      type: 'text',
      message: t('cli.import.promptListName', { label: listTypeLabel(listType) }),
      validate: (value: string) =>
        value.trim().length > 0 ? true : t('cli.import.nameEmptyValidation'),
    })
    if (picked === undefined) return cancelled()
    name = picked.trim()
  }

  // Resolve the import mode: explicit flags win; otherwise an existing file of
  // the same name is overwritten under --yes (which auto-answers the conflict,
  // like the URL/text paths) or prompts append / overwrite / cancel.
  const targetPath = listFilePath(listType, name)
  /** The target list's path when it already exists, else null (the create case). */
  const existingPath =
    targetPath !== null && (await Bun.file(targetPath).exists()) ? targetPath : null
  let mode: CsvImportMode
  if (flagMode !== undefined) {
    mode = flagMode
  } else {
    if (existingPath === null) {
      mode = 'create'
    } else if (options.yes === true) {
      mode = 'overwrite'
    } else if (scripted) {
      // Same class of refusal as the URL/text conflict above — a usage error,
      // not a runtime failure — with the extra `--append` option CSV has.
      fail(scripting, 'usage_error', 'cli.import.conflictCsv', {
        target: path.basename(existingPath),
      })
      return
    } else {
      const picked = await ask<CsvImportMode | 'cancel'>({
        type: 'select',
        message: t('cli.import.promptExisting', { file: path.basename(existingPath) }),
        choices: [
          { title: t('cli.import.choiceAppend'), value: 'append' },
          { title: t('cli.import.choiceOverwrite'), value: 'overwrite' },
          { title: t('cli.menu.cancel'), value: 'cancel' },
        ],
      })
      if (picked === undefined || picked === 'cancel') return cancelled()
      mode = picked
    }
  }

  if (listType === 'deck' && mode !== 'append' && format === undefined) {
    const picked = await ask<DeckFormatKey>({
      type: 'select',
      message: t('cli.import.promptDeckFormat'),
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
      message: t('cli.import.promptHasHeader'),
      initial: guessHasHeader(firstRow.cells),
    })
    if (headerAnswer === undefined) return cancelled()
    hasHeader = headerAnswer

    if (hasHeader && parsed.rows.length < 2) {
      fail(scripting, 'runtime_error', 'cli.import.csvHeaderNoData')
      return
    }

    const wizardResult = await promptColumnMapping(listType, parsed.rows, hasHeader)
    if (wizardResult.status === 'cancelled') return cancelled()
    if (wizardResult.status === 'invalid') {
      emitError('usage_error', wizardResult.message, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }
    mapping = wizardResult.mapping
  }

  // A --columns index the file has no column for is one usage error, not a
  // per-row 'Missing card name' for every row in the file.
  const columnCount = Math.max(...parsed.rows.map((row) => row.cells.length))
  const widthError = validateMappingWidth(mapping, columnCount)
  if (widthError !== null) {
    emitError('usage_error', widthError, scripting)
    process.exitCode = ExitCode.UsageError
    return
  }

  // The scripted path never asks the header question, so it says out loud what
  // it assumed: the row it is about to drop, plus an essential warning when
  // that row looks like data (an almost-certainly-lost card).
  if (hasHeader && options.columns !== undefined) {
    const firstRow = parsed.rows[0]!
    if (!scripting.quiet) logger.info(t('cli.import.skippingHeader', { row: firstRow.raw }))
    if (!guessHasHeader(firstRow.cells)) {
      logger.warn(t('cli.import.headerLooksLikeData', { row: firstRow.raw }))
    }
  }

  if (wizardRan && scripting.output === 'text' && !scripting.quiet) {
    logger.info(`\n${t('cli.import.repeatHint')}`)
    logger.info(
      `  ${formatScriptingCommand(file, listType, name, mode, format, mapping, hasHeader, !isCsvPath(file))}\n`,
    )
  }

  const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
  if (dataRows.length === 0) {
    fail(scripting, 'runtime_error', 'cli.import.csvNoDataRows')
    return
  }

  const { entries, failures } = convertCsvRows(dataRows, mapping, listType)
  if (entries.length === 0) {
    emitError(
      'runtime_error',
      t('cli.import.noRowsImported'),
      scripting,
      { failures: failures.map(toFailureOutput) },
      'cli.import.noRowsImported',
    )
    if (scripting.output === 'text') reportFailures(failures)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  // Replacing an existing list is destructive and must be visible even when the
  // run is otherwise silent, so it goes to stderr and survives --quiet (the
  // dry-run line below carries the same disclosure for a preview).
  if (mode === 'overwrite' && existingPath !== null && !dryRun) {
    logger.warn(t('cli.import.overwritingFile', { file: path.basename(existingPath) }))
  }

  const result = await applyCsvImport({ listType, name, mode, format }, entries, {
    dryRun,
    sourceHadLanguageColumn: mapping.language !== undefined,
  })
  if ('error' in result) {
    emitError('runtime_error', result.error, scripting)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  const replacing = result.mode === 'overwrite' && existingPath !== null

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      // Both the dry-run preview and the confirmation take the same parameters,
      // so the bag is built once and typed by the message it feeds.
      const applied: MessageParams<'cli.import.appliedCsv'> = {
        mode: result.mode,
        count: result.cardCount,
        listType,
        name,
        path: result.filePath,
      }
      if (dryRun) {
        // A dry run that would replace an existing list must say so — the one
        // mode whose purpose is previewing destructive effects.
        logger.info(
          replacing
            ? t('cli.import.dryRunOverwriteCsv', {
                listType,
                name,
                count: result.cardCount,
                path: result.filePath,
              })
            : t('cli.import.dryRunApplyCsv', applied),
        )
      } else {
        logger.info(t('cli.import.appliedCsv', applied))
      }
    }
    if (failures.length > 0) reportFailures(failures)
  } else {
    const payload: ImportCsvJsonResult = {
      imported: result.cardCount,
      failed: failures.length,
      failures: failures.map(toFailureOutput),
      filePath: result.filePath,
      mode: result.mode,
      dryRun,
      replacesExisting: replacing,
    }
    emitOutput(payload, scripting)
  }
  // A partial failure still writes the import, but the run must not look clean.
  if (failures.length > 0) {
    process.exitCode = ExitCode.RuntimeError
  }
}

export function registerImportCommand(program: Command): void {
  addScriptingOptions(
    addDryRunOption(
      addSyncPrintingsOptions(
        program
          .command('import')
          .description(t('help.import.description'))
          .argument('<source>', t('help.import.source'))
          .option('-t, --type <type>', t('help.import.type', { types: LIST_TYPES.join(', ') }))
          .option('--name <name>', t('help.import.name'))
          .option('--deck-format <format>', t('help.import.deckFormat'))
          .option(
            '-c, --columns <mapping>',
            t('help.import.columns', { fields: CSV_FIELDS.join(', ') }),
          )
          .option('--no-header', t('help.import.noHeader'))
          .option('--append', t('help.import.append'))
          .option('--csv', t('help.import.csv'))
          .option('-o, --overwrite', t('help.import.overwrite'))
          .option('-y, --yes', t('help.import.yes'))
          .option('--moxfield-user-agent <agent>', t('help.import.moxfieldUserAgent')),
      ),
      t('help.import.dryRun'),
    ),
  ).action(async (source: string, options: ImportCommandOptions, command: Command) => {
    const scripting = normalizeScriptingOptions(options)
    // The importer and the data layer log through getLogger(): JSON modes keep
    // stdout for the payload, and `--quiet` drops info chatter entirely, so
    // engine progress obeys the same convention as this command's own lines.
    installScriptingLogger(scripting)
    const logger = getLogger()

    let typeFlag: ListType | undefined
    if (options.type !== undefined) {
      const normalized = options.type.toLowerCase()
      if (!isListType(normalized)) {
        fail(scripting, 'usage_error', 'cli.import.invalidListType', {
          value: options.type,
          choices: LIST_TYPES.join(', '),
        })
        return
      }
      typeFlag = normalized
    }

    // URL-shaped sources (explicit scheme, or a scheme-less supported deck
    // URL like `archidekt.com/decks/123`) go through URL dispatch; a `.csv`
    // file (or any file under --csv) goes through the CSV flow; everything
    // else is a local text file.
    const sourceUrl = resolveImportSourceUrl(source)
    const kind: ImportSourceKind =
      sourceUrl !== undefined ? 'url' : options.csv === true || isCsvPath(source) ? 'csv' : 'text'

    const syncPrintingsFlag = readSyncPrintingsFlag(command, options)

    const rejection = rejectedFlagForSource(kind, options, syncPrintingsFlag)
    if (rejection !== undefined) {
      emitError('usage_error', rejection, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    if (kind === 'url' && typeFlag !== undefined && typeFlag !== 'deck') {
      fail(scripting, 'usage_error', 'cli.import.urlDeckOnly', {
        label: listTypeLabel(typeFlag),
      })
      return
    }

    const saveOptions: SaveListOptions = {
      forceOverwrite: options.overwrite === true,
      assumeYes: options.yes === true,
      dryRun: options.dryRun === true,
      quiet: scripting.quiet,
    }

    try {
      if (kind === 'csv') {
        await runCsvImport(source, options, typeFlag, scripting)
        return
      }

      if (sourceUrl !== undefined) {
        const result = await fetchDeckFromUrl(sourceUrl, {
          moxfieldUserAgent: options.moxfieldUserAgent,
          onProgress: (message) => {
            if (!scripting.quiet) logger.info(message)
          },
        })
        if (typeof result === 'string') {
          emitError('usage_error', result, scripting)
          process.exitCode = ExitCode.UsageError
          return
        }
        // The exact printings the source lists are opt-in, mirroring
        // deck-sync's --sync-printings: an explicit flag decides, otherwise
        // the user is asked (and --no-input keeps them, saying so).
        const keepPrintings = await resolveImportPrintings({
          flag: syncPrintingsFlag,
          deckStatesPrintings: deckStatesPrintings(result),
          scripting,
        })
        if (keepPrintings === undefined) {
          fail(scripting, 'usage_error', 'cli.import.cancelled')
          return
        }
        const deckToSave = keepPrintings ? result : stripDeckPrintings(result)
        const outcome = await saveDeck(deckToSave, getDecksDir(), saveOptions)
        emitImportSummary(
          source,
          'deck',
          outcome,
          saveOptions.dryRun === true,
          scripting,
          undefined,
          keepPrintings,
        )
        return
      }

      if (!(await Bun.file(source).exists())) {
        fail(scripting, 'not_found', 'cli.import.fileNotFound', { path: source })
        return
      }

      if (!scripting.quiet) logger.info(t('cli.import.readingFile', { path: source }))
      // Import reads the Arena/MTGO export dialect on top of Ritual's own
      // grammar, and reads through ``` fences (a pasted decklist usually
      // arrives wrapped in one); loads of workspace list files deliberately do
      // neither. See ParseDeckTextOptions.
      const {
        deck: deckData,
        warnings,
        advisories,
      } = await loadDeckFile(source, IMPORT_TEXT_PARSE_OPTIONS)

      const listType = await resolveImportListType(typeFlag)
      if (listType === undefined) {
        fail(scripting, 'usage_error', 'cli.import.cancelled')
        return
      }

      const outcome =
        listType === 'deck'
          ? await saveDeck(deckData, getDecksDir(), saveOptions)
          : await saveFlatList(deckData, listType, saveOptions)
      emitImportSummary(source, listType, outcome, saveOptions.dryRun === true, scripting, {
        warnings,
        advisories,
      })
      if (outcome.status === 'saved') {
        reportAdvisories(advisories)
        reportSkippedLines(warnings, scripting)
      }
    } catch (error) {
      // The prompt guards throw a structured usage error when input is
      // needed but prompts are unavailable (no terminal, or --no-input);
      // keep its exit code instead of flattening it to a runtime error.
      if (error instanceof CardCommandError) {
        emitError(error.code, error.message, scripting, error.details, error.messageRef)
        process.exitCode = error.exitCode
        return
      }
      // A `… | head` broken pipe ends the run quietly rather than failing.
      if (isBrokenPipeError(error)) {
        markStdoutClosed()
        return
      }
      fail(scripting, 'runtime_error', 'cli.import.failed', {
        reason: getErrorMessage(error),
      })
    }
  })
}
