/**
 * Wording the export engine's structured text — the boundary where its
 * problems and warnings (`src/export/text.ts`) become sentences.
 *
 * The export engine sits inside the persistence fence and may not import
 * `src/i18n`, so it returns a code and its values. Every surface that shows one
 * goes through here:
 *
 * - the admin API, MCP and `--output json` take {@link exportProblemMessage} /
 *   {@link exportWarningMessage} — English `message` plus the key and (nested)
 *   params, a `SyncMessage`; the config validator nests a preset's problem the
 *   same way;
 * - the CLI prints a refusal through `failWithMessage` (its own language, the
 *   key in its `--output json` envelope) and a warning with
 *   {@link renderExportWarning}.
 *
 * Each code is worded by one `syncRef` call, which checks the params it passes
 * against its key's placeholders — names and types — at compile time, so a
 * placeholder renamed in the catalog fails to build rather than rendering a
 * literal `{token}`. Each case also destructures its code's values and hands
 * the rest to `allUsed`, so a value added to a code fails to build until the
 * sentence uses it. The key tables are what make every code worded at all
 * (`satisfies Record<Code, MessageKey>`).
 *
 * The values a refusal *offers* (the column ids, the condition and label
 * values, the formats and dialects) are the ones the user types — the same
 * every time — so they are supplied here rather than carried by each problem.
 */

import { CONDITION_FILTER_VALUES, LABEL_FILTER_VALUES } from '../export/filter-values'
import { EXPORT_FORMATS } from '../export/presets'
import { EXPORT_DIALECTS, EXPORT_PROPERTIES } from '../export/render'
import type {
  ExportProblem,
  ExportProblemCode,
  ExportWarning,
  ExportWarningCode,
} from '../export/text'
import type { MessageKey } from '../i18n/messages/en'
import type { LocaleTag } from '../i18n/types'
import {
  nestSync,
  renderSyncMessage,
  syncList,
  syncRef,
  toSyncMessage,
  type SyncListParam,
  type SyncMessage,
  type SyncMessageRef,
} from '../sync/message'

/** The catalog key each problem code is worded with. */
const PROBLEM_KEYS = {
  'columns-empty': 'domain.export.problem.columnsEmpty',
  'column-unknown': 'domain.export.problem.columnUnknown',
  'column-duplicate': 'domain.export.problem.columnDuplicate',
  'conditions-empty': 'domain.export.problem.conditionsEmpty',
  'condition-invalid': 'domain.export.problem.conditionInvalid',
  'labels-empty': 'domain.export.problem.labelsEmpty',
  'label-invalid': 'domain.export.problem.labelInvalid',
  'presets-not-object': 'domain.export.problem.presetsNotObject',
  'preset-not-object': 'domain.export.problem.presetNotObject',
  'preset-format-invalid': 'domain.export.problem.presetFormatInvalid',
  'preset-columns-not-array': 'domain.export.problem.presetColumnsNotArray',
  'preset-columns-invalid': 'domain.export.problem.presetColumnsInvalid',
  'preset-field-not-boolean': 'domain.export.problem.presetFieldNotBoolean',
  'preset-dialect-invalid': 'domain.export.problem.presetDialectInvalid',
  'file-name-exhausted': 'domain.export.problem.fileNameExhausted',
  'file-name-not-basename': 'domain.export.problem.fileNameNotBasename',
} as const satisfies Record<ExportProblemCode, MessageKey>

/** The catalog key each warning code is worded with. */
const WARNING_KEYS = {
  'list-warning': 'domain.export.warning.inList',
  'cards-unmatched': 'domain.export.warning.cardsUnmatched',
  'scryfall-id-unpinned': 'domain.export.warning.scryfallIdUnpinned',
  'scryfall-id-uncached': 'domain.export.warning.scryfallIdUncached',
  'edhrec-rank-uncached': 'domain.export.warning.edhrecRankUncached',
  'extras-omitted': 'domain.export.warning.extrasOmitted',
  'categories-unwritable': 'domain.export.warning.categoriesUnwritable',
} as const satisfies Record<ExportWarningCode, MessageKey>

/** Values a user may type, offered by a refusal: the locale's list, no conjunction. */
function offered(values: readonly string[]): SyncListParam {
  return syncList(values, 'unit')
}

