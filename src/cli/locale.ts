/**
 * UI locale resolution for the CLI: the two boot passes and the resolver they
 * share. The read-only `ritual locale` command that *reports* the outcome lives
 * in `src/commands/locale.ts` and reads {@link currentUiLocaleResolution}, so it
 * can never disagree with the resolver the boot sequence used.
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
 */

import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { resolveStringOverride } from '../config/env-override'
import { prescanArgs } from '../i18n/argv-prescan'
import { prereadUiLocale } from '../i18n/config-preread'
import { detectOsLocale, type LocaleEnv } from '../i18n/detect'
import { matchLocale } from '../i18n/negotiate'
import { DEFAULT_LOCALE, loadDictionary, loadedLocales, setLocale } from '../i18n/runtime'
import { t } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'
import { bakedDictionaries } from '../generated/locales'
import { isConfigParseError, parseUiLocale } from '../config/ritual-config'

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
