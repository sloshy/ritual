/**
 * The single shape parser for an untrusted catalog entry.
 *
 * Three separate paths take JSON nobody type-checked and turn it into a
 * {@link LocaleCatalog}: the browser's same-origin dictionary fetch
 * (`dictionary-fetch.ts`), `build-site --locale-file`, and `scripts/check-locales.ts`.
 * They used to each carry their own rules, and disagreed — only the validator
 * required `other` on a `$plural` table, so a `{"$plural":"count","one":"…"}`
 * entry passed the build gate *and* the runtime coercion and then made
 * `selectForm` hand `interpolate` an `undefined` form, throwing out of a module
 * whose contract is "`t()` never throws in production".
 *
 * One parser, three callers. Per AGENTS.md a parser validates and returns a
 * structured error rather than a bare string — `MessageValue` is already
 * string-inhabited, so a `MessageValue | string` union could not be told apart
 * from a successful parse.
 *
 * Browser-safe: no `node:` imports.
 */

import { isPluralForms, isSelectForms, type LocaleCatalog, type MessageValue } from './types'

/**
 * Why a JSON value is not a {@link MessageValue}, as a code rather than a
 * sentence. This module stays free of the catalog and of `t()`: the browser's
 * dictionary coercion and the locale scripts import it, and both stay light by
 * not pulling the rendering stack in for a shape check. Only the two callers
 * that *report* a refusal word it — `describeCatalogEntryError` in
 * `catalog-message.ts`, keyed `errors.i18n.entry.*`.
 */
export type CatalogEntryError =
  /** Neither a string nor a table object. */
  | { problem: 'notAMessage' }
  /** Both discriminators at once. */
  | { problem: 'pluralAndSelect' }
  /** An object naming neither discriminator. */
  | { problem: 'noDiscriminator' }
  /** A branch that is not a string — usually a nested table. */
  | { problem: 'branchNotString'; branch: string }
  /** A `$plural` table without its mandatory `other` form. */
  | { problem: 'pluralWithoutOther' }
  /** A `$select` table with no branch at all. */
  | { problem: 'selectWithoutBranch' }

/** The code of a {@link CatalogEntryError}. */
export type CatalogEntryProblem = CatalogEntryError['problem']

/** Narrow a {@link parseCatalogEntry} result to its error branch. */
export function isCatalogEntryError(
  result: MessageValue | CatalogEntryError,
): result is CatalogEntryError {
  return (
    typeof result === 'object' &&
    result !== null &&
    !isPluralForms(result) &&
    !isSelectForms(result) &&
    typeof result.problem === 'string'
  )
}

/**
 * Validate one untyped JSON entry as a {@link MessageValue}, or explain why it
 * is not one.
 *
 * The rules are exactly the value forms `t()` can render: a plain string, a
 * `$plural` table that supplies `other`, or a `$select` table with at least one
 * branch. Every branch must be a string — a nested plural-in-select is rejected
 * with the advice to split the key: values nest one level deep at most.
 */
export function parseCatalogEntry(raw: unknown): MessageValue | CatalogEntryError {
  if (typeof raw === 'string') return raw
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: 'notAMessage' }
  }
  const record = raw as Record<string, unknown>
  const hasPlural = typeof record.$plural === 'string'
  const hasSelect = typeof record.$select === 'string'
  if (hasPlural && hasSelect) return { problem: 'pluralAndSelect' }
  if (!hasPlural && !hasSelect) return { problem: 'noDiscriminator' }
  for (const [name, branch] of Object.entries(record)) {
    if (name === '$plural' || name === '$select') continue
    if (typeof branch !== 'string') return { problem: 'branchNotString', branch: name }
  }
  if (hasPlural && typeof record.other !== 'string') return { problem: 'pluralWithoutOther' }
  if (hasSelect && Object.keys(record).length < 2) return { problem: 'selectWithoutBranch' }
  return record as MessageValue
}

/**
 * Narrow a whole parsed JSON document to a catalog, keeping only well-formed
 * entries.
 *
 * A bad entry costs exactly that entry: `t()` already falls through to English
 * per key, so dropping is strictly better than rejecting the file.
 * `scripts/check-locales.ts` is where a malformed catalog is *reported*; this is
 * the runtime's floor.
 */
export function coerceCatalog(raw: unknown): LocaleCatalog {
  const catalog: LocaleCatalog = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return catalog
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseCatalogEntry(value)
    if (!isCatalogEntryError(parsed)) catalog[key] = parsed
  }
  return catalog
}
