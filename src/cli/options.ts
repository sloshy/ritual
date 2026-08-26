/**
 * The shared commander option registrations and argParsers: every flag that
 * more than one command spells (`--output`, `--quiet`, `--dry-run`, `--fields`,
 * `--refresh`, `--sell-mode`, `--sync-printings`) is declared exactly once here
 * so its spelling, help text and parse rule cannot drift between commands.
 */

import { InvalidArgumentError, type Command } from 'commander'
import { setSiteSellModeOverride } from '../config/ritual-config'
import { parsePositiveInteger } from '../util/parse-number'
import { REFRESH_MODES, type RefreshMode } from '../cache/refresh'
import { t } from '../i18n/t'
import { parseEnumField } from '../util/parse-enum'
import { OUTPUT_FORMATS, parseFields, type CsvOutputFormat, type OutputFormat } from './output'

/**
 * Commander argParser body for an enum-valued flag: match the value against
 * `values` case-insensitively and reject anything else with the shared
 * `Invalid <label> '<value>'. Use one of: ...` message.
 *
 * The rule itself lives in `src/util/parse-enum.ts` so the HTTP handlers accept
 * exactly the same spellings; this wrapper only converts the refusal into the
 * exception commander expects from an argParser.
 */
export function parseEnumFlag<T extends string>(
  value: string,
  values: readonly T[],
  label: string,
): T {
  const parsed = parseEnumField(value, values, label)
  if (!parsed.ok) throw new InvalidArgumentError(parsed.message)
  return parsed.value
}

/** Commander argParser for port options: reject non-numeric and out-of-range values at parse time. */
export function parsePort(value: string): number {
  const port = parsePositiveInteger(value)
  if (port === undefined || port > 65535) {
    throw new InvalidArgumentError(t('errors.scripting.portRange'))
  }
  return port
}

/** Register the shared `--output` and `--quiet` pair. */
export function addScriptingOptions(
  command: Command,
  defaultOutput: OutputFormat = 'text',
): Command {
  return addQuietOption(addOutputOption(command, OUTPUT_FORMATS, defaultOutput))
}

/**
 * Register `--output` alone, for a command whose entire output *is* its payload
 * (plus warnings that must survive anyway) and therefore has no non-essential
 * chatter for `--quiet` to suppress — `card`, `diff`, `scry`, `skills list`,
 * `cache status`, `dep-license`, `history`. Registering an inert `--quiet`
 * there would advertise a behavior the command does not have.
 *
 * The overloads keep the widened vocabulary honest: a command with an extra
 * `--output` value (`scry --output csv`) passes its own value list and default,
 * and everything else gets the shared `text|json|ndjson` set.
 */
export function addOutputOption(command: Command): Command
export function addOutputOption<T extends string>(
  command: Command,
  formats: readonly T[],
  defaultOutput: T,
): Command
export function addOutputOption(
  command: Command,
  formats: readonly string[] = OUTPUT_FORMATS,
  defaultOutput: string = 'text',
): Command {
  return command.option(
    '--output <format>',
    t('help.global.output', { formats: formats.join(', ') }),
    (value) => parseEnumFlag(value, formats, 'output format'),
    defaultOutput,
  )
}

/** Register the shared `--quiet` flag with the repo-wide convention's wording. */
export function addQuietOption(command: Command): Command {
  return command.option('--quiet', t('help.global.quiet'), false)
}

/** The option attribute {@link addDryRunOption} registers. */
export type DryRunOptions = { dryRun?: boolean }

/** How {@link addDryRunOption} spells the flag. */
export type DryRunFlagOptions = {
  /** Also register the `-n` short form (the default); `false` registers `--dry-run` alone. */
  short?: boolean
}

/** Register the shared `--dry-run` flag (`-n, --dry-run` by default) with a command-specific description. */
export function addDryRunOption(
  command: Command,
  description: string,
  { short = true }: DryRunFlagOptions = {},
): Command {
  return command.option(short ? '-n, --dry-run' : '--dry-run', description)
}

/** Register the shared `--fields <list>` projection flag for json/ndjson output. */
export function addFieldsOption(command: Command): Command {
  return command.option('--fields <list>', t('help.global.fields'), parseFields)
}

// ── --refresh <mode> ───────────────────────────────────────────────────────

/**
 * The flag's commander attribute name. Exported so `serve`'s build-only-flags
 * guard can exempt it without restating the string.
 */
export const REFRESH_OPTION_NAME = 'refresh'

