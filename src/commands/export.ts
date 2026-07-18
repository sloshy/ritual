import path from 'node:path'
import type { Command } from 'commander'
import { getErrorMessage } from '../errors'
import { countLabel } from '../editor/change-bundle'
import { isFinish, VALID_CONDITIONS, VALID_FINISHES } from '../finish-condition'
import { type ListType } from '../list-type'
import {
  buildExportSelection,
  hasActiveExportFilters,
  parseConditionFilterValues,
  type ExportFilters,
} from '../export/entries'
import { describeExportProperties, parseColumnsFlag, type ExportProperty } from '../export/render'
import {
  EXPORT_FORMATS,
  exportFormatUsesColumns,
  isExportFormat,
  resolveExportSettings,
  type ExportFormat,
  type ExportPreset,
} from '../export/presets'
import { renderExport, saveExportPreset } from '../export/output'
import {
  isResolveListError,
  listLocations,
  listTypeFromFlags,
  parseListArgument,
  resolveList,
  type ListLocation,
} from '../resolve-list'
import { getExportPresets } from '../ritual-config'
import { isNoInput } from '../no-input'
import {
  emitError,
  emitResolveListError,
  emitToFileOrStdout,
  ExitCode,
  type ScriptingOptions,
} from './scripting'
import { runExportWizard } from './export-wizard'

/** Raw commander option values; output/columns/finish/condition are validated in the action. */
type ExportCommandOptions = {
  deck?: boolean
  collection?: boolean
  wanted?: boolean
  all?: boolean
  card: string[]
  name?: string
  set?: string
  finish?: string
  condition?: string
  /** The `--output <format>` export format; validated into `ParsedExportFlags.format`. */
  output?: string
  columns?: string
  /** Commander stores `--no-header` as `header: false` (true when not given). */
  header: boolean
  quoteAll?: boolean
  out?: string
  preset?: string
  savePreset?: string
  quiet?: boolean
}

/** Validated flag values that decide gating and output shape. */
export type ParsedExportFlags = {
  all: boolean
  cards: string[]
  filters: ExportFilters
  format?: ExportFormat
  columns?: ExportProperty[]
  /** undefined when `--no-header` was not given. */
  header?: boolean
  quoteAll?: boolean
  out?: string
  preset?: string
  savePreset?: string
  quiet?: boolean
}

/**
 * Whether the invocation carries a run signal — a list arg or any flag that
 * describes a concrete export, `--preset` included (`export --preset x` runs
 * that preset directly). With a run signal the command runs headlessly; without
 * one it is wizard-intent: it opens the wizard on a full TTY and is a usage
 * error when prompts are unavailable.
 */
export function hasExportRunSignal(flags: ParsedExportFlags, listArgs: string[]): boolean {
  if (listArgs.length > 0) return true
  if (flags.all || flags.cards.length > 0) return true
  if (flags.format || flags.columns || flags.header !== undefined || flags.quoteAll) return true
  if (flags.out || flags.preset || flags.savePreset) return true
  return hasActiveExportFilters(flags.filters)
}

/**
 * The wizard launches only for a wizard-intent invocation (no run signals)
 * where prompting is possible: stdout and stdin are terminals and `--no-input`
 * is not in force.
 */
export function shouldRunExportInteractive(
  flags: ParsedExportFlags,
  listArgs: string[],
  interactiveAvailable: boolean,
): boolean {
  return interactiveAvailable && !hasExportRunSignal(flags, listArgs)
}

const textOptions: ScriptingOptions = { output: 'text', quiet: false }

function usageError(message: string): void {
  emitError('usage_error', message, textOptions)
  process.exitCode = ExitCode.UsageError
}

