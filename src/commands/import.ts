import { Command } from 'commander'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { promptUser } from '../utils'
import { listFileName, unusableFileNameMessage } from '../list-file-name'
import { IMPORT_TEXT_PARSE_OPTIONS, listDeckFiles, loadDeckFile } from '../importers/text-file'
import { fetchDeckFromUrl, resolveImportSourceUrl } from '../importers/url-dispatch'
import {
  applyCsvImport,
  type CsvImportMode,
  type FlatListType,
  type ImportCardEntry,
} from '../importers/csv-apply'
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
} from '../deck-format'
import { type DeckData } from '../types'
import { serializeDeckToMarkdown, type DeckFrontMatter } from '../deck-file'
import { parseMoxfieldPrimer } from '../primer-parser'
import {
  addDryRunOption,
  addScriptingOptions,
  installScriptingLogger,
  markStdoutClosed,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type OutputFormat,
  type ScriptingOptions,
} from './scripting'
import { getLogger } from '../logger'
import { writeFileWithHash } from '../content-hash'
import { isPathWithinDir } from '../path-validation'
import { getDecksDir } from '../ritual-config'
import { listFilePath, normalizeListName } from '../resolve-list'
import { isListType, listTypeLabel, LIST_TYPES, type ListType } from '../list-type'
import { ask, promptListType } from './prompts-helpers'
import { isNoInput, promptsUnavailable } from '../no-input'
import { CardCommandError, getErrorMessage, hasErrorCode, isBrokenPipeError } from '../errors'

interface SaveListOptions {
  forceOverwrite?: boolean
  /**
   * Refuse to prompt on a name/ID conflict and throw instead. Defaults to
   * `promptsUnavailable()`, so every caller — the CLI, `import-account`, the
   * admin import handler — gets the actionable conflict error rather than a
   * prompt guard firing deep inside the save. Programmatic callers (the admin
   * import handler) pass true explicitly since there is never a terminal there.
   */
  noPrompts?: boolean
  /** Auto-answer the overwrite confirmation with yes when a conflict comes up. */
  assumeYes?: boolean
  dryRun?: boolean
  /**
   * Suppress progress and confirmation chatter ("Successfully imported … to …"),
   * matching the repo-wide `--quiet` convention. Errors, the interactive
   * conflict messages, and the `Overwriting …` notice are never suppressed —
   * silence must not hide that a file is about to be replaced, so that notice
   * goes to stderr through `warn` on every source kind (matching the CSV path).
   */
  quiet?: boolean
}

type DeckFileFrontmatter = {
  sourceId?: string
}

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
}

/** How an `import <source>` argument will be read. */
type ImportSourceKind = 'url' | 'csv' | 'text'

/** What saving the imported list did — or would do, under `--dry-run`. */
export type SaveListAction = 'created' | 'overwritten' | 'renamed'

/** Result of {@link saveDeck} / {@link saveFlatList}: where the list went, or a prompt cancel. */
export type SaveListOutcome =
  | { status: 'saved'; filePath: string; name: string; action: SaveListAction }
  | { status: 'cancelled' }

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
   * empty section. Always present; URL imports have nothing to parse and carry
   * an empty array. Any entry means content was lost, and the command exits 1.
   */
  warnings: string[]
  /**
   * Non-fatal notices about lines that WERE imported — a card name that still
   * carries a parenthesized printing token (an export dialect the parser does
   * not know), or a skipped Arena `About` line. Nothing was lost, so these do
   * not affect the exit code.
   */
  advisories: string[]
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

function normalizeSaveListOptions(options?: SaveListOptions): Required<SaveListOptions> {
  return {
    forceOverwrite: options?.forceOverwrite ?? false,
    noPrompts: options?.noPrompts ?? promptsUnavailable(),
    assumeYes: options?.assumeYes ?? false,
    dryRun: options?.dryRun ?? false,
    quiet: options?.quiet ?? false,
  }
}