/** Parse a `--refresh <mode>` value, rejecting anything but the four modes. */
export function parseRefreshFlag(value: string): RefreshMode {
  return parseEnumFlag(value, REFRESH_MODES, 'refresh mode')
}

/**
 * Register the shared `--refresh <mode>` option (default `ask`). Every command
 * that touches card-cache freshness uses this so the vocabulary never drifts.
 * (The `cache feed` subcommands' unrelated `--refresh <interval>` is not this.)
 *
 * `description` overrides the help text for commands where `ask` does not mean
 * "skip when prompts are unavailable" — `collection-sync`'s CSV-upload gate
 * fails the run instead, and `build-site`'s empty/stale-cache bulk download
 * runs without asking. A command whose help describes the wrong behavior is
 * worse than no help.
 */
export function addRefreshOption(command: Command, description?: string): Command {
  return command.option(
    '--refresh <mode>',
    description ?? t('help.option.refresh'),
    parseRefreshFlag,
    'ask' satisfies RefreshMode,
  )
}

/**
 * Structured output must stay parseable, so never mix prompts into it: an
 * unanswerable `ask` refresh downgrades to `never`. `output` is the command's
 * `--output` value — anything but `text` is structured (json, ndjson, csv).
 */
export function resolveRefreshMode(refresh: RefreshMode, output: CsvOutputFormat): RefreshMode {
  return output !== 'text' && refresh === 'ask' ? 'never' : refresh
}

// ── --sell-mode ────────────────────────────────────────────────────────────
//
// One registration, one application rule, for every command that can turn sell
// mode on for its own run. The flag exists on `build-site`, `serve`, `admin`
// and `mcp`, and the rule it applies (enable-only, set before *anything* reads
// sell mode) is subtle enough that four hand-written copies were already
// drifting. The help text stays a per-command `t()` key: the commands describe
// genuinely different consequences of the same switch.

/**
 * The flag's commander attribute name. Exported so `serve`'s build-only-flags
 * guard can exempt it without restating the string.
 */
export const SELL_MODE_OPTION_NAME = 'sellMode'

/** The parsed shape every command that registers the flag receives. */
export type SellModeOptions = {
  sellMode?: boolean
}

/**
 * Register `--sell-mode` on a command. `helpText` is the command's own already
 * translated description of what enabling it does there.
 */
export function addSellModeOption(command: Command, helpText: string): Command {
  return command.option('--sell-mode', helpText)
}

/**
 * Apply a run's `--sell-mode` to the session.
 *
 * Enable-only: an absent flag leaves whatever the config (or an outer
 * `serve`/`admin` run) decided, so this can never turn sell mode *off*. Call it
 * as the first thing in the action body — the buylist warm, the build, and
 * every request's `getSiteSellMode` read all follow the override.
 */
export function applySellModeOverride(options: SellModeOptions): void {
  if (options.sellMode === true) setSiteSellModeOverride(true)
}

// ── --sync-printings / --no-sync-printings ─────────────────────────────────

/**
 * The negatable `--sync-printings` / `--no-sync-printings` pair every
 * URL-importing command registers (`import`, `import-account`), declared once
 * so the spellings, help text, and — above all — the tri-state read cannot
 * drift. (`deck-sync --sync-printings` is deliberately not this pair: it is a
 * positive-only flag with a `false` default and no prompt.)
 */
export type SyncPrintingsOptions = {
  /**
   * `--sync-printings` (true) / `--no-sync-printings` (false); absent when
   * neither flag was given — commander only defaults a `--no-x` flag to true
   * when the positive flag is NOT also declared, and here it is. Read the
   * answer through {@link readSyncPrintingsFlag} rather than off this field,
   * so a `.default()` added to the pair later cannot silently swallow the
   * prompt path.
   */
  syncPrintings?: boolean
}

/** Register the pair on a command; the option key is `syncPrintings`. */
export function addSyncPrintingsOptions(command: Command): Command {
  return command
    .option('--sync-printings', t('help.import.syncPrintings'))
    .option('--no-sync-printings', t('help.import.noSyncPrintings'))
}

/**
 * The tri-state the pair encodes: `true`/`false` when a flag was given on the
 * command line, `undefined` when neither was — which is what sends
 * `resolveImportPrintings` down its prompt path. With both flags declared the
 * pair currently has no default, so the field alone would do — the
 * `getOptionValueSource` check is what keeps this correct should the pair
 * ever gain one.
 */
export function readSyncPrintingsFlag(
  command: Command,
  options: SyncPrintingsOptions,
): boolean | undefined {
  return command.getOptionValueSource('syncPrintings') === 'cli' ? options.syncPrintings : undefined
}