/** Where a saved preset sits in ritual.config.json — a JSON path, the name quoted as JSON quotes it. */
function presetPath(name: string): string {
  return `exportPresets[${JSON.stringify(name)}]`
}

/**
 * Compiles only when `rest` is empty — each case below destructures the values
 * its code carries and hands the rest here, so a value added to a code's params
 * fails to build until its sentence uses it.
 */
function allUsed(rest: Record<string, never>): void {
  void rest
}

/** A problem as an unrendered message: its key, its values, and what it offers instead. */
function exportProblemRef(problem: ExportProblem): SyncMessageRef {
  switch (problem.code) {
    case 'columns-empty':
      allUsed(problem.params)
      return syncRef(PROBLEM_KEYS[problem.code], { columns: offered(EXPORT_PROPERTIES) })
    case 'conditions-empty':
      allUsed(problem.params)
      return syncRef(PROBLEM_KEYS[problem.code], { values: offered(CONDITION_FILTER_VALUES) })
    case 'labels-empty':
      allUsed(problem.params)
      return syncRef(PROBLEM_KEYS[problem.code], { values: offered(LABEL_FILTER_VALUES) })
    case 'presets-not-object':
      allUsed(problem.params)
      return syncRef(PROBLEM_KEYS[problem.code])
    case 'column-unknown': {
      const { column, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { column, columns: offered(EXPORT_PROPERTIES) })
    }
    case 'column-duplicate': {
      const { column, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { column })
    }
    case 'condition-invalid': {
      const { value, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], {
        value,
        values: offered(CONDITION_FILTER_VALUES),
      })
    }
    case 'label-invalid': {
      const { value, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { value, values: offered(LABEL_FILTER_VALUES) })
    }
    case 'preset-not-object':
    case 'preset-columns-not-array': {
      const { name, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { preset: presetPath(name) })
    }
    case 'preset-format-invalid': {
      const { name, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], {
        preset: presetPath(name),
        formats: offered(EXPORT_FORMATS),
      })
    }
    case 'preset-columns-invalid': {
      const { name, reason, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], {
        preset: presetPath(name),
        reason: exportProblemRef(reason),
      })
    }
    case 'preset-field-not-boolean': {
      const { name, field, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { preset: presetPath(name), field })
    }
    case 'preset-dialect-invalid': {
      const { name, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], {
        preset: presetPath(name),
        dialects: offered(EXPORT_DIALECTS),
      })
    }
    case 'file-name-exhausted': {
      const { attempts, dir, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { count: attempts, dir })
    }
    case 'file-name-not-basename': {
      const { name, ...rest } = problem.params
      allUsed(rest)
      return syncRef(PROBLEM_KEYS[problem.code], { name })
    }
  }
}

/** A warning as an unrendered message: its key and its values, a list's own message nested. */
function exportWarningRef(warning: ExportWarning): SyncMessageRef {
  switch (warning.code) {
    case 'list-warning': {
      const { list, warning: inner, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], { list, warning: nestSync(inner) })
    }
    case 'cards-unmatched': {
      const { terms, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], { terms })
    }
    case 'scryfall-id-unpinned':
    case 'edhrec-rank-uncached': {
      const { name, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], { name })
    }
    case 'scryfall-id-uncached': {
      const { name, printing, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], { name, printing })
    }
    case 'extras-omitted': {
      const { sections, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], {
        sections: syncList(
          sections.map(({ section, quantity }) =>
            syncRef('domain.export.warning.sectionCount', { section, quantity }),
          ),
          'unit',
        ),
      })
    }
    case 'categories-unwritable': {
      const { categories, ...rest } = warning.params
      allUsed(rest)
      return syncRef(WARNING_KEYS[warning.code], { categories: syncList(categories, 'unit') })
    }
  }
}

/** A problem as English plus its key and params — what an API response, MCP, the CLI's envelope or the config carry. */
export function exportProblemMessage(problem: ExportProblem): SyncMessage {
  return toSyncMessage(exportProblemRef(problem))
}

/** A warning as English plus its key and params — what an API response, MCP or JSON carry. */
export function exportWarningMessage(warning: ExportWarning): SyncMessage {
  return toSyncMessage(exportWarningRef(warning))
}

/** A warning in `locale` — the active UI locale by default. */
export function renderExportWarning(warning: ExportWarning, locale?: LocaleTag): string {
  return renderSyncMessage(exportWarningRef(warning), locale)
}
