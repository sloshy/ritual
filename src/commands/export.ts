import path from 'node:path'
import type { Command } from 'commander'
import { describeExportProperties } from '../pricing/export-hints'
import { isFinish, VALID_CONDITIONS, VALID_FINISHES } from '../card/finish-condition'
import { CARD_LABEL_SELECTION_NONE, CARD_LABELS } from '../card/card-labels'
import { type ListType } from '../list/list-type'
import {
  buildExportSelection,
  hasActiveExportFilters,
  parseConditionFilterValues,
  parseLabelFilterValues,
  type ExportFilters,
} from '../export/entries'
import {
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
import { listLocations, listTypeFromFlags, type ListLocation } from '../list/resolve-list'
import { isListArgumentsFailure, resolveListArguments } from './list-arguments'
import { getExportPresets } from '../config/ritual-config'
import { promptsUnavailable } from '../util/no-input'
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
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

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
  labels?: string
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

function usageError(message: string, messageKey?: MessageKey): void {
  emitError('usage_error', message, textOptions, undefined, messageKey)
  process.exitCode = ExitCode.UsageError
}

/** Validate the raw filter/format/column flag strings, or report and return undefined. */
function parseExportFlags(options: ExportCommandOptions): ParsedExportFlags | undefined {
  const filters: ExportFilters = { name: options.name, set: options.set }
  if (options.finish !== undefined) {
    const finish = options.finish.toLowerCase()
    if (!isFinish(finish)) {
      usageError(
        t('errors.enum.invalid', {
          field: 'finish',
          value: options.finish,
          choices: VALID_FINISHES.join(', '),
        }),
        'errors.enum.invalid',
      )
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
  if (options.labels !== undefined) {
    const labels = parseLabelFilterValues(
      options.labels
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    )
    if (typeof labels === 'string') {
      usageError(labels)
      return undefined
    }
    filters.labels = labels
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
      usageError(
        t('errors.enum.invalid', {
          field: 'dialect',
          value: options.dialect,
          choices: EXPORT_DIALECTS.join(', '),
        }),
        'errors.enum.invalid',
      )
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
        t('cli.export.formatFlagConflict', { flags: conflicting.join(' and '), format }),
        'cli.export.formatFlagConflict',
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
      file: (target) =>
        `✓ ${t('cli.export.exportedToFile', {
          cards: t('domain.count.cards', { count: entryCount }),
          target,
        })}`,
      // Keep stdout parseable: the stdout-mode confirmation goes to stderr.
      stdout: t('cli.export.exportedToStdout', {
        cards: t('domain.count.cards', { count: entryCount }),
      }),
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
        t('cli.export.unknownPreset', {
          name: flags.preset,
          available: exportPresetNames(saved).join(', '),
        }),
        textOptions,
        undefined,
        'cli.export.unknownPreset',
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
    if (!quiet) console.log(`✓ ${t('cli.export.savedPreset', { name: flags.savePreset })}`)
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
      .description(t('help.export.description'))
      .argument('[lists...]', t('help.export.lists'))
      .option('--deck', t('help.export.deck'))
      .option('--collection', t('help.export.collection'))
      .option('--wanted', t('help.export.wanted'))
      .option('--all', t('help.export.all'))
      .option(
        '--card <terms>',
        t('help.export.card'),
        (value: string, previous: string[]) => [...previous, value],
        [] as string[],
      )
      .option('--name <terms>', t('help.export.name'))
      .option('--set <code>', t('help.export.set'))
      .option('--finish <finish>', t('help.export.finish', { finishes: VALID_FINISHES.join(', ') }))
      .option(
        '--condition <list>',
        t('help.export.condition', { conditions: VALID_CONDITIONS.join(', ') }),
      )
      .option(
        '--labels <list>',
        t('help.export.labels', {
          labels: CARD_LABELS.join(', '),
          none: CARD_LABEL_SELECTION_NONE,
        }),
      )
      // Validated by the shared argParser, but deliberately given no commander
      // default: `undefined` must keep meaning "not given" so a preset's stored
      // format can fill it in (tri-state precedence).
      .option(
        '--format <format>',
        t('help.export.format', { formats: EXPORT_FORMATS.join(', ') }),
        (value: string) => parseEnumFlag(value, EXPORT_FORMATS, 'export format'),
      )
      .option(
        '--columns <list>',
        t('help.export.columns', { properties: describeExportProperties() }),
      )
      .option(
        '--dialect <name>',
        t('help.export.dialect', { dialects: EXPORT_DIALECTS.join(', ') }),
      )
      .option('--no-header', t('help.export.noHeader'))
      .option('--quote-all', t('help.export.quoteAll'))
      .option('--out <file>', t('help.export.out'))
      .option('--preset <name>', t('help.export.preset'))
      .option('--save-preset <name>', t('help.export.savePreset')),
  ).action(async (listArgs: string[], options: ExportCommandOptions) => {
    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      usageError(t('cli.export.oneTypeFlag'), 'cli.export.oneTypeFlag')
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
        usageError(t('cli.export.wizardNeedsTerminal'), 'cli.export.wizardNeedsTerminal')
        return
      }
      await runFlagExport(listArgs, type, flags)
    } catch (e) {
      emitActionError(e, textOptions)
    }
  })
}
