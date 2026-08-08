/**
 * A tolerant synchronous read of exactly one config key, for the boot window
 * before `loadRitualConfig()` can run.
 *
 * Commander's help strings are evaluated at registration time (see
 * `argv-prescan.ts`), which happens before any async config machinery exists.
 * This is the design's one deliberate duplication of config knowledge, and it
 * is pinned by a unit test asserting it agrees with `loadRitualConfig()` across
 * synthetic config files.
 *
 * It never throws: a missing file, unreadable file, invalid JSON, non-object
 * document, or non-string value all read as "no configured locale". The
 * authoritative loader still runs moments later and still reports a malformed
 * file — this pre-read must not preempt its error, only decline to guess.
 *
 * CLI-only.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

/** The config file both this pre-read and `loadRitualConfig()` read. */
const CONFIG_FILENAME = 'ritual.config.json'

/**
 * Read `uiLocale` out of `<baseDir>/ritual.config.json`, or `undefined` when it
 * is absent or the file cannot be read as a JSON object. The value is returned
 * verbatim (trimmed) — validation belongs to the authoritative parser.
 */
export function prereadUiLocale(baseDir: string): string | undefined {
  let raw: string
  try {
    raw = readFileSync(path.join(baseDir, CONFIG_FILENAME), 'utf-8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const value = (parsed as Record<string, unknown>)['uiLocale']
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}
