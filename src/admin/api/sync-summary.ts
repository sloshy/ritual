/**
 * The one-line outcome of a sync run, as **structure** rather than as a
 * sentence.
 *
 * Both sync summaries used to be built by string concatenation on the server —
 * `${verb} ${count} deck${count === 1 ? '' : 's'}`, clauses joined with `', '`,
 * a `.` on the end. Three separate things are wrong with that once a second
 * language exists: the plural rule is English's, the clause separator is
 * English's, and the whole sentence arrives at the client pre-rendered, so a
 * language switch cannot relabel a summary already on screen.
 *
 * So a run produces a {@link SyncSummary}: an ordered list of keyed clauses.
 * The server renders it to English for `message` (byte for byte what it emitted
 * before — MCP and scripts must see no change), and hands the structure over so
 * a client with a translator renders the same summary in the reader's locale,
 * with that locale's plural categories and `Intl.ListFormat` separators.
 *
 * **Clauses carry no final punctuation.** {@link renderSyncSummary} joins them
 * and terminates the sentence, because where the terminator goes — and whether
 * it is `.` at all — is the renderer's business, not each clause's.
 *
 * Browser-safe: the admin SPA renders these, so nothing here may reach for
 * `node:`.
 */

import { listFormat } from '../../i18n/format'
import { DEFAULT_LOCALE } from '../../i18n/runtime'
import type { TranslateDynamicFn } from '../../i18n/t'
import type { LocaleTag } from '../../i18n/types'
import { renderApiMessage, type ApiMessage } from '../../api/result'

/**
 * One clause of a summary — "Pulled 3 decks", "2 failed" — as its own keyed
 * message. {@link ApiMessage} exactly: rendered English plus the key it came
 * from, which is what lets a client re-render a clause it has a translation for
 * and fall back on one it does not.
 */
export type SyncSummaryClause = ApiMessage

/** A completed run's summary, as ordered clauses. */
export type SyncSummary = {
  /**
   * The clauses, in the order they read. Never empty: a run that did nothing
   * still says so in one clause.
   */
  clauses: SyncSummaryClause[]
}

/**
 * How clauses are joined. `type: 'unit'` is the one that does *not* insert a
 * conjunction — an English "and" before the last clause would be wrong for a
 * list of independent counts, and would change the bytes MCP already reads.
 */
const LIST_OPTIONS: Intl.ListFormatOptions = { style: 'long', type: 'unit' }

/** The terminator the joined clauses end on. */
const TERMINATOR = '.'

/**
 * Render a summary with the caller's translator — `useT()` in a Solid
 * component, so the summary re-renders when the language changes.
 *
 * `locale` drives the clause separator; the translator drives the clauses. They
 * are separate arguments because a reactive `t` already closes over the active
 * locale and cannot be asked what it is.
 */
export function renderSyncSummary(
  t: TranslateDynamicFn,
  summary: SyncSummary,
  locale: LocaleTag,
): string {
  const parts = summary.clauses.map((clause) => renderApiMessage(t, clause))
  return `${listFormat(locale, LIST_OPTIONS).format(parts)}${TERMINATOR}`
}

/**
 * Render a summary as English, from the text each clause already carries.
 *
 * This is what a run's `message` field is built from, so it must stay byte for
 * byte what the old concatenation produced — English's `', '` unit separator
 * and the trailing period.
 */
export function renderSyncSummaryEnglish(summary: SyncSummary): string {
  const parts = summary.clauses.map((clause) => clause.message)
  return `${listFormat(DEFAULT_LOCALE, LIST_OPTIONS).format(parts)}${TERMINATOR}`
}
