/**
 * The two string comparators every sort in Ritual must choose between. A bare
 * `localeCompare()` follows the host's locale, which makes the same list sort
 * differently on two machines — including lists whose order is asserted by the
 * test suite.
 *
 * - {@link compareData} — pinned to English. For set codes, ISO dates,
 *   collector numbers, slugs, file paths, and any CLI output whose ordering is
 *   asserted. Its result must never depend on the UI locale.
 * - {@link compareDisplay} — follows the UI locale. For user-visible name
 *   sorting, where a German user expects German collation.
 *
 * Browser-safe: no `node:` imports.
 */

import { collator } from './format'
import { currentLocale, DEFAULT_LOCALE } from './runtime'

/**
 * Locale-invariant comparison, pinned to English. Use for anything persisted,
 * machine-read, or asserted on.
 */
export function compareData(a: string, b: string): number {
  return collator(DEFAULT_LOCALE).compare(a, b)
}

/**
 * Locale-invariant comparison that orders embedded digit runs numerically
 * (`2` before `10`). Same pinning as {@link compareData}; use for collector
 * numbers and other identifiers with numeric segments.
 */
export function compareDataNumeric(a: string, b: string): number {
  return collator(DEFAULT_LOCALE, { numeric: true }).compare(a, b)
}

/**
 * Locale-aware comparison for user-visible text, following the active UI
 * locale. The collator is memoized per locale, so this is cheap inside a sort.
 */
export function compareDisplay(a: string, b: string): number {
  return collator(currentLocale()).compare(a, b)
}

/**
 * Locale-aware comparison for user-visible text with numeric digit runs
 * (deck names like "Deck 2" vs "Deck 10").
 */
export function compareDisplayNumeric(a: string, b: string): number {
  return collator(currentLocale(), { numeric: true }).compare(a, b)
}

/**
 * Locale-aware comparison that ignores case and accents entirely (`sensitivity:
 * 'base'`), so `deck` and `Deck` are the same key and sort in whatever order
 * the caller supplied them. For A–Z toolbars over user-named things, where
 * capitalization is an authoring accident rather than an ordering signal.
 */
export function compareDisplayBase(a: string, b: string): number {
  return collator(currentLocale(), { sensitivity: 'base' }).compare(a, b)
}