/** Validate the raw filter/format/column flag strings, or report and return undefined. */
function parseExportFlags(options: ExportCommandOptions): ParsedExportFlags | undefined {
  const filters: ExportFilters = { name: options.name, set: options.set }
  if (options.finish !== undefined) {
    const finish = options.finish.toLowerCase()
    if (!isFinish(finish)) {
      usageError(`Invalid finish '${options.finish}'. Use one of: ${VALID_FINISHES.join(', ')}.`)
      return undefined
    }
    filters.finish = finish
  }
  if (options.condition !== undefined) {
    const conditions = parseConditionFilterValues(
      options.condition
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    )
    if (typeof conditions === 'string') {
      usageError(conditions)
      return undefined
    }
    filters.conditions = conditions
  }

  let format: ExportFormat | undefined
  if (options.output !== undefined) {
    const lower = options.output.toLowerCase()
    if (!isExportFormat(lower)) {
      usageError(
        `Invalid output format '${options.output}'. Use one of: ${EXPORT_FORMATS.join(', ')}.`,
      )
      return undefined
    }
    format = lower
  }

  let columns: ExportProperty[] | undefined
  if (options.columns !== undefined) {
    const parsed = parseColumnsFlag(options.columns)
    if (typeof parsed === 'string') {
      usageError(parsed)
      return undefined
    }
    columns = parsed
  }

  // The column/CSV-shape flags conflict with an explicit fixed-line format.
  // Only explicit flags conflict — a preset whose stored columns accompany a
  // text/md format is fine (the columns are simply unused).
  if (format !== undefined && !exportFormatUsesColumns(format)) {
    const conflicting: string[] = []
    if (options.columns !== undefined) conflicting.push('--columns')
    if (!options.header) conflicting.push('--no-header')
    if (options.quoteAll) conflicting.push('--quote-all')
    if (conflicting.length > 0) {
      usageError(
        `${conflicting.join(' and ')} cannot be combined with --output ${format}: ${format} exports have a fixed line format. Columns and CSV options apply to csv/json output only.`,
      )
      return undefined
    }
  }

  return {
    all: options.all ?? false,
    cards: options.card,
    filters,
    format,
    columns,
    header: options.header ? undefined : false,
    quoteAll: options.quoteAll ? true : undefined,
    out: options.out,
    preset: options.preset,
    savePreset: options.savePreset,
    quiet: options.quiet,
  }
}

/** Write the export to a file (creating parent directories) or raw to stdout. */
async function emitExport(
  content: string,
  entryCount: number,
  out: string | undefined,
  quiet: boolean,
): Promise<void> {
  await emitToFileOrStdout(`${content}\n`, {
    outPath: out ? path.resolve(out) : undefined,
    quiet,
    confirm: {
      file: (target) => `✓ Exported ${countLabel(entryCount, 'card')} to ${target}`,
      // Keep stdout parseable: the stdout-mode confirmation goes to stderr.
      stdout: `Exported ${countLabel(entryCount, 'card')}`,
    },
  })
}