/** `getLogger().info` gated on a save's `quiet` option. */
function saveInfo(resolvedOptions: Required<SaveListOptions>, message: string): void {
  if (resolvedOptions.quiet) return
  getLogger().info(message)
}

/**
 * The one refusal for an import that would replace an existing list without
 * being told to. Shared by the deck and flat-list saves (and matched by the CSV
 * path's own wording) so the advice and the usage exit code never diverge.
 */
function importConflictError(target: string): CardCommandError {
  return new CardCommandError(
    'usage_error',
    `Import conflict for '${target}'. Re-run with --overwrite or --yes to replace it.`,
    ExitCode.UsageError,
  )
}

type ConflictResolution =
  | { action: 'overwrite' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

/** Run the interactive overwrite/rename/cancel dance for an import name conflict. */
async function promptConflictResolution(renamePrompt: string): Promise<ConflictResolution> {
  let response = ''
  while (!['o', 'r', 'c'].includes(response)) {
    response = (await promptUser('Action: [O]verwrite, [R]ename, [C]ancel? ')).toLowerCase()
  }

  if (response === 'c') return { action: 'cancel' }
  if (response === 'o') return { action: 'overwrite' }

  let newName = ''
  while (!newName) {
    newName = await promptUser(renamePrompt)
  }
  return { action: 'rename', newName }
}

// Export saveDeck for reuse
export async function saveDeck(
  deckData: DeckData,
  decksDir: string,
  options?: SaveListOptions,
): Promise<SaveListOutcome> {
  const resolvedOptions = normalizeSaveListOptions(options)
  // Determine Target Filename. An imported deck's name comes from the source
  // service, so it can be anything — a name with nothing usable left is an error,
  // not a file called `.md`.
  let fileName = listFileName(deckData.name)
  if (fileName === null) {
    throw new Error(unusableFileNameMessage(deckData.name))
  }

  // Scan Existing Decks for ID Conflict
  let conflictFile: string | null = null
  let conflictReason: 'id' | 'name' | null = null

  // A dry run must leave a pristine directory byte-for-byte untouched, so the
  // decks dir is only created on the path that actually writes into it; the
  // conflict scan below already tolerates a missing directory.
  if (!resolvedOptions.dryRun) {
    await fs.mkdir(decksDir, { recursive: true })
  }

  let existingFiles: string[]
  try {
    existingFiles = await listDeckFiles(decksDir)
  } catch (error) {
    // A dry run (or a first import) legitimately finds no decks dir; any other
    // read failure must not be mistaken for "no conflicts".
    if (!hasErrorCode(error, 'ENOENT')) throw error
    existingFiles = []
  }

  // Helper to read simple frontmatter without heavy parser
  const readFrontmatter = async (fPath: string): Promise<DeckFileFrontmatter> => {
    const content = await Bun.file(fPath).text()
    const match = content.match(/^sourceId:\s*(?:"([^"]*)"|(\S+))/m)
    return match ? { sourceId: match[1] ?? match[2] } : {}
  }

  if (deckData.sourceId) {
    for (const f of existingFiles) {
      const fPath = path.join(decksDir, f)
      const meta = await readFrontmatter(fPath)
      if (meta.sourceId === deckData.sourceId) {
        conflictFile = f
        conflictReason = 'id'
        break
      }
    }
  }

  // If no ID conflict, check Filename conflict — by the resolver's folding, not
  // by a byte-exact file name: importing `atraxa superfriends` beside
  // `Atraxa Superfriends.md` would otherwise create a pair that every
  // name-resolving command reports as ambiguous, which `new` and `rename` refuse.
  if (!conflictFile) {
    const normalized = normalizeListName(path.basename(fileName, '.md'))
    const folded = existingFiles.find(
      (f) => normalizeListName(path.basename(f, '.md')) === normalized,
    )
    if (folded !== undefined) {
      conflictFile = folded
      conflictReason = 'name'
    }
  }

  let filePath = path.join(decksDir, fileName)
  let action: SaveListAction = 'created'
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (conflictFile && shouldOverwrite) {
    filePath = path.join(decksDir, conflictFile)
    action = 'overwritten'
    if (!resolvedOptions.dryRun) {
      getLogger().warn(`Overwriting ${conflictFile}...`)
    }
  } else if (conflictFile && !shouldOverwrite) {
    if (resolvedOptions.noPrompts) {
      throw importConflictError(conflictFile)
    }

    if (conflictReason === 'id') {
      getLogger().warn(`\nDeck already exists (ID Match): ${conflictFile}`)
    } else {
      getLogger().warn(`\nFile already exists (Name Conflict): ${conflictFile}`)
    }

    const resolution = await promptConflictResolution('Enter new filename (without .md): ')

    if (resolution.action === 'cancel') {
      getLogger().warn('Import cancelled.')
      return { status: 'cancelled' }
    } else if (resolution.action === 'rename') {
      // The typed-in name goes through the same naming rule as any other list, so
      // a prompt answer can neither escape the decks directory nor name a file `.md`.
      const renamed = listFileName(resolution.newName.replace(/\.md$/i, ''))
      if (renamed === null) {
        throw new Error(unusableFileNameMessage(resolution.newName))
      }
      fileName = renamed
      filePath = path.join(decksDir, fileName)
      action = 'renamed'
      if (!isPathWithinDir(filePath, decksDir)) {
        throw new Error(`Name '${resolution.newName}' is not a valid deck file name`)
      }

      // Double check new filename
      if (await Bun.file(filePath).exists()) {
        getLogger().error(`File '${fileName}' also exists. Aborting.`)
        throw new Error('File exists')
      }
    } else {
      // Overwrite existing file.
      filePath = path.join(decksDir, conflictFile)
      action = 'overwritten'
      getLogger().warn(`Overwriting ${conflictFile}...`)
    }
  }

  // Written through the shared serializer, so an imported deck comes out with the
  // same front matter (including a canonical `format:`, resolved from the source
  // service or the deck's sections) and the same `&N` card ids as a deck saved by
  // any other surface.
  const frontMatter: DeckFrontMatter = {
    name: deckData.name,
    format: deckData.format,
    sourceId: deckData.sourceId,
    sourceUrl: deckData.sourceUrl,
    description: deckData.description,
    created: new Date().toISOString(),
    tags: [],
  }
  const fileContent = serializeDeckToMarkdown(deckData, frontMatter)

  // Derive primer sidecar path from the deck file path
  const primerPath = filePath.replace(/\.md$/, '.primer.md')
  const primerMarkdown = deckData.primer ? parseMoxfieldPrimer(deckData.primer).markdown : undefined

  const outcome: SaveListOutcome = { status: 'saved', filePath, name: deckData.name, action }

  if (resolvedOptions.dryRun) {
    // A preview of a destructive import must show the destruction: the
    // `Overwriting …` notice is suppressed under --dry-run, so the verb here
    // carries it instead of reading like a fresh create.
    saveInfo(
      resolvedOptions,
      action === 'overwritten'
        ? `[dry-run] Would overwrite deck: ${filePath}`
        : `[dry-run] Would save deck to: ${filePath}`,
    )
    if (primerMarkdown) {
      saveInfo(resolvedOptions, `[dry-run] Would save primer to: ${primerPath}`)
    }
    return outcome
  }

  await writeFileWithHash(filePath, fileContent)
  saveInfo(resolvedOptions, `Successfully imported deck to: ${filePath}`)

  if (primerMarkdown) {
    await Bun.write(primerPath, primerMarkdown + '\n')
    saveInfo(resolvedOptions, `Successfully saved primer to: ${primerPath}`)
  }

  return outcome
}

/** Flatten parsed deck-style sections into flat-list entries, one per card line. */
function flattenToEntries(deckData: DeckData): ImportCardEntry[] {
  const entries: ImportCardEntry[] = []
  for (const section of deckData.sections) {
    for (const card of section.cards) {
      entries.push({
        name: card.name,
        quantity: card.quantity,
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        note: card.note,
        section: section.name,
      })
    }
  }
  return entries
}

/**
 * Save parsed text-file cards as a new collection or wanted list. Mirrors the
 * deck flow's conflict handling (overwrite/rename/cancel), then applies the
 * entries through the same writer the CSV import uses, so list files come out
 * identical regardless of the import source.
 */
export async function saveFlatList(
  deckData: DeckData,
  listType: FlatListType,
  options?: SaveListOptions,
): Promise<SaveListOutcome> {
  const resolvedOptions = normalizeSaveListOptions(options)
  const label = listTypeLabel(listType)
  const entries = flattenToEntries(deckData)

  // Collection lines always carry a printing; reject up front rather than
  // writing malformed `(:)` lines or silently dropping cards.
  if (listType === 'collection') {
    const missing = entries.filter((entry) => !entry.set || !entry.collectorNumber)
    if (missing.length > 0) {
      const preview = missing.slice(0, 5).map((entry) => entry.name)
      const rest = missing.length - preview.length
      throw new Error(
        `Cannot import as a collection: ${missing.length} card line(s) have no printing ` +
          `(set and collector number required): ${preview.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`,
      )
    }
  }

  let name = deckData.name
  let mode: CsvImportMode = 'create'
  let action: SaveListAction = 'created'

  /** The list's path, rejecting a name with nothing usable left rather than naming a file `.md`. */
  const targetPathFor = (listName: string): string => {
    const target = listFilePath(listType, listName)
    if (target === null) {
      throw new Error(unusableFileNameMessage(listName))
    }
    return target
  }

  let filePath = targetPathFor(name)
  const exists = await Bun.file(filePath).exists()
  const shouldOverwrite = resolvedOptions.forceOverwrite || resolvedOptions.assumeYes

  if (exists && shouldOverwrite) {
    mode = 'overwrite'
    action = 'overwritten'
    if (!resolvedOptions.dryRun) {
      getLogger().warn(`Overwriting ${path.basename(filePath)}...`)
    }
  } else if (exists) {
    if (resolvedOptions.noPrompts) {
      throw importConflictError(path.basename(filePath))
    }

    getLogger().warn(`\nFile already exists (Name Conflict): ${path.basename(filePath)}`)
    const resolution = await promptConflictResolution(`Enter new ${label} name: `)

    if (resolution.action === 'cancel') {
      getLogger().warn('Import cancelled.')
      return { status: 'cancelled' }
    } else if (resolution.action === 'rename') {
      name = resolution.newName
      filePath = targetPathFor(name)
      action = 'renamed'

      if (await Bun.file(filePath).exists()) {
        getLogger().error(`File '${path.basename(filePath)}' also exists. Aborting.`)
        throw new Error('File exists')
      }
    } else {
      mode = 'overwrite'
      action = 'overwritten'
      getLogger().warn(`Overwriting ${path.basename(filePath)}...`)
    }
  }

  if (resolvedOptions.dryRun) {
    saveInfo(
      resolvedOptions,
      action === 'overwritten'
        ? `[dry-run] Would overwrite ${label}: ${filePath}`
        : `[dry-run] Would save ${label} to: ${filePath}`,
    )
    return { status: 'saved', filePath, name, action }
  }

  const result = await applyCsvImport({ listType, name, mode }, entries)
  if ('error' in result) {
    throw new Error(result.error)
  }

  saveInfo(resolvedOptions, `Successfully imported ${label} to: ${result.filePath}`)
  return { status: 'saved', filePath: result.filePath, name, action }
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
    getLogger().info(
      'No --type given; importing as a deck (pass --type to import a collection or wanted list).',
    )
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
): string | undefined {
  if (kind === 'url' || kind === 'text') {
    const flag = firstCsvOnlyFlag(options)
    if (flag !== undefined) {
      return kind === 'url'
        ? `${flag} does not apply to URL imports.`
        : `${flag} requires a CSV source (a .csv file, or --csv to force CSV parsing).`
    }
  }
  if (kind !== 'url' && options.moxfieldUserAgent !== undefined) {
    return `--moxfield-user-agent only applies to URL imports; it does not apply to ${kind === 'csv' ? 'CSV' : 'text-file'} imports.`
  }
  return undefined
}

/**
 * The shared interactive-cancel exit: `Cancelled.` on stderr (structured in
 * JSON modes) and the usage-error exit code, so a cancelled run never looks
 * like a successful no-op to a script.
 */
function emitCancelled(scripting: ScriptingOptions): void {
  emitError('usage_error', 'Cancelled.', scripting)
  process.exitCode = ExitCode.UsageError
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
): void {
  const { warnings, advisories } = diagnostics
  if (outcome.status === 'cancelled') {
    emitCancelled(scripting)
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
    logger.error(`${warnings.length} line(s) could not be imported:`)
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
    logger.warn(`Warning: ${advisory}`)
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
      message: `Which column holds: ${CSV_FIELD_LABELS[field]}?${required ? '' : ' (optional)'}`,
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
  logger.error(`${failures.length} row(s) failed to import:`)
  for (const failure of failures) {
    logger.error(`  Line ${failure.lineNumber}: ${failure.raw}`)
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
  let listType: ListType | undefined = typeFlag

  let name = options.name?.trim()
  if (name === '') {
    emitError('usage_error', 'List name cannot be empty', scripting)
    process.exitCode = ExitCode.UsageError
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
    emitCancelled(scripting)
  }

  if (listType === undefined) {
    const picked = await promptListType()
    if (picked === undefined) return cancelled()
    listType = picked
  }

  if (format !== undefined && listType !== 'deck') {
    emitError('usage_error', '--deck-format only applies to deck imports', scripting)
    process.exitCode = ExitCode.UsageError
    return
  }
  if (format !== undefined && flagMode === 'append') {
    emitError(
      'usage_error',
      '--deck-format only applies when creating a deck, not when appending',
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
      emitError(
        'usage_error',
        `Import conflict for '${path.basename(existingPath)}'. Re-run with --append to add to it, or --overwrite/--yes to replace it.`,
        scripting,
      )
      process.exitCode = ExitCode.UsageError
      return
    } else {
      const picked = await ask<CsvImportMode | 'cancel'>({
        type: 'select',
        message: `'${path.basename(existingPath)}' already exists. What should happen?`,
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
    if (!scripting.quiet) logger.info(`Skipping header row: ${firstRow.raw}`)
    if (!guessHasHeader(firstRow.cells)) {
      logger.warn(
        `Warning: the first row does not look like a header but was skipped as one: ${firstRow.raw}` +
          ' — pass --no-header to import it as a card.',
      )
    }
  }

  if (wizardRan && scripting.output === 'text' && !scripting.quiet) {
    logger.info('\nTo repeat this import without the setup wizard, run:')
    logger.info(
      `  ${formatScriptingCommand(file, listType, name, mode, format, mapping, hasHeader, !isCsvPath(file))}\n`,
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

  // Replacing an existing list is destructive and must be visible even when the
  // run is otherwise silent, so it goes to stderr and survives --quiet (the
  // dry-run line below carries the same disclosure for a preview).
  if (mode === 'overwrite' && existingPath !== null && !dryRun) {
    logger.warn(`Overwriting ${path.basename(existingPath)}...`)
  }

  const result = await applyCsvImport({ listType, name, mode, format }, entries, { dryRun })
  if ('error' in result) {
    emitError('runtime_error', result.error, scripting)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  const replacing = result.mode === 'overwrite' && existingPath !== null

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      if (dryRun) {
        const verb = result.mode === 'append' ? 'append' : 'import'
        const preposition = result.mode === 'append' ? 'to' : 'into'
        // A dry run that would replace an existing list must say so — the one
        // mode whose purpose is previewing destructive effects.
        logger.info(
          replacing
            ? `[dry-run] Would overwrite ${listType} '${name}' with ${result.cardCount} card(s): ${result.filePath}`
            : `[dry-run] Would ${verb} ${result.cardCount} card(s) ${preposition} ${listType} '${name}': ${result.filePath}`,
        )
      } else {
        const verb = result.mode === 'append' ? 'Appended' : 'Imported'
        const preposition = result.mode === 'append' ? 'to' : 'into'
        logger.info(
          `${verb} ${result.cardCount} card(s) ${preposition} ${listType} '${name}': ${result.filePath}`,
        )
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
      program
        .command('import')
        .description(
          'Import a deck from a URL (Archidekt, Moxfield, MTGGoldfish), or a deck, collection, or wanted list from a local text or CSV file',
        )
        .argument('<source>', 'URL or file path (.csv files are imported as CSV)')
        .option(
          '-t, --type <type>',
          `List type for a file import: ${LIST_TYPES.join(', ')} (URLs always import decks)`,
        )
        .option('--name <name>', 'CSV only: name of the list to create or append to')
        .option(
          '--deck-format <format>',
          'CSV only: deck format when creating a deck (e.g. commander, modern)',
        )
        .option(
          '-c, --columns <mapping>',
          `CSV only: column mapping like 'name=1,set=2,collector-number=3' (1-based; fields: ${CSV_FIELDS.join(', ')}). Skips the interactive setup wizard.`,
        )
        .option('--no-header', 'CSV only: treat the first row as data instead of a header row')
        .option(
          '--append',
          'CSV only: append the cards to an existing list instead of creating a new one',
        )
        .option('--csv', 'Treat the source file as CSV regardless of its extension')
        .option('-o, --overwrite', 'Overwrite existing lists without prompting')
        .option(
          '-y, --yes',
          'Automatically answer yes to the overwrite confirmation on import conflicts',
        )
        .option(
          '--moxfield-user-agent <agent>',
          'Moxfield-approved unique User-Agent string (required for Moxfield imports unless MOXFIELD_USER_AGENT is set)',
        ),
      'Preview actions without writing files',
    ),
  ).action(async (source: string, options: ImportCommandOptions) => {
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
        emitError(
          'usage_error',
          `Invalid list type '${options.type}'. Use: ${LIST_TYPES.join(', ')}`,
          scripting,
        )
        process.exitCode = ExitCode.UsageError
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

    const rejection = rejectedFlagForSource(kind, options)
    if (rejection !== undefined) {
      emitError('usage_error', rejection, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    if (kind === 'url' && typeFlag !== undefined && typeFlag !== 'deck') {
      emitError(
        'usage_error',
        `URL imports only support decks; importing a ${listTypeLabel(typeFlag)} from a URL is not supported.`,
        scripting,
      )
      process.exitCode = ExitCode.UsageError
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
        const outcome = await saveDeck(result, getDecksDir(), saveOptions)
        emitImportSummary(source, 'deck', outcome, saveOptions.dryRun === true, scripting)
        return
      }

      if (!(await Bun.file(source).exists())) {
        emitError('not_found', `File not found: ${source}`, scripting)
        process.exitCode = ExitCode.NotFound
        return
      }

      if (!scripting.quiet) logger.info(`Reading cards from file: ${source}...`)
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
        emitCancelled(scripting)
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
        emitError(error.code, error.message, scripting, error.details)
        process.exitCode = error.exitCode
        return
      }
      // A `… | head` broken pipe ends the run quietly rather than failing.
      if (isBrokenPipeError(error)) {
        markStdoutClosed()
        return
      }
      emitError('runtime_error', `Failed to import: ${getErrorMessage(error)}`, scripting)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
