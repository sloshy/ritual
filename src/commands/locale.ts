/**
 * The read-only `ritual locale` command: reports which precedence tier supplied
 * the active UI locale.
 *
 * The resolver itself lives in `src/cli/locale.ts`. The command's entire purpose
 * is to say *which tier won*, so it reads {@link currentUiLocaleResolution} —
 * the same resolver the boot sequence used — rather than re-deriving an answer
 * that could disagree.
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

import { Option, type Command } from 'commander'
import { applyConfigSet } from '../config/config-fields'
import {
  probeOsLocale,
  type LocaleEnv,
  type LocaleProbe,
  type LocaleProbeReport,
} from '../i18n/detect'
import { matchLocale } from '../i18n/negotiate'
import { t } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'
import { promptsUnavailableReason } from '../util/no-input'
import { loadRitualConfig, saveRitualConfig } from '../config/ritual-config'
import type { CardLanguage } from '../card/card-language'
import { ask } from '../cli/prompts'
import { addScriptingOptions } from '../cli/options'
import {
  canPromptWithOutput,
  emitOutput,
  normalizeScriptingOptions,
  emitWarnings,
  type ScriptingOptions,
} from '../cli/output'
import {
  currentUiLocaleResolution,
  LOCALE_ENV_VAR,
  type IgnoredLocale,
  type LocaleSource,
} from '../cli/locale'

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
