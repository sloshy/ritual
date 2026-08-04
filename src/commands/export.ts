import path from 'node:path'
import type { Command } from 'commander'
import { countLabel } from '../editor/change-bundle'
import { isFinish, VALID_CONDITIONS, VALID_FINISHES } from '../finish-condition'
import { type ListType } from '../list-type'
import {
  buildExportSelection,
  hasActiveExportFilters,
  parseConditionFilterValues,
  type ExportFilters,
} from '../export/entries'
import {
  describeExportProperties,
  EXPORT_DIALECTS,
  isExportDialect,
  parseColumnsFlag,
  type ExportDialect,
  type ExportProperty,
} from '../export/render'
import {
  EXPORT_FORMATS,
  exportFormatUsesColumns,
  exportPresetNames,
  findExportPreset,
  resolveExportSettings,
  type ExportFormat,
  type ExportPreset,
} from '../export/presets'
import { renderExport, saveExportPreset } from '../export/output'
import { listLocations, listTypeFromFlags, type ListLocation } from '../resolve-list'
import { isListArgumentsFailure, resolveListArguments } from './list-arguments'
import { getExportPresets } from '../ritual-config'
import { promptsUnavailable } from '../no-input'
import {
  addQuietOption,
  emitActionError,
  emitError,
  emitResolveListError,
  emitToFileOrStdout,
  emitWarnings,
  ExitCode,
  parseEnumFlag,
  type ScriptingOptions,
} from './scripting'
import { runExportWizard } from './export-wizard'

/** Raw commander option values; format/columns/finish/condition are validated in the action. */
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
  /** The `--format <format>` export format, validated by its argParser. */
  format?: ExportFormat
  columns?: string
  dialect?: string
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
  dialect?: ExportDialect
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
  if (flags.dialect || flags.out || flags.preset || flags.savePreset) return true
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

  let columns: ExportProperty[] | undefined
  if (options.columns !== undefined) {
    const parsed = parseColumnsFlag(options.columns)
    if (typeof parsed === 'string') {
      usageError(parsed)
      return undefined
    }
    columns = parsed
  }

  let dialect: ExportDialect | undefined
  if (options.dialect !== undefined) {
    const lower = options.dialect.toLowerCase()
    if (!isExportDialect(lower)) {
      usageError(`Invalid dialect '${options.dialect}'. Use one of: ${EXPORT_DIALECTS.join(', ')}.`)
      return undefined
    }
    dialect = lower
  }

  const format = options.format

  // The column/CSV-shape flags conflict with an explicit fixed-line format.
  // Only explicit flags conflict — a preset whose stored columns accompany a
  // text/md format is fine (the columns are simply unused).
  if (format !== undefined && !exportFormatUsesColumns(format)) {
    const conflicting: string[] = []
    if (options.columns !== undefined) conflicting.push('--columns')
    if (!options.header) conflicting.push('--no-header')
    if (options.quoteAll) conflicting.push('--quote-all')
    if (options.dialect !== undefined) conflicting.push('--dialect')
    if (conflicting.length > 0) {
      usageError(
        `${conflicting.join(' and ')} cannot be combined with --format ${format}: ${format} exports have a fixed line format. Columns, CSV options, and the value dialect apply to csv/json output only.`,
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
    dialect,
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
    const saved = getExportPresets()
    preset = findExportPreset(flags.preset, saved)
    if (!preset) {
      emitError(
        'not_found',
        `No export preset named '${flags.preset}'. Available presets: ${exportPresetNames(saved).join(', ')}.`,
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
    dialect: flags.dialect,
  })

  // Selected lists: named args, or every list in scope when --all (or nothing) was given.
  // A `deck:`/`collection:`/`wanted:` prefix supplies the type; one that
  // contradicts the whole-command type flag is a usage error, not a silent
  // override of the flag. `export` takes any number of list arguments, so the
  // whole-command type flags cannot scope one of them — the prefix can.
  const resolvedArgs = await resolveListArguments(listArgs, type)
  if (isListArgumentsFailure(resolvedArgs)) {
    if (resolvedArgs.kind === 'conflict') {
      emitError('usage_error', resolvedArgs.message, textOptions)
      process.exitCode = ExitCode.UsageError
    } else {
      emitResolveListError(resolvedArgs.error, textOptions, 'type-prefix')
    }
    return
  }
  const selected: ListLocation[] = []
  for (const resolved of resolvedArgs) {
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
  // A skipped card line (or a card term that matched nothing) means the export
  // is missing cards, so these always reach stderr — `--quiet` silences
  // confirmations, never a signal that content was lost.
  emitWarnings(
    selection.warnings.map((warning) => `⚠️  ${warning}`),
    { output: 'text', quiet },
    { essential: true },
  )

  if (flags.savePreset !== undefined) {
    await saveExportPreset(flags.savePreset, settings)
    if (!quiet) console.log(`✓ Saved export preset '${flags.savePreset}'`)
  }

  const rendered = await renderExport(selection.entries, settings)
  emitWarnings(
    rendered.warnings.map((warning) => `⚠️  ${warning}`),
    { output: 'text', quiet },
    { essential: true },
  )

  await emitExport(rendered.content, selection.entries.length, flags.out, quiet)
}

export function registerExportCommand(program: Command): void {
  addQuietOption(
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
      // Validated by the shared argParser, but deliberately given no commander
      // default: `undefined` must keep meaning "not given" so a preset's stored
      // format can fill it in (tri-state precedence).
      .option(
        '--format <format>',
        `Export format: ${EXPORT_FORMATS.join(', ')} (default: csv)`,
        (value: string) => parseEnumFlag(value, EXPORT_FORMATS, 'export format'),
      )
      .option(
        '--columns <list>',
        `Comma-separated columns in output order (csv/json only). Available: ${describeExportProperties()}`,
      )
      .option(
        '--dialect <name>',
        `Value spellings for finish and condition (csv/json only): ${EXPORT_DIALECTS.join(', ')} (default: ritual)`,
      )
      .option('--no-header', 'Omit the CSV header row')
      .option('--quote-all', 'Quote every CSV cell instead of only cells that need it')
      .option('--out <file>', 'Write to this file instead of stdout')
      .option(
        '--preset <name>',
        'Export with a saved or built-in preset (explicit flags override its values)',
      )
      .option('--save-preset <name>', 'Save the resolved format/columns/CSV options as a preset'),
  ).action(async (listArgs: string[], options: ExportCommandOptions) => {
    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      usageError('Use only one of --deck, --collection, or --wanted.')
      return
    }

    const flags = parseExportFlags(options)
    if (!flags) return

    try {
      const interactiveAvailable = process.stdout.isTTY === true && !promptsUnavailable()
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
      emitActionError(e, textOptions)
    }
  })
}
