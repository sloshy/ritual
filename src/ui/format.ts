/**
 * Locale-bound number and date formatting in the active UI locale — the SPAs'
 * every date and count, and the CLI's human (non-JSON) reports.
 *
 * `src/i18n/format.ts` owns the memoized `Intl` factories but deliberately
 * takes an explicit locale tag, because the CLI sometimes has to render for a
 * locale that is not the active one (an English error envelope). Display text
 * always formats in the UI locale. This module is that one-line binding, so a caller
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
import { t } from '../i18n/t'

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

/** Render a date and time in the active UI locale. Defaults to the full date + clock time. */
export function formatDateTime(
  value: DateTimeInput,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
): string {
  const date = value instanceof Date ? value : new Date(value)
  // `Intl.DateTimeFormat.format` throws on an unparseable date where
  // `toLocaleString()` returned "Invalid Date"; the catalog says it instead, in
  // the reader's language.
  if (Number.isNaN(date.getTime())) return t('ui.format.invalidDate')
  return dateTimeFormat(currentLocale(), options).format(date)
}

/**
 * {@link formatDateTime}, or `fallback` when `value` is not a date at all — a
 * heading someone hand-wrote, shown as written rather than as the catalog's
 * "invalid date" text.
 */
export function formatDateTimeOr(
  value: DateTimeInput,
  fallback: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? fallback : formatDateTime(date, options)
}

/** Render a number with the active UI locale's grouping and decimal separators. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return numberFormat(currentLocale(), options).format(value)
}
