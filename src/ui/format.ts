/**
 * Locale-bound number and date formatting for the browser surfaces.
 *
 * `src/i18n/format.ts` owns the memoized `Intl` factories but deliberately
 * takes an explicit locale tag, because the CLI sometimes has to render for a
 * locale that is not the active one. The SPAs never do: they always format in
 * the UI locale. This module is that one-line binding, so a component calls
 * `formatDateTime(stamp)` rather than repeating
 * `dateTimeFormat(currentLocale(), …)` at every site.
 *
 * Why not `toLocaleString()`: with no argument it follows the *host*, so the
 * same page renders two different date orders for two visitors while the UI
 * around it stays in one language — and under Bun (the CLI's own SPA rendering
 * paths) it silently resolves to `en-US` no matter the environment. The
 * `ritual/no-bare-intl-locale` rule bans the bare form for exactly that reason.
 *
 * Browser-safe: no `node:` imports.
 */

import { dateTimeFormat, numberFormat } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'

/** Anything a date column may hold: a `Date`, epoch milliseconds, or an ISO string. */
export type DateTimeInput = Date | number | string

/**
 * `Date.prototype.toLocaleString()`'s own defaults, spelled out. Passing an
 * explicit locale to `Intl.DateTimeFormat` without options would render the
 * date only, so the options have to come along for the output to be unchanged.
 */
const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
}

/**
 * What `Date.prototype.toLocaleString()` returns for an unparseable date.
 * `Intl.DateTimeFormat.format` throws on one instead, so it is caught here and
 * every call site keeps the behavior it had.
 */
const INVALID_DATE = 'Invalid Date'

/** Render a date and time in the active UI locale. Defaults to the full date + clock time. */
export function formatDateTime(
  value: DateTimeInput,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return INVALID_DATE
  return dateTimeFormat(currentLocale(), options).format(date)
}

/** Render a number with the active UI locale's grouping and decimal separators. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(currentLocale(), options).format(value)
}
