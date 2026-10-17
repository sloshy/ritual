/**
 * Memoized `Intl` formatter factories.
 *
 * Two reasons every formatter goes through here:
 *
 * 1. **Bun resolves no locale from the environment.** With `LANG=de_DE.UTF-8`,
 *    `new Intl.NumberFormat().resolvedOptions().locale` is still `en-US`. A
 *    bare constructor is therefore always wrong — either silently English on a
 *    German machine, or (worse) host-dependent in a browser. Every factory here
 *    takes an explicit tag, and the `ritual/no-bare-intl-locale` lint rule makes
 *    the bare form impossible.
 * 2. `Intl` constructors are expensive; formatting inside a per-card loop
 *    without a cache is measurably slow.
 *
 * Browser-safe: no `node:` imports.
 */

import type { LocaleTag } from './types'

/**
 * Cache key for a `(locale, options)` pair. Option keys are sorted so two
 * spellings of the same options share one formatter.
 */
function cacheKey(locale: LocaleTag, options: object | undefined): string {
  if (options === undefined) return `${locale}\u0000`
  const entries = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `${locale}\u0000${JSON.stringify(entries)}`
}

/** Build-or-reuse against a per-formatter-kind cache. */
function memoize<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const existing = cache.get(key)
  if (existing !== undefined) return existing
  const created = create()
  cache.set(key, created)
  return created
}

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>()
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>()
const listFormats = new Map<string, Intl.ListFormat>()
const collators = new Map<string, Intl.Collator>()
const pluralRuleSets = new Map<string, Intl.PluralRules>()
const segmenters = new Map<string, Intl.Segmenter>()

/** A memoized `Intl.NumberFormat` for an explicit locale. */
export function numberFormat(
  locale: LocaleTag,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  return memoize(
    numberFormats,
    cacheKey(locale, options),
    () => new Intl.NumberFormat(locale, options),
  )
}

/** A memoized `Intl.DateTimeFormat` for an explicit locale. */
export function dateTimeFormat(
  locale: LocaleTag,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return memoize(
    dateTimeFormats,
    cacheKey(locale, options),
    () => new Intl.DateTimeFormat(locale, options),
  )
}

/** A memoized `Intl.RelativeTimeFormat` for an explicit locale. */
export function relativeTimeFormat(
  locale: LocaleTag,
  options?: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return memoize(
    relativeTimeFormats,
    cacheKey(locale, options),
    () => new Intl.RelativeTimeFormat(locale, options),
  )
}

/** A memoized `Intl.ListFormat` for an explicit locale. */
export function listFormat(locale: LocaleTag, options?: Intl.ListFormatOptions): Intl.ListFormat {
  return memoize(listFormats, cacheKey(locale, options), () => new Intl.ListFormat(locale, options))
}

/** The list style for independent items: no conjunction before the last. */
const UNIT_LIST: Intl.ListFormatOptions = { style: 'long', type: 'unit' }

/**
 * Independent items — counts, clauses, names — joined the way `locale` lists
 * them without an "and": `A, B, C` in English. The one spelling of that join,
 * so a summary line and a list of names cannot drift apart.
 */
export function formatUnitList(locale: LocaleTag, parts: readonly string[]): string {
  return listFormat(locale, UNIT_LIST).format(parts)
}

/** One piece of a formatted list: an item, or the locale's separator text between items. */
export type ListFormatPart = { type: 'element' | 'literal'; value: string }

/**
 * {@link formatUnitList} as parts, for a caller that renders each item itself
 * (a link per name) while the locale places the separators around them.
 */
export function formatUnitListParts(locale: LocaleTag, parts: readonly string[]): ListFormatPart[] {
  return listFormat(locale, UNIT_LIST).formatToParts(parts)
}

/** A memoized `Intl.Collator` for an explicit locale. See `collate.ts` for which one to use. */
export function collator(locale: LocaleTag, options?: Intl.CollatorOptions): Intl.Collator {
  return memoize(collators, cacheKey(locale, options), () => new Intl.Collator(locale, options))
}

/** A memoized `Intl.PluralRules` for an explicit locale. Drives `PluralForms` selection. */
export function pluralRules(
  locale: LocaleTag,
  options?: Intl.PluralRulesOptions,
): Intl.PluralRules {
  return memoize(
    pluralRuleSets,
    cacheKey(locale, options),
    () => new Intl.PluralRules(locale, options),
  )
}

/** A memoized `Intl.Segmenter` for an explicit locale. Used by `width.ts` and term matching. */
export function segmenter(locale: LocaleTag, options?: Intl.SegmenterOptions): Intl.Segmenter {
  return memoize(segmenters, cacheKey(locale, options), () => new Intl.Segmenter(locale, options))
}

/** Drop every memoized formatter. For tests that assert on cache behavior. */
export function resetFormatCaches(): void {
  numberFormats.clear()
  dateTimeFormats.clear()
  relativeTimeFormats.clear()
  listFormats.clear()
  collators.clear()
  pluralRuleSets.clear()
  segmenters.clear()
}