async function runFlagExport(
  listArgs: string[],
  type: ListType | undefined,
  flags: ParsedExportFlags,
): Promise<void> {
  const quiet = flags.quiet ?? false

  // Resolve the preset before doing any work so an unknown name fails fast.
  let preset: ExportPreset | undefined
  if (flags.preset !== undefined) {
    const presets = getExportPresets()
    preset = presets[flags.preset]
    if (!preset) {
      const names = Object.keys(presets)
      emitError(
        'not_found',
        names.length > 0
          ? `No export preset named '${flags.preset}'. Saved presets: ${names.join(', ')}.`
          : `No export preset named '${flags.preset}'. No presets are saved yet.`,
        textOptions,
      )
      process.exitCode = ExitCode.NotFound
      return
    }
  }
  const settings = resolveExportSettings(preset, {
    format: flags.format,
    columns: flags.columns,
    header: flags.header,
    quoteAll: flags.quoteAll,
  })

  // Selected lists: named args, or every list in scope when --all (or nothing) was given.
  const selected: ListLocation[] = []
  for (const raw of listArgs) {
    const arg = parseListArgument(raw)
    const resolved = await resolveList(arg.name, arg.type ?? type)
    if (isResolveListError(resolved)) {
      emitResolveListError(resolved, textOptions)
      return
    }
    if (!selected.some((l) => l.type === resolved.type && l.name === resolved.name)) {
      selected.push(resolved)
    }
  }
  const exportAll = flags.all || (listArgs.length === 0 && flags.cards.length === 0)
  const scope = await listLocations(type)
  if (exportAll) {
    for (const location of scope) {
      if (!selected.some((l) => l.type === location.type && l.name === location.name)) {
        selected.push(location)
      }
    }
  }

  // Card picks search every list in scope, not just the selected ones.
  const selection = await buildExportSelection(selected, scope, flags.cards, flags.filters)
  if (!quiet) {
    for (const warning of selection.warnings) console.warn(`⚠️  ${warning}`)
  }

  if (flags.savePreset !== undefined) {
    await saveExportPreset(flags.savePreset, settings)
    if (!quiet) console.log(`✓ Saved export preset '${flags.savePreset}'`)
  }

  await emitExport(
    renderExport(selection.entries, settings),
    selection.entries.length,
    flags.out,
    quiet,
  )
}

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description(
      'Export cards from decks, collections, and wanted lists as CSV, JSON, plain text, or Markdown',
    )
    .argument(
      '[lists...]',
      'Lists to export; an optional deck:/collection:/wanted: prefix pins the type',
    )
    .option('--deck', 'Only decks (also disambiguates list names)')
    .option('--collection', 'Only collections (also disambiguates list names)')
    .option('--wanted', 'Only wanted lists (also disambiguates list names)')
    .option('--all', 'Export every list (the default when no lists or --card are given)')
    .option(
      '--card <terms>',
      'Add cards whose name matches every term (repeatable)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--name <terms>', 'Only cards whose name contains every term')
    .option('--set <code>', 'Only cards from this set code')
    .option('--finish <finish>', `Only cards with this finish: ${VALID_FINISHES.join(', ')}`)
    .option(
      '--condition <list>',
      `Only cards with one of these conditions (comma-separated): ${VALID_CONDITIONS.join(', ')}, none (no condition marked)`,
    )
    // No commander default and no argParser: `undefined` must mean "not given"
    // so a preset's stored format can fill it in (tri-state precedence).
    .option('--output <format>', `Export format: ${EXPORT_FORMATS.join(', ')} (default: csv)`)
    .option(
      '--columns <list>',
      `Comma-separated columns in output order (csv/json only). Available: ${describeExportProperties()}`,
    )
    .option('--no-header', 'Omit the CSV header row')
    .option('--quote-all', 'Quote every CSV cell instead of only cells that need it')
    .option('--out <file>', 'Write to this file instead of stdout')
    .option('--preset <name>', 'Export with a saved preset (explicit flags override its values)')
    .option('--save-preset <name>', 'Save the resolved format/columns/CSV options as a preset')
    .option('--quiet', 'Suppress warnings and confirmations')
    .action(async (listArgs: string[], options: ExportCommandOptions) => {
      const type = listTypeFromFlags(options)
      if (type === 'conflict') {
        usageError('Use only one of --deck, --collection, or --wanted.')
        return
      }

      const flags = parseExportFlags(options)
      if (!flags) return

      try {
        const interactiveAvailable =
          process.stdout.isTTY === true && process.stdin.isTTY === true && !isNoInput()
        if (shouldRunExportInteractive(flags, listArgs, interactiveAvailable)) {
          await runExportWizard()
          return
        }
        if (!hasExportRunSignal(flags, listArgs)) {
          usageError(
            'The export wizard needs an interactive terminal, and prompts are unavailable. Specify what to export instead — e.g. --all for every list, list names, --card picks, or filters.',
          )
          return
        }
        await runFlagExport(listArgs, type, flags)
      } catch (e) {
        emitError('runtime_error', getErrorMessage(e), textOptions, e)
        process.exitCode = ExitCode.RuntimeError
      }
    })
}
