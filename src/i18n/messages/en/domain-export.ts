/**
 * `domain.export.*` — the text of `ritual export` and `POST /api/export`
 * (`src/export/**`): why an export input was refused, what an export reports
 * beside its output, and the column labels a human picks columns by. `ritual
 * diff` (and `GET /api/diff`, MCP `diff_lists`) reports its lists' parse
 * warnings with the same keys, and a collection push's Archidekt CSV — rendered
 * by the export engine — names the cards it could not give a Scryfall ID with
 * them.
 *
 * A fragment of the domain namespace, registered by the CLI and the admin SPA.
 * The export engine sits inside the i18n persistence fence and cannot reach the
 * catalog, so it returns codes (`src/export/text.ts`) that
 * `src/export-wording/message.ts` words: English plus the key for the admin
 * API, MCP and `--output json`, the CLI's own language on its console, and the
 * reader's language on the admin Settings page (a malformed `exportPresets`
 * refusal nested in the config validator's) and Sync Collection page (a push's
 * cache-miss log lines).
 *
 * The column labels are the column *picker's* words. The CSV header cells an
 * export writes are a separate, English-by-contract table
 * (`EXPORT_COLUMN_HEADERS`). Column ids (`collectorNumber`), filter values
 * (`NM`, `none`), dialect and format names, the config key `exportPresets`,
 * preset names, card, list and section names, and `SET:CN` printings are
 * machine vocabulary or the user's data and stay as they are inside the
 * sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainExportMessages = {
  // ── Column labels, as the column picker shows them ────────────────────
  'domain.export.column.name': 'Name',
  'domain.export.column.quantity': 'Quantity',
  'domain.export.column.set': 'Set',
  'domain.export.column.collectorNumber': 'Collector Number',
  'domain.export.column.edition': 'Edition',
  'domain.export.column.scryfallId': 'Scryfall ID',
  'domain.export.column.edhrecRank': 'EDHREC Rank',
  'domain.export.column.finish': 'Finish',
  'domain.export.column.isFoil': 'Is Foil',
  'domain.export.column.condition': 'Condition',
  'domain.export.column.language': 'Language',
  'domain.export.column.labels': 'Labels',
  'domain.export.column.tags': 'Tags',
  'domain.export.column.categories': 'Categories',
  'domain.export.column.primaryCategory': 'Primary Category',
  'domain.export.column.note': 'Note',
  'domain.export.column.section': 'Section',
  'domain.export.column.listName': 'List',
  'domain.export.column.listType': 'List Type',
  'domain.export.column.variant': 'Variant',

  // ── A refused input ────────────────────────────────────────────────────
  'domain.export.problem.columnsEmpty': 'No columns given. Available columns: {columns}',
  'domain.export.problem.columnUnknown': "Unknown column '{column}'. Available columns: {columns}",
  'domain.export.problem.columnDuplicate': "Duplicate column '{column}'.",
  'domain.export.problem.conditionsEmpty': 'No conditions given. Use one of: {values}.',
  'domain.export.problem.conditionInvalid': "Invalid condition '{value}'. Use one of: {values}.",
  'domain.export.problem.labelsEmpty': 'No labels given. Use one of: {values}.',
  'domain.export.problem.labelInvalid': "Invalid label '{value}'. Use one of: {values}.",
  'domain.export.problem.presetsNotObject':
    '"exportPresets" must be an object mapping preset names to presets',
  'domain.export.problem.presetNotObject': '{preset} must be an object',
  'domain.export.problem.presetFormatInvalid': '{preset}.format must be one of: {formats}',
  'domain.export.problem.presetColumnsNotArray':
    '{preset}.columns must be an array of property names',
  'domain.export.problem.presetColumnsInvalid': '{preset}.columns: {reason}',
  'domain.export.problem.presetFieldNotBoolean': '{preset}.{field} must be a boolean',
  'domain.export.problem.presetDialectInvalid': '{preset}.dialect must be one of: {dialects}',
  'domain.export.problem.fileNameExhausted': {
    $plural: 'count',
    one: 'Could not find a free export file name after {count} attempt in {dir}.',
    other: 'Could not find a free export file name after {count} attempts in {dir}.',
  },
  'domain.export.problem.fileNameNotBasename':
    "Refusing to write export under a non-basename name '{name}'.",

  // ── What an export reports beside its output ───────────────────────────
  'domain.export.warning.inList': '{list}: {warning}',
  'domain.export.warning.cardsUnmatched': "No cards matched '{terms}'",
  'domain.export.warning.scryfallIdUnpinned':
    'No Scryfall ID for {name}: the entry has no set and collector number.',
  'domain.export.warning.scryfallIdUncached':
    'No Scryfall ID for {name} ({printing}): the printing is not in the Scryfall cache.',
  'domain.export.warning.edhrecRankUncached':
    'No EDHREC rank for {name}: the card is not in the Scryfall cache.',
  'domain.export.warning.extrasOmitted':
    'Omitted cards a decklist has no board for: {sections}. Maybeboard and token sections are deck-building extras rather than part of a decklist, so neither Arena nor Moxfield writes them.',
  'domain.export.warning.sectionCount': '{section} ({quantity})',
  'domain.export.warning.categoriesUnwritable':
    'Categories not written as Moxfield tags: {categories}. Moxfield’s bulk-edit format documents only single-word tags, so a category holding a space (or starting with "!") has no spelling it is known to read, and one holding a character a Ritual tag cannot ("#", "&", brackets and the like) would not import back.',
} as const satisfies MessageCatalogShape
