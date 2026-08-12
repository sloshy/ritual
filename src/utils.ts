import { access } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { listFormat, numberFormat } from './i18n/format'
import { currentLocale } from './i18n/runtime'
import { t } from './i18n/t'
import { inputRequiredError, promptsUnavailable } from './no-input'

/** Returns true if the path exists and is accessible. */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/** One component of a rendered duration, before it is given to `Intl`. */
type DurationPart = {
  /** A CLDR unit identifier `Intl.NumberFormat`'s unit style understands. */
  unit: 'day' | 'hour' | 'minute'
  value: number
}

/**
 * Render a millisecond duration as e.g. "2 days, 3 hours" or "45 minutes".
 *
 * Each component is formatted by `Intl.NumberFormat`'s unit style and the
 * components are joined by `Intl.ListFormat`, so neither the noun's plural form
 * nor the separator is hardcoded — `', '` is a comma in English and something
 * else in plenty of languages. Only the sub-minute floor has no `Intl`
 * equivalent, so that one case comes from the catalog.
 */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return t('domain.duration.lessThanMinute')
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: DurationPart[] = []
  if (days > 0) parts.push({ unit: 'day', value: days })
  if (hours > 0) parts.push({ unit: 'hour', value: hours })
  // Only bother with minute precision when the total is under a day.
  if (minutes > 0 && days === 0) parts.push({ unit: 'minute', value: minutes })
  const locale = currentLocale()
  return listFormat(locale, { type: 'unit' }).format(
    parts.map((part) =>
      numberFormat(locale, { style: 'unit', unit: part.unit, unitDisplay: 'long' }).format(
        part.value,
      ),
    ),
  )
}

/**
 * Render how long something just took, at the granularity a progress line needs:
 * seconds to one decimal under a minute ("4.2 seconds"), whole minutes and
 * seconds above it ("2 minutes, 5 seconds").
 *
 * Separate from {@link formatDuration}, whose floor is a minute — right for "the
 * cache is 3 days old", useless for "the local index took 6 seconds", which is
 * exactly the figure that tells a user which phase of a run is the slow one.
 */
export function formatElapsed(ms: number): string {
  const locale = currentLocale()
  // Rounded to the precision the sub-minute branch prints *before* the branch is
  // chosen, so 59.96 seconds reads "1 minute" rather than "60 seconds".
  const seconds = Math.round(Math.max(0, ms) / 100) / 10
  const unit = (value: number, name: 'minute' | 'second', fractionDigits = 0): string =>
    numberFormat(locale, {
      style: 'unit',
      unit: name,
      unitDisplay: 'long',
      maximumFractionDigits: fractionDigits,
    }).format(value)

  if (seconds < 60) return unit(seconds, 'second', 1)
  // Rounded before the split, so 119.6s reads "2 minutes" rather than
  // "1 minute, 60 seconds".
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const parts = [unit(minutes, 'minute')]
  if (rest > 0) parts.push(unit(rest, 'second'))
  return listFormat(locale, { type: 'unit' }).format(parts)
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Walk a pre-split dotted path (e.g. `['admin', 'gitEnabled']`) into a nested
 * object. Returns undefined as soon as a segment is missing or a non-object is
 * reached.
 */
export function getAtPath(obj: unknown, path: string[]): unknown {
  let current = obj
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export async function promptUser(question: string): Promise<string> {
  // The same structured usage error `ask()` throws, so a prompt that cannot run
  // exits 2 whichever helper asked for the input (`src/errors.ts` is a leaf, so
  // there is no cycle to route around here).
  if (promptsUnavailable()) throw inputRequiredError(question.trim())
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}
