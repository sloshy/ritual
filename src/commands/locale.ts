/**
 * UI locale resolution for the CLI, plus the read-only `ritual locale` command
 * that reports it.
 *
 * Resolution and reporting live together because they are one piece of
 * knowledge: the command's entire purpose is to say *which tier won*, so it must
 * read the same resolver the boot sequence used rather than re-deriving an
 * answer that could disagree.
 *
 * The boot sequence has two passes, deliberately:
 *
 * 1. {@link initI18n} runs before Commander's tree is built. Every
 *    `.description()` / `.option()` string is evaluated at registration time, so
 *    a locale resolved in `preAction` would arrive after `--help` has already
 *    rendered. It has no parsed options and no loaded config, so it works from
 *    `src/i18n/argv-prescan.ts` and `src/i18n/config-preread.ts` — both tolerant,
 *    neither authoritative.
 * 2. {@link applyCliLocale} runs in the root `preAction` hook, once `--base-dir`
 *    has been applied and the flag has been validated by its argParser. This is
 *    the authoritative pass; a value the pre-scan misread can at worst have
 *    rendered help in the wrong language.
 *
 * Precedence: `--locale` → `RITUAL_LOCALE` → `uiLocale` → OS detection → `en`.
 *
 * `ritual locale` never touches list files and must never trigger the card-ID
 * backfill. It does not: `COMMANDS_WITH_ID_BACKFILL` is an allowlist and this
 * command is not on it — the same classification `config set` has, which also
 * writes `ritual.config.json` and no card line. `--detect` is the only path
 * here that writes anything, and only after the user says yes.
 *
 * Deliberately **not** an admin route and **not** an MCP tool. What it reports is
 * *this process's* resolution trail — which of `--locale` / `RITUAL_LOCALE` /
 * `uiLocale` / OS detection won, and which dictionaries this binary was built
 * with — which is per-invocation process state, not workspace state. An MCP
 * client asking for it would get a trail describing the server's process rather
 * than its own; the part a client can act on is the persisted `uiLocale`, which
 * `get_config` already carries.
 */

