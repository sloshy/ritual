/**
 * The single shape parser for an untrusted catalog entry.
 *
 * Three separate paths take JSON nobody type-checked and turn it into a
 * {@link LocaleCatalog}: the browser's same-origin dictionary fetch
 * (`runtime.ts`), `build-site --locale-file`, and `scripts/check-locales.ts`.
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

/** Why a JSON value is not a {@link MessageValue}. */
export type CatalogEntryError = {
  error: string
}

/** Narrow a {@link parseCatalogEntry} result to its error branch. */
export function isCatalogEntryError(
  result: MessageValue | CatalogEntryError,
): result is CatalogEntryError {
  return (
    typeof result === 'object' &&
    result !== null &&
    !isPluralForms(result) &&
    !isSelectForms(result) &&
    typeof result.error === 'string'
  )
}

/**
 * Validate one untyped JSON entry as a {@link MessageValue}, or explain why it
 * is not one.
 *
 * The rules are exactly the value forms `t()` can render: a plain string, a
 * `$plural` table that supplies `other`, or a `$select` table with at least one
 * branch. Every branch must be a string — a nested plural-in-select is rejected
 * with the advice to split the key, matching the design's one-level rule.
 */
export function parseCatalogEntry(raw: unknown): MessageValue | CatalogEntryError {
  if (typeof raw === 'string') return raw
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'value must be a string, a $plural table, or a $select table' }
  }
  const record = raw as Record<string, unknown>
  const hasPlural = typeof record.$plural === 'string'
  const hasSelect = typeof record.$select === 'string'
  if (hasPlural && hasSelect) return { error: 'value cannot be both $plural and $select' }
  if (!hasPlural && !hasSelect) {
    return { error: 'object value needs a $plural or $select discriminator' }
  }
  for (const [name, branch] of Object.entries(record)) {
    if (name === '$plural' || name === '$select') continue
    if (typeof branch !== 'string') {
      return {
        error: `branch "${name}" must be a string (nested plural-in-select is not supported — split the key)`,
      }
    }
  }
  if (hasPlural && typeof record.other !== 'string') {
    return { error: '$plural table needs an "other" form' }
  }
  if (hasSelect && Object.keys(record).length < 2) {
    return { error: '$select table needs at least one branch' }
  }
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
