/**
 * OS locale detection. CLI-only — the browser has `navigator.languages` and
 * never imports this module.
 *
 * Bun resolves no locale from the environment (with `LANG=de_DE.UTF-8`,
 * `new Intl.DateTimeFormat().resolvedOptions().locale` is still `en-US` and
 * `navigator.language` is `undefined`), so Ritual reads the environment itself
 * and hands an explicit BCP-47 tag to every `Intl` constructor.
 *
 * The environment and the platform are **parameters**, never read ambiently
 * inside the pure functions here, so detection is table-testable without
 * mutating `process.env`.
 */

import { execFileSync } from 'node:child_process'
import { isLocaleTagError, parseLocaleTag } from './locale-tag'
import type { LocaleTag } from './types'

/** The subset of the process environment locale detection reads. */
export type LocaleEnv = {
  LC_ALL?: string | undefined
  LC_MESSAGES?: string | undefined
  LANGUAGE?: string | undefined
  LANG?: string | undefined
}

/** Everything {@link detectOsLocale} needs, injected so nothing is read ambiently. */
export type LocaleDetectionOptions = {
  /** `process.platform` — `'win32'` enables the PowerShell probe. */
  platform: string
  /** The environment to read the POSIX locale chain from. */
  env: LocaleEnv
  /**
   * Whether an explicit value already won at a higher tier (`--locale`,
   * `RITUAL_LOCALE`, `uiLocale`). Detection is only consulted when nothing did,
   * and the expensive Windows probe is gated on it.
   */
  hasExplicitLocale?: boolean
  /**
   * How many locales this build actually ships. An English-only build has
   * nothing to switch to, so it never pays for the probe — the shipping
   * configuration's startup cost is exactly zero.
   */
  bundledLocaleCount?: number
  /** The Windows UI-culture probe, injected for tests. */
  probeWindows?: () => string | undefined
  /** The macOS `AppleLocale` probe, injected for tests. */
  probeMacos?: () => string | undefined
}

/**
 * POSIX locale values that name *no language*. `C.UTF-8` is the default in most
 * containers and on plenty of developer machines, so treating it as a language
 * would mean detecting "English" for a user who simply has no locale set. They
 * fall through to the next source instead.
 */
function isPosixCLocale(value: string): boolean {
  const base = value.split('.')[0]?.trim().toUpperCase() ?? ''
  return base === 'C' || base === 'POSIX'
}

/** `@modifier` suffixes that carry a script, mapped to their ISO 15924 code. */
const SCRIPT_MODIFIERS: Record<string, string> = {
  latin: 'Latn',
  cyrillic: 'Cyrl',
}

/**
 * Convert a POSIX locale value (`ll_CC.CODESET@modifier`) to a canonical BCP-47
 * tag, or `undefined` when it names no language. `sr_RS@latin` → `sr-Latn-RS`,
 * `de_DE.UTF-8` → `de-DE`, `zh_CN.GB18030` → `zh-CN`, `C.UTF-8` → `undefined`.
 */
export function normalizePosixLocale(value: string): LocaleTag | undefined {
  const trimmed = value.trim()
  if (trimmed === '' || isPosixCLocale(trimmed)) return undefined

  const [beforeModifier = '', modifier = ''] = splitOnce(trimmed, '@')
  const [beforeCodeset = ''] = splitOnce(beforeModifier, '.')
  const parts = beforeCodeset.split(/[_-]/).filter((part) => part !== '')
  const language = parts[0]
  if (language === undefined) return undefined

  const script = SCRIPT_MODIFIERS[modifier.toLowerCase()]
  const region = parts[1]
  // Unknown modifiers (`@euro`, `@valencia`) carry no BCP-47 meaning and are dropped.
  const tag = [language, script, region].filter((part) => part !== undefined).join('-')

  const parsed = parseLocaleTag(tag)
  return isLocaleTagError(parsed) ? undefined : parsed
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator)
  if (index === -1) return [value, '']
  return [value.slice(0, index), value.slice(index + separator.length)]
}

/**
 * The effective POSIX locale — what `setlocale` would resolve to, ignoring
 * `LANGUAGE`. GNU gettext suppresses `LANGUAGE` entirely when this is `C` or
 * `POSIX`, because a user who asked for the C locale asked for untranslated
 * output.
 */
function effectivePosixValue(env: LocaleEnv): string | undefined {
  return firstNonEmpty([env.LC_ALL, env.LC_MESSAGES, env.LANG])
}