import path from 'node:path'
import { Option, type Command } from 'commander'
import { getBaseDir } from '../config/base-dir'
import { applyConfigSet } from '../config/config-fields'
import { resolveStringOverride } from '../config/env-override'
import { prescanArgs } from '../i18n/argv-prescan'
import { prereadUiLocale } from '../i18n/config-preread'
import {
  detectOsLocale,
  probeOsLocale,
  type LocaleEnv,
  type LocaleProbe,
  type LocaleProbeReport,
} from '../i18n/detect'
import { matchLocale } from '../i18n/negotiate'
import { DEFAULT_LOCALE, loadDictionary, loadedLocales, setLocale } from '../i18n/runtime'
import { t } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'
import { bakedDictionaries } from '../generated/locales'
import { promptsUnavailableReason } from '../util/no-input'
import {
  isConfigParseError,
  loadRitualConfig,
  parseUiLocale,
  saveRitualConfig,
} from '../config/ritual-config'
import type { CardLanguage } from '../card/card-language'
import { ask } from './prompts-helpers'
import {
  addScriptingOptions,
  canPromptWithOutput,
  emitOutput,
  emitWarnings,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

/** The environment variable naming the UI locale — never the card language. */
export const LOCALE_ENV_VAR = 'RITUAL_LOCALE'

/**
 * Which precedence tier supplied the active UI locale. These are machine
 * contract values (they appear in `ritual locale --output json`) and are never
 * localized.
 */
export type LocaleSource = 'flag' | 'env' | 'config' | 'detected' | 'default'

/** Everything {@link resolveUiLocale} needs. Nothing is read ambiently. */
export type UiLocaleInput = {
  /** The `--locale` value, already validated when it came through the argParser. */
  flag?: string | undefined
  /** The raw `RITUAL_LOCALE` value. */
  env?: string | undefined
  /** The `uiLocale` value as it appears *in the config file*, not the defaulted one. */
  config?: string | undefined
  /** The OS-detected tag, or undefined when the environment names no language. */
  detected?: string | undefined
  /** The locales this build has dictionaries for. */
  available: readonly LocaleTag[]
}

/** A locale value that was present but unusable, and why it was skipped. */
export type IgnoredLocale = {
  source: LocaleSource
  value: string
  error: string
}

/** The resolved UI locale together with the trail that produced it. */
export type UiLocaleResolution = {
  locale: LocaleTag
  source: LocaleSource
  /** What the winning tier supplied, before canonicalization. Absent for `default`. */
  requested?: string
  /** The OS-detected tag, whether or not it won. */
  detected?: string
  /** Locales this build has dictionaries for, English first. */
  available: LocaleTag[]
  /** Values that were present but rejected, in precedence order. */
  ignored: IgnoredLocale[]
}

/**
 * Resolve the UI locale from the four override tiers. Pure: no environment
 * reads, no runtime mutation, no logging.
 *
 * A malformed value never fails the command — it is recorded in `ignored` and
 * the next tier is consulted. The `--locale` flag is the exception and is
 * rejected earlier, by its Commander argParser, with a usage error (exit 2);
 * degrading a flag the user typed by hand would hide a typo.
 *
 * Detection is negotiated against the shipped locales, unlike the explicit
 * tiers: an explicit tag is honored verbatim (per-key English fallback covers a
 * partial catalog), while a *detected* language nothing was shipped for means
 * the environment simply told us nothing usable.
 */
export function resolveUiLocale(input: UiLocaleInput): UiLocaleResolution {
  const available = [...input.available]
  const detected = input.detected?.trim() || undefined
  const ignored: IgnoredLocale[] = []

  function accept(locale: LocaleTag, source: LocaleSource, requested: string): UiLocaleResolution {
    return { locale, source, requested, detected, available, ignored }
  }

  // `--locale` beats `RITUAL_LOCALE`, blank counts as unset — the precedence
  // rule every string-valued global option shares.
  const override = resolveStringOverride(input.flag, input.env)
  if (override !== undefined) {
    const source: LocaleSource = (input.flag?.trim() ?? '') === '' ? 'env' : 'flag'
    const parsed = parseUiLocale(override)
    if (!isConfigParseError(parsed)) return accept(parsed, source, override)
    ignored.push({ source, value: override, error: parsed.error })
  }

  const configured = input.config?.trim() || undefined
  if (configured !== undefined) {
    const parsed = parseUiLocale(configured)
    if (!isConfigParseError(parsed)) return accept(parsed, 'config', configured)
    ignored.push({ source: 'config', value: configured, error: parsed.error })
  }

  if (detected !== undefined) {
    const parsed = parseUiLocale(detected)
    if (isConfigParseError(parsed)) {
      ignored.push({ source: 'detected', value: detected, error: parsed.error })
    } else {
      // `matchLocale` reports "nothing matched" as `undefined`, which is what
      // keeps the reported source honest: an environment naming a language this
      // build cannot render must fall through to `default`, not be credited with
      // having chosen English.
      const matched = matchLocale([parsed], available)
      if (matched !== undefined) return accept(matched, 'detected', detected)
    }
  }

  return { locale: DEFAULT_LOCALE, source: 'default', detected, available, ignored }
}

/**
 * Register the dictionaries baked into this build.
 *
 * `src/generated/locales.ts` is a plain data module written by
 * `scripts/generate-locales.ts` (the `dep-licenses.ts` precedent), so the
 * compiled binary carries its locales with no filesystem read and no dynamic
 * `import()` — neither of which survives `bun build --compile`. English is not
 * in it: it is inline in the catalog, so the default path is never a lookup
 * away.
 *
 * Idempotent, and empty in the default build (`RITUAL_BUNDLED_LOCALES=en` bakes
 * nothing extra), so it costs the shipping configuration nothing. It must run
 * before {@link loadedLocales} is consulted, because that is what tells the
 * resolver which locales this build can actually render.
 *
 * CLI-only: the browser fetches `locales/<tag>.json` instead, which is why this
 * import lives here rather than in `src/i18n/runtime.ts`.
 */
function loadBundledDictionaries(): void {
  for (const { tag, catalog } of bakedDictionaries) {
    loadDictionary(tag, catalog)
  }
}

/** The last resolution applied to the runtime, for `ritual locale` to report. */
let lastResolution: UiLocaleResolution | null = null

/**
 * The resolution currently in force. Falls back to a `default` report when
 * neither boot pass has run (a unit test importing this module directly).
 */
export function currentUiLocaleResolution(): UiLocaleResolution {
  return (
    lastResolution ?? {
      locale: DEFAULT_LOCALE,
      source: 'default',
      available: loadedLocales(),
      ignored: [],
    }
  )
}

/** Clear the recorded resolution. For tests. */
export function resetUiLocaleResolution(): void {
  lastResolution = null
}

/** Injectable process state, so both boot passes stay testable. */
export type LocaleBootEnvironment = {
  argv?: readonly string[]
  env?: LocaleEnv & Record<string, string | undefined>
  platform?: string
}

function osLocaleFor(
  env: LocaleEnv & Record<string, string | undefined>,
  platform: string,
  hasExplicitLocale: boolean,
  available: readonly LocaleTag[],
): string | undefined {
  return detectOsLocale({
    platform,
    env,
    hasExplicitLocale,
    bundledLocaleCount: available.length,
  })
}

/**
 * Resolve and apply the UI locale before Commander's tree is built, so help
 * text can be registered in the right language. Tolerant by construction: the
 * argv pre-scan never validates and the config pre-read never throws, because
 * this pass runs before the real parsers exist and must not preempt their
 * errors.
 *
 * Synchronous on purpose — the compiled binary forbids top-level await, and a
 * promise here would buy nothing: every input is a sync read.
 */
export function initI18n(boot: LocaleBootEnvironment = {}): UiLocaleResolution {
  const argv = boot.argv ?? process.argv
  const env = boot.env ?? process.env
  const platform = boot.platform ?? process.platform
  loadBundledDictionaries()
  const available = loadedLocales()

  const prescanned = prescanArgs(argv)
  // The config pre-read needs the base dir the run will actually use, which at
  // this point only the same tolerant sources can supply.
  const baseDir = resolveStringOverride(prescanned.baseDir, env.RITUAL_BASE_DIR)
  const configured = prereadUiLocale(path.resolve(baseDir ?? process.cwd()))
  const explicit = resolveStringOverride(prescanned.locale, env[LOCALE_ENV_VAR]) ?? configured

  const resolution = resolveUiLocale({
    flag: prescanned.locale,
    env: env[LOCALE_ENV_VAR],
    config: configured,
    detected: osLocaleFor(env, platform, explicit !== undefined, available),
    available,
  })
  setLocale(resolution.locale)
  lastResolution = resolution
  return resolution
}

/** What the authoritative pass gets from the parsed command line. */
export type CliLocaleOptions = {
  /** The `--locale` value, canonicalized by the flag's argParser. */
  flag?: string | undefined
} & LocaleBootEnvironment

/**
 * Re-resolve and apply the UI locale authoritatively, from the root `preAction`
 * hook — after `--base-dir` has been applied and the flag validated.
 *
 * The `uiLocale` tier is read from the config file rather than from the loaded
 * {@link RitualConfig}, because the loader defaults the key to `en` whether or
 * not the file names it, and "absent" must stay distinguishable from
 * "explicitly en": only the latter outranks OS detection.
 *
 * A malformed `RITUAL_LOCALE` warns and degrades rather than failing the
 * command. An unusable interface language is a cosmetic problem; refusing to
 * run over one would be worse than the misconfiguration.
 */
export function applyCliLocale(options: CliLocaleOptions = {}): UiLocaleResolution {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  // Idempotent, and repeated here so a caller that skipped `initI18n()` (the
  // admin/MCP servers reach `preAction` the same way, but a test may not) still
  // sees every locale this build ships.
  loadBundledDictionaries()
  const available = loadedLocales()
  const configured = prereadUiLocale(getBaseDir())
  const explicit = resolveStringOverride(options.flag, env[LOCALE_ENV_VAR]) ?? configured

  const resolution = resolveUiLocale({
    flag: options.flag,
    env: env[LOCALE_ENV_VAR],
    config: configured,
    detected: osLocaleFor(env, platform, explicit !== undefined, available),
    available,
  })
  setLocale(resolution.locale)
  lastResolution = resolution

  for (const entry of resolution.ignored) {
    // The config file's own complaint is already reported by the config loader,
    // and the flag never reaches here malformed.
    if (entry.source === 'env') {
      console.warn(t('cli.locale.envIgnored', { variable: LOCALE_ENV_VAR, error: entry.error }))
    }
  }
  return resolution
}

/** The `ritual locale --output json` payload. Keys and values are locale-invariant. */
export type LocaleReport = {
  /** The BCP-47 tag the interface is speaking. */
  uiLocale: LocaleTag
  /** Which precedence tier supplied it. */
  source: LocaleSource
  /** What that tier supplied, before canonicalization. Absent for `default`. */
  requested?: string
  /** Every locale this build can render. */
  availableLocales: LocaleTag[]
  /** What the OS environment named, whether or not it won. */
  detectedOsLocale?: string
  /** The card language — a different setting entirely. See `defaultLanguage`. */
  defaultLanguage: CardLanguage
  /** Values that were present but rejected. */
  ignored: IgnoredLocale[]
  /**
   * What each detection source said. Present only under `--detect`, because
   * only that flag pays for the subprocess probes.
   *
   * Deliberately separate from `detectedOsLocale`, which stays what the *run*
   * detected under the ordinary gates: a probe can answer where the gated path
   * declined to ask, and conflating the two would make the machine field mean
   * something different depending on a flag.
   */
  probes?: LocaleProbe[]
  /**
   * The tag `--detect` offers to persist, present only when the probes named a
   * usable language that differs from the active locale. Structured output
   * never prompts (prompt UI cannot share stdout with a JSON document), so for
   * a machine client this field *is* the offer: act on it with
   * `config set uiLocale`.
   */
  suggestedUiLocale?: LocaleTag
}

/**
 * How the winning tier is named in the text report.
 *
 * `--locale` and `RITUAL_LOCALE` name themselves — they are the literal spellings
 * the user typed — so only the three descriptive tiers reach the catalog.
 */
function sourceLabel(source: LocaleSource): string {
  switch (source) {
    case 'flag':
      return '--locale'
    case 'env':
      return LOCALE_ENV_VAR
    case 'config':
      return t('cli.locale.sourceConfig')
    case 'detected':
      return t('cli.locale.sourceDetected')
    case 'default':
      return t('cli.locale.sourceDefault')
  }
}

function renderLocaleText(report: LocaleReport): string {
  return [
    t('cli.locale.uiLocale', { locale: report.uiLocale, source: sourceLabel(report.source) }),
    t('cli.locale.available', { locales: report.availableLocales.join(', ') }),
    t('cli.locale.detected', { locale: report.detectedOsLocale ?? t('cli.locale.detectedNone') }),
    t('cli.locale.cardLanguage', { language: report.defaultLanguage }),
  ].join('\n')
}

/** How each probe source is named in the text report. */
function probeLabel(source: LocaleProbe['source']): string {
  switch (source) {
    case 'environment':
      return t('cli.locale.probeEnvironment')
    case 'windows':
      return t('cli.locale.probeWindows')
    case 'macos':
      return t('cli.locale.probeMacos')
  }
}

/** One probe finding as a line of the `--detect` block. */
function renderProbe(probe: LocaleProbe): string {
  const label = probeLabel(probe.source)
  const { origin } = probe
  // A probe that never ran has no command worth quoting, only a name.
  if (!probe.ran) return t('cli.locale.probeSkipped', { label })
  if (probe.raw === undefined) return t('cli.locale.probeNothing', { label, origin })
  if (probe.tag === undefined) {
    return t('cli.locale.probeUnusable', { label, origin, value: probe.raw })
  }
  return t('cli.locale.probeFound', { label, origin, value: probe.raw, locale: probe.tag })
}

/** The `--detect` block: every source's finding, headed. */
function renderProbes(probes: readonly LocaleProbe[]): string {
  return [t('cli.locale.probeHeader'), ...probes.map(renderProbe)].join('\n')
}

/**
 * Persist `uiLocale` through the same validation `config set` uses, so the two
 * write paths cannot disagree about what a settable value is.
 */
async function saveUiLocale(locale: LocaleTag): Promise<void> {
  const outcome = applyConfigSet(await loadRitualConfig(), 'uiLocale', [locale], 'replace')
  // Unreachable: the value is an already-parsed LocaleTag and `uiLocale` is a
  // known property. Throwing beats silently writing nothing if that ever changes.
  if ('error' in outcome) throw new Error(outcome.error)
  await saveRitualConfig(outcome.updatedConfig)
}

/**
 * The `--detect` epilogue: report what the probes found and, when they name a
 * different locale than the one in force, offer to persist it.
 *
 * Text output only. Structured output cannot share stdout with prompt UI, so a
 * machine client reads `suggestedUiLocale` from the payload instead — which is
 * also why this never writes anything without an explicit yes.
 */
async function offerDetectedLocale(
  report: LocaleReport,
  probeReport: LocaleProbeReport,
  scripting: ScriptingOptions,
): Promise<void> {
  emitOutput(`\n${renderProbes(probeReport.probes)}`, scripting)

  const detected = probeReport.tag
  if (detected === undefined) {
    emitOutput(t('cli.locale.detectNothing'), scripting)
    return
  }
  if (detected === report.uiLocale) {
    emitOutput(t('cli.locale.detectAgrees', { locale: detected }), scripting)
    return
  }

  emitOutput(
    t('cli.locale.detectDiffers', {
      locale: detected,
      current: report.uiLocale,
      source: sourceLabel(report.source),
    }),
    scripting,
  )
  // Honored verbatim like every explicit tier, but saying so up front is the
  // difference between "nothing happened" and "messages fall back to English".
  if (matchLocale([detected], report.availableLocales) === undefined) {
    emitOutput(t('cli.locale.detectNoDictionary', { locale: detected }), scripting)
  }

  if (!canPromptWithOutput(scripting)) {
    emitOutput(
      t('cli.locale.detectNoPrompt', {
        reason: promptsUnavailableReason(),
        command: `ritual config set uiLocale ${detected}`,
      }),
      scripting,
    )
    return
  }

  const accepted = await ask<boolean>({
    type: 'confirm',
    message: t('cli.locale.detectPrompt', { locale: detected }),
    subjectKey: 'cli.prompt.subject.uiLocale',
    initial: true,
  })
  if (accepted !== true) {
    emitOutput(t('cli.locale.detectDeclined'), scripting)
    return
  }
  await saveUiLocale(detected)
  emitOutput(t('cli.locale.detectSaved', { locale: detected }), scripting)
}

/**
 * The four POSIX variables detection reads, picked out of the process
 * environment. Picked rather than passed whole so the probe sees exactly the
 * inputs {@link LocaleEnv} documents.
 */
function localeEnv(env: Record<string, string | undefined>): LocaleEnv {
  return {
    LC_ALL: env.LC_ALL,
    LC_MESSAGES: env.LC_MESSAGES,
    LANGUAGE: env.LANGUAGE,
    LANG: env.LANG,
  }
}

/** The `locale` command's own options, beyond the shared scripting pair. */
type LocaleCommandOptions = {
  /** `--detect`: run the expensive OS probes and offer to persist the answer. */
  detect?: boolean
} & Partial<ScriptingOptions>

export function registerLocaleCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('locale')
      .description(t('help.locale.summary'))
      .addOption(new Option('--detect', t('help.locale.detect'))),
  ).action(async (options: LocaleCommandOptions) => {
    const scripting = normalizeScriptingOptions(options)
    const config = await loadRitualConfig()
    const resolution = currentUiLocaleResolution()
    // The probes are the one place in Ritual that spawns a subprocess for a
    // locale outside the gated hot path, and `--detect` is the only thing that
    // reaches them.
    const probeReport =
      options.detect === true
        ? probeOsLocale({ platform: process.platform, env: localeEnv(process.env) })
        : undefined
    const suggested =
      probeReport?.tag !== undefined && probeReport.tag !== resolution.locale
        ? probeReport.tag
        : undefined
    // `requested`, `detectedOsLocale`, `probes` and `suggestedUiLocale` may be
    // undefined; JSON.stringify drops them, which is exactly the "absent" the
    // type documents.
    const report: LocaleReport = {
      uiLocale: resolution.locale,
      source: resolution.source,
      requested: resolution.requested,
      availableLocales: resolution.available,
      detectedOsLocale: resolution.detected,
      defaultLanguage: config.defaultLanguage,
      ignored: resolution.ignored,
      probes: probeReport?.probes,
      suggestedUiLocale: suggested,
    }

    // Rejected values are the reason a user runs this command when the language
    // is not what they asked for, so they survive --quiet.
    emitWarnings(
      report.ignored.map((entry) =>
        t('cli.locale.ignoring', {
          source: sourceLabel(entry.source),
          value: entry.value,
          error: entry.error,
        }),
      ),
      scripting,
      { essential: true },
    )

    if (scripting.output !== 'text') {
      emitOutput(report, scripting)
      return
    }

    // The report is the command's entire point, so it prints even under --quiet;
    // only the explanatory footer is chatter.
    emitOutput(renderLocaleText(report), scripting)
    // The probe findings are what `--detect` was run for, so they outrank the
    // footer and print under --quiet too.
    if (probeReport !== undefined) {
      await offerDetectedLocale(report, probeReport, scripting)
    }
    if (!scripting.quiet) {
      emitOutput(`\n${t('cli.locale.footer')}`, scripting)
    }
  })
}
