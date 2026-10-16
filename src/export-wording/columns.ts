/**
 * The words a human reads while *choosing* export columns — the `ritual export`
 * wizard's column picker and summary lines, and the `--columns` help text:
 * each column's label, and the parenthetical hint some columns carry.
 *
 * These live outside `src/export/` deliberately. That directory writes CSV and
 * the Archidekt/Moxfield dialect headers, which are English by contract, and a
 * source-scan convention test (`test/unit/i18n-conventions.test.ts`) asserts
 * that nothing under it reaches the message catalog at all. So a column has
 * two names: the header cell a file is written with (`EXPORT_COLUMN_HEADERS`,
 * English in every language, because an importer matches on it) and the label
 * a picker shows (here, in the reader's language). The column *ids* a user
 * types on the command line (`collectorNumber`) are a third vocabulary, and the
 * one a refusal lists (`src/export-wording/message.ts`).
 *
 * CLI-only: rendered with `t()` in the CLI's own language.
 */

import { EXPORT_PROPERTIES, type ExportDialect, type ExportProperty } from '../export/render'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

/** Every key naming a column label. */
type ExportColumnLabelKey = Extract<MessageKey, `domain.export.column.${string}`>

/** The label each column is picked by. */
const COLUMN_LABEL_KEYS = {
  name: 'domain.export.column.name',
  quantity: 'domain.export.column.quantity',
  set: 'domain.export.column.set',
  collectorNumber: 'domain.export.column.collectorNumber',
  edition: 'domain.export.column.edition',
  scryfallId: 'domain.export.column.scryfallId',
  edhrecRank: 'domain.export.column.edhrecRank',
  finish: 'domain.export.column.finish',
  isFoil: 'domain.export.column.isFoil',
  condition: 'domain.export.column.condition',
  language: 'domain.export.column.language',
  labels: 'domain.export.column.labels',
  tags: 'domain.export.column.tags',
  categories: 'domain.export.column.categories',
  primaryCategory: 'domain.export.column.primaryCategory',
  note: 'domain.export.column.note',
  section: 'domain.export.column.section',
  listName: 'domain.export.column.listName',
  listType: 'domain.export.column.listType',
} as const satisfies Record<ExportProperty, ExportColumnLabelKey>

/**
 * The labels a dialect gives a column its own header names differently — the
 * picker's mirror of the header table's dialect overrides, so a user picking
 * columns for an Archidekt CSV reads the column Archidekt's way (`Variant`).
 */
const DIALECT_COLUMN_LABEL_KEYS: Record<
  ExportDialect,
  Partial<Record<ExportProperty, ExportColumnLabelKey>>
> = {
  ritual: {},
  archidekt: { finish: 'domain.export.column.variant' },
  arena: {},
  moxfield: {},
}

/** A column's label in a dialect, in the CLI's language. */
export function exportColumnLabel(
  property: ExportProperty,
  dialect: ExportDialect = 'ritual',
): string {
  return t(DIALECT_COLUMN_LABEL_KEYS[dialect][property] ?? COLUMN_LABEL_KEYS[property])
}

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
  edhrecRank: 'domain.exportHint.edhrecRank',
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

/**
 * The property ids joined for help text, with parenthetical hints where one
 * exists. Ids, not labels: they are what `--columns` takes.
 */
export function describeExportProperties(): string {
  return EXPORT_PROPERTIES.map((property) => {
    const hint = exportPropertyHint(property)
    return hint === undefined ? property : `${property} (${hint})`
  }).join(', ')
}
