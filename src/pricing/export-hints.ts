/**
 * The parenthetical hints shown beside an export column while a human is
 * *choosing* columns — the `ritual export` wizard's column picker and the
 * `--columns` help text.
 *
 * These live outside `src/export/` deliberately. That directory writes CSV and
 * the Archidekt/Moxfield dialect headers, which are English by contract, and a
 * source-scan convention test (`test/unit/i18n-conventions.test.ts`) asserts
 * that nothing under it reaches the message catalog at all. Hints are the one
 * piece of export *prose* a reader sees rather than a file, so they belong on
 * this side of that fence — column labels (`EXPORT_PROPERTY_LABELS`) stay put.
 */

import { EXPORT_PROPERTIES, type ExportProperty } from '../export/render'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

/**
 * Every key naming an export-column hint. Narrower than `MessageKey` so `t()`
 * can render one without params, and `Extract` turns a key that no longer
 * exists in the catalog into `never` — a compile error at the table below.
 */
export type ExportHintMessageKey = Extract<MessageKey, `domain.exportHint.${string}`>

/**
 * Message keys for the hints, by property. Partial by design: most columns
 * explain themselves. Keys rather than rendered text, per the module-level
 * label-table rule — this is evaluated once at import.
 */
export const EXPORT_PROPERTY_HINTS: Partial<Record<ExportProperty, ExportHintMessageKey>> = {
  edition: 'domain.exportHint.edition',
  scryfallId: 'domain.exportHint.scryfallId',
  isFoil: 'domain.exportHint.isFoil',
  language: 'domain.exportHint.language',
  labels: 'domain.exportHint.labels',
  tags: 'domain.exportHint.tags',
  categories: 'domain.exportHint.categories',
  primaryCategory: 'domain.exportHint.primaryCategory',
}

/** A property's hint in the active UI locale, or `undefined` when it has none. */
export function exportPropertyHint(property: ExportProperty): string | undefined {
  const key = EXPORT_PROPERTY_HINTS[property]
  return key === undefined ? undefined : t(key)
}

/** The property keys joined for help text, with parenthetical hints where one exists. */
export function describeExportProperties(): string {
  return EXPORT_PROPERTIES.map((property) => {
    const hint = exportPropertyHint(property)
    return hint === undefined ? property : `${property} (${hint})`
  }).join(', ')
}