function firstNonEmpty(values: readonly (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

/**
 * The POSIX chain, in precedence order: `LC_ALL`, `LC_MESSAGES`, `LANGUAGE`,
 * `LANG`. A value naming no language (`C`, `POSIX`, `C.UTF-8`) or failing
 * BCP-47 validation is skipped rather than accepted, so detection falls through
 * to the next source instead of pinning English.
 *
 * `LANGUAGE` is GNU's colon-separated *priority list* (`ja:de`) and applies to
 * messages only; its first usable entry wins. It is ignored outright when the
 * effective locale is `C`/`POSIX`.
 */
export function detectPosixLocale(env: LocaleEnv): LocaleTag | undefined {
  return matchPosixLocale(env)?.tag
}

/** One entry of the POSIX chain, kept beside the variable that supplied it. */
type PosixCandidate = {
  variable: keyof LocaleEnv
  value: string
}

/** The POSIX chain flattened into candidates, in precedence order. */
function posixCandidates(env: LocaleEnv): PosixCandidate[] {
  const effective = effectivePosixValue(env)
  const languageSuppressed = effective !== undefined && isPosixCLocale(effective)

  const candidates: PosixCandidate[] = []
  const push = (variable: keyof LocaleEnv, value: string | undefined): void => {
    const trimmed = value?.trim()
    if (trimmed) candidates.push({ variable, value: trimmed })
  }
  push('LC_ALL', env.LC_ALL)
  push('LC_MESSAGES', env.LC_MESSAGES)
  if (!languageSuppressed) {
    for (const entry of env.LANGUAGE?.split(':') ?? []) push('LANGUAGE', entry)
  }
  push('LANG', env.LANG)
  return candidates
}

/** The winning POSIX candidate together with the variable it came from. */
type PosixMatch = PosixCandidate & { tag: LocaleTag }

function matchPosixLocale(env: LocaleEnv): PosixMatch | undefined {
  for (const candidate of posixCandidates(env)) {
    const tag = normalizePosixLocale(candidate.value)
    if (tag !== undefined) return { ...candidate, tag }
  }
  return undefined
}

/**
 * The command each OS probe spawns, quoted as the user would type it. Reported
 * verbatim by `ritual locale --detect` so "where did this come from" needs no
 * guessing, and never translated: it is a command line, not prose.
 */
export const WINDOWS_PROBE_COMMAND =
  'powershell -NoProfile -NonInteractive -Command "[Globalization.CultureInfo]::CurrentUICulture.Name"'
export const MACOS_PROBE_COMMAND = 'defaults read -g AppleLocale'

/**
 * Run a probe command and return its trimmed stdout, or `undefined` when it
 * fails, times out, or prints nothing. A probe never throws: an unanswered
 * question about the OS locale is a missing signal, not an error.
 */
function runProbe(command: string, args: readonly string[]): string | undefined {
  try {
    const output = execFileSync(command, [...args], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Ask Windows for the user's UI culture. Memoized: `cmd`/PowerShell set no
 * `LANG`, and Bun exposes no `GetUserDefaultLocaleName`, so a subprocess is the
 * only route — and it must be paid for at most once, and only under the gate in
 * {@link detectOsLocale} (or explicitly, from `ritual locale --detect`).
 */
let windowsProbeResult: string | undefined
let windowsProbeRan = false

export function probeWindowsUiCulture(): string | undefined {
  if (windowsProbeRan) return windowsProbeResult
  windowsProbeRan = true
  windowsProbeResult = runProbe('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '[Globalization.CultureInfo]::CurrentUICulture.Name',
  ])
  return windowsProbeResult
}

/**
 * Ask macOS for the user's system locale (`en_GB`, `de_DE`, occasionally
 * `zh-Hans_US`). Memoized and gated exactly like the Windows probe: an
 * interactive macOS terminal sets the POSIX variables, so this only ever
 * answers for the shells and launch contexts that do not.
 */
let macosProbeResult: string | undefined
let macosProbeRan = false

export function probeMacosLocale(): string | undefined {
  if (macosProbeRan) return macosProbeResult
  macosProbeRan = true
  macosProbeResult = runProbe('defaults', ['read', '-g', 'AppleLocale'])
  return macosProbeResult
}

/** Clear the memoized OS probes. For tests. */
export function resetLocaleProbes(): void {
  windowsProbeRan = false
  windowsProbeResult = undefined
  macosProbeRan = false
  macosProbeResult = undefined
}

/**
 * The OS-detected UI locale, or `undefined` when the environment names none —
 * in which case the caller falls back to `en`.
 *
 * WSL is a Linux process: it inherits the distro's `LANG` (typically unset or
 * `C.UTF-8`) and cannot see the Windows host's region. That is a hard limit of
 * the process boundary, so WSL degrades to `en` and the docs point those users
 * at `uiLocale` / `RITUAL_LOCALE`. We deliberately do not probe
 * `/mnt/c/.../powershell.exe`.
 */
export function detectOsLocale(options: LocaleDetectionOptions): LocaleTag | undefined {
  // Git Bash / MSYS set the POSIX variables even on Windows, so the cheap path
  // runs first on every platform.
  const fromEnv = detectPosixLocale(options.env)
  if (fromEnv !== undefined) return fromEnv

  const probe = platformProbe(options)
  if (probe === undefined) return undefined
  // The subprocess is only worth spawning when its answer could change anything:
  // nothing explicit was requested, and more than one locale is bundled.
  if (options.hasExplicitLocale === true) return undefined
  if ((options.bundledLocaleCount ?? 1) <= 1) return undefined

  const probed = probe()
  if (probed === undefined) return undefined
  return normalizePosixLocale(probed)
}

/** The probe for the running platform, or `undefined` where there is none. */
function platformProbe(options: LocaleDetectionOptions): (() => string | undefined) | undefined {
  if (options.platform === 'win32') return options.probeWindows ?? probeWindowsUiCulture
  if (options.platform === 'darwin') return options.probeMacos ?? probeMacosLocale
  return undefined
}

/**
 * Which mechanism produced a finding. Machine contract values — they appear in
 * `ritual locale --detect --output json` and are never localized.
 */
export type LocaleProbeSource = 'environment' | 'windows' | 'macos'

/** What one probe found, whether or not it was the one that won. */
export type LocaleProbe = {
  source: LocaleProbeSource
  /**
   * Whether the probe applies to the running platform. A skipped probe is
   * reported rather than omitted, so the report says what was *not* asked too.
   */
  ran: boolean
  /** Where the value came from: an environment variable name, or the command spawned. */
  origin: string
  /** The value exactly as read, before normalization. Absent when nothing was found. */
  raw?: string
  /** The normalized tag. Absent when the raw value named no usable language. */
  tag?: LocaleTag
}

/** Every probe's outcome, plus the tag they collectively name. */
export type LocaleProbeReport = {
  /** One entry per probe, in precedence order. */
  probes: LocaleProbe[]
  /** The first probe tag, in that order. Absent when nothing named a language. */
  tag?: LocaleTag
}

/** Everything {@link probeOsLocale} needs. Nothing is read ambiently. */
export type LocaleProbeOptions = {
  platform: string
  env: LocaleEnv
  /** The Windows UI-culture probe, injected for tests. */
  probeWindows?: () => string | undefined
  /** The macOS `AppleLocale` probe, injected for tests. */
  probeMacos?: () => string | undefined
}

/**
 * Run **every** applicable detection source and report what each one said —
 * the opt-in path behind `ritual locale --detect`.
 *
 * Unlike {@link detectOsLocale} this deliberately carries no gates: the user
 * asked for the expensive answer, so the subprocess runs even on an
 * English-only build and even when a higher tier already decided the locale.
 * That is the whole point of the flag, and it is why no other code path may
 * call this.
 */
export function probeOsLocale(options: LocaleProbeOptions): LocaleProbeReport {
  const probes: LocaleProbe[] = [environmentProbe(options.env)]

  const platformSource: LocaleProbeSource | undefined =
    options.platform === 'win32' ? 'windows' : options.platform === 'darwin' ? 'macos' : undefined
  for (const source of ['windows', 'macos'] as const) {
    const origin = source === 'windows' ? WINDOWS_PROBE_COMMAND : MACOS_PROBE_COMMAND
    if (source !== platformSource) {
      probes.push({ source, ran: false, origin })
      continue
    }
    const raw = platformProbe(options)?.()
    probes.push({
      source,
      ran: true,
      origin,
      ...(raw === undefined ? {} : { raw, tag: normalizePosixLocale(raw) }),
    })
  }

  return { probes, tag: probes.find((probe) => probe.tag !== undefined)?.tag }
}

/** The POSIX chain as a probe finding, naming the variable that supplied it. */
function environmentProbe(env: LocaleEnv): LocaleProbe {
  const matched = matchPosixLocale(env)
  if (matched !== undefined) {
    return {
      source: 'environment',
      ran: true,
      origin: matched.variable,
      raw: matched.value,
      tag: matched.tag,
    }
  }
  // Nothing usable: report the first value that was *set* (so `LANG=C.UTF-8`
  // reads as "set, but names no language") and the whole chain otherwise.
  const [first] = posixCandidates(env)
  if (first !== undefined) {
    return { source: 'environment', ran: true, origin: first.variable, raw: first.value }
  }
  return { source: 'environment', ran: true, origin: POSIX_CHAIN.join(', ') }
}

/** The POSIX variables consulted, in precedence order. Named in the empty report. */
const POSIX_CHAIN: readonly (keyof LocaleEnv)[] = ['LC_ALL', 'LC_MESSAGES', 'LANGUAGE', 'LANG']
