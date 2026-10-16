import { MAX_EDIT_BODY_SIZE } from '../validation'
import {
  buildExportSelection,
  parseConditionFilterValues,
  parseLabelFilterValues,
  type ExportFilters,
} from '../../export/entries'
import { parseTagFilterValues } from '../../card/card-tags'
import { renderExport } from '../../export/output'
import { getCachedCardPrintings } from '../../scryfall'
import {
  EXPORT_FORMATS,
  exportPresetNames,
  findExportPreset,
  resolveExportSettings,
  type ExportFormat,
  type ExportPreset,
  type ExportSettingsFlags,
} from '../../export/presets'
import { EXPORT_DIALECTS, parseExportColumns } from '../../export/render'
import { listExistingExports, writeExportFile } from '../../export/file'
import { VALID_FINISHES } from '../../card/finish-condition'
import { isListType } from '../../list/list-type'
import { parseSetCode } from '../../card/set-codes'
import {
  resolveListErrorMessage,
  isResolveListError,
  listLocations,
  resolveList,
  type ListLocation,
} from '../../list/resolve-list'
import { getExportPresets } from '../../config/ritual-config'
import {
  badRequest,
  errorResponse,
  nestedRefusal,
  readJsonObjectBody,
  type ApiErrorResponse,
} from '../../api/http'
import { apiMessage, isApiMessage, parseEnumParam } from '../../api/result'
import { isSyncMessage, type SyncMessage } from '../../sync/message'
import { exportProblemMessage, exportWarningMessage } from '../../export-wording/message'

/** One list selection in the request body. */
export type ExportRequestListRef = { type?: string; name: string }

/** The request body's filter block (validated into {@link ExportFilters}). */
type ExportRequestFilters = {
  name?: string
  set?: string
  finish?: string
  /** Condition values to match; `'none'` selects entries without one marked. */
  conditions?: string[]
  /** Label values to match against effective labels; `'none'` selects unlabeled entries. */
  labels?: string[]
  /** Tags to match, any of them; every list type, exact and case-sensitive. */
  tags?: string[]
}

/** `POST /api/export` request body; every field is optional. */
export type ExportRequestBody = {
  /** Lists to export whole; names are resolved like CLI list arguments. */
  lists?: ExportRequestListRef[]
  /** Card-pick terms searched across every list (each adds its matches). */
  cards?: string[]
  filters?: ExportRequestFilters
  format?: string
  columns?: string[]
  header?: boolean
  quoteAll?: boolean
  /**
   * Output vocabulary: for `csv`/`json` the value spellings of
   * finish/condition/language (`archidekt`), and for `text` the decklist's line
   * and board form (`arena`, `moxfield`; `ritual` and `archidekt` both write
   * Ritual's own flat `(SET:CN)` lines). Ignored — and rejected — for `md`,
   * which is always Ritual's canonical markdown. `ritual` by default.
   */
  dialect?: string
  /** A saved or built-in preset name; explicit fields above override its values. */
  preset?: string
  /** Write the export to a server-chosen file under `exports/` instead of returning its content. */
  write?: boolean
}

/** What both modes of a `POST /api/export` success carry. */
export type ExportResponseCommon = {
  success: true
  format: ExportFormat
  entryCount: number
  /** What the export reports beside its output: English plus the key, params possibly nested. */
  warnings: SyncMessage[]
}

/** Content mode: the rendered export inline. */
export type ExportContentResponse = ExportResponseCommon & {
  mode: 'content'
  content: string
}

/** File mode: the base-dir-relative path of the file written. */
export type ExportFileResponse = ExportResponseCommon & {
  mode: 'file'
  /** Base-dir-relative, e.g. `exports/binder-20260728.csv`. */
  path: string
  bytes: number
}

/** `POST /api/export` success body, discriminated by `mode`. */
export type ExportResponseBody = ExportContentResponse | ExportFileResponse

/** Every body `POST /api/export` can return. */
export type ExportResponse = ExportResponseBody | ApiErrorResponse

/**
 * Validate the body's output-shape fields into settings flags, or the refusal —
 * a message whose params may nest (a column refusal offers the column ids as a
 * list).
 */
function parseSettingsFlags(body: ExportRequestBody): ExportSettingsFlags | SyncMessage {
  const flags: ExportSettingsFlags = {}
  if (body.header !== undefined) {
    if (typeof body.header !== 'boolean') {
      return apiMessage('admin.api.field.notBoolean', { field: 'header' })
    }
    flags.header = body.header
  }
  if (body.quoteAll !== undefined) {
    if (typeof body.quoteAll !== 'boolean') {
      return apiMessage('admin.api.field.notBoolean', { field: 'quoteAll' })
    }
    flags.quoteAll = body.quoteAll
  }
  if (body.format !== undefined) {
    const format = parseEnumParam(body.format, EXPORT_FORMATS, 'format')
    if (isApiMessage(format)) return format
    flags.format = format
  }
  if (body.columns !== undefined) {
    if (!Array.isArray(body.columns)) return apiMessage('admin.api.export.columnsNotArray')
    const columns = parseExportColumns(body.columns)
    if (!columns.ok) return exportProblemMessage(columns.problem)
    flags.columns = columns.value
  }
  if (body.dialect !== undefined) {
    const dialect = parseEnumParam(body.dialect, EXPORT_DIALECTS, 'dialect')
    if (isApiMessage(dialect)) return dialect
    flags.dialect = dialect
  }
  return flags
}

/**
 * Validate the body's filters, or the refusal — a message whose params may nest
 * (a tag refusal carries the tag shape rule as a message of its own).
 */
function parseFilters(raw: ExportRequestFilters | undefined): ExportFilters | SyncMessage {
  const filters: ExportFilters = {}
  if (raw === undefined) return filters
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return apiMessage('admin.api.export.filtersNotObject')
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') {
      return apiMessage('admin.api.field.notString', { field: 'filters.name' })
    }
    filters.name = raw.name
  }
  if (raw.set !== undefined) {
    if (typeof raw.set !== 'string') {
      return apiMessage('admin.api.field.notString', { field: 'filters.set' })
    }
    // Through the canonical set-code parser so a malformed code is a refusal
    // rather than a filter that silently matches nothing, and so the stored
    // value is lowercase like every other in-memory set code.
    const set = parseSetCode(raw.set)
    if (!set.ok) return set.error
    filters.set = set.code
  }
  if (raw.finish !== undefined) {
    const finish = parseEnumParam(raw.finish, VALID_FINISHES, 'filters.finish')
    if (isApiMessage(finish)) return finish
    filters.finish = finish
  }
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) return apiMessage('admin.api.export.conditionsNotArray')
    const conditions = parseConditionFilterValues(raw.conditions)
    if (!conditions.ok) return exportProblemMessage(conditions.problem)
    filters.conditions = conditions.value
  }
  if (raw.labels !== undefined) {
    if (!Array.isArray(raw.labels)) return apiMessage('admin.api.export.labelsNotArray')
    const labels = parseLabelFilterValues(raw.labels)
    if (!labels.ok) return exportProblemMessage(labels.problem)
    filters.labels = labels.value
  }
  if (raw.tags !== undefined) {
    // The parser refuses a non-array itself, naming the body path.
    const tags = parseTagFilterValues(raw.tags, 'filters.tags')
    if (isSyncMessage(tags)) return tags
    filters.tags = tags
  }
  return filters
}

/**
 * `POST /api/export` — assemble and render a card export. Mirrors the CLI
 * `export` command's flag mode: selected lists (or every list when none are
 * named and no card picks are given) plus card picks, filtered, rendered to
 * CSV, JSON, plain text, or Markdown (columns and the CSV toggles only shape
 * csv/json output; the dialect shapes those plus the plain-text decklist's line
 * and board form).
 *
 * Returns the rendered content inline (`mode: 'content'`) by default. With
 * `write: true` the render is written to a server-named file under the
 * gitignored `exports/` directory in the base dir and the response carries its
 * base-dir-relative `path` instead (`mode: 'file'`); an existing name is never
 * overwritten.
 */
export async function handleExport(req: Request): Promise<Response> {
  try {
    const read = await readJsonObjectBody(req, MAX_EDIT_BODY_SIZE)
    if (!read.ok) return read.response
    const body = read.body as ExportRequestBody

    let preset: ExportPreset | undefined
    if (body.preset !== undefined) {
      if (typeof body.preset !== 'string') {
        return badRequest(apiMessage('admin.api.field.notString', { field: 'preset' }))
      }
      const saved = getExportPresets()
      preset = findExportPreset(body.preset, saved)
      if (!preset) {
        return badRequest(
          apiMessage('admin.api.export.presetUnknown', {
            name: body.preset,
            presets: exportPresetNames(saved).join(', '),
          }),
        )
      }
    }
    const flags = parseSettingsFlags(body)
    if (isSyncMessage(flags)) return nestedRefusal(flags)
    const settings = resolveExportSettings(preset, flags)

    const filters = parseFilters(body.filters)
    if (isSyncMessage(filters)) return nestedRefusal(filters)

    if (body.write !== undefined && typeof body.write !== 'boolean') {
      return badRequest(apiMessage('admin.api.field.notBoolean', { field: 'write' }))
    }

    const cards = body.cards ?? []
    if (!Array.isArray(cards) || cards.some((terms) => typeof terms !== 'string')) {
      return badRequest(apiMessage('admin.api.export.cardsInvalid'))
    }

    if (body.lists !== undefined && !Array.isArray(body.lists)) {
      // i18n-exempt: a JSON shape, wire vocabulary spliced into the sentence (catalog text cannot hold braces)
      const shape = '{ type?, name }'
      return badRequest(apiMessage('admin.api.export.listsNotArray', { shape }))
    }
    const listRefs = body.lists ?? []
    const selected: ListLocation[] = []
    for (const list of listRefs) {
      if (typeof list?.name !== 'string') {
        return badRequest(apiMessage('admin.api.export.listNameMissing'))
      }
      if (list.type !== undefined && (typeof list.type !== 'string' || !isListType(list.type))) {
        return badRequest(
          apiMessage('admin.api.export.listTypeInvalid', { type: String(list.type) }),
        )
      }
      const resolved = await resolveList(list.name, list.type)
      // Each ref carries its own optional `type`, so that field — not a longer
      // name — is what resolves a cross-type ambiguity here.
      if (isResolveListError(resolved))
        return nestedRefusal(resolveListErrorMessage(resolved, 'type-field'))
      if (!selected.some((s) => s.type === resolved.type && s.name === resolved.name)) {
        selected.push(resolved)
      }
    }
    const scope = await listLocations()
    // The lists the caller actually named, captured before the "no selection means
    // everything" expansion below — the export filename describes the request, so
    // an unscoped export is named `all-lists` even in a one-list workspace.
    const namedLists = [...selected]
    if (listRefs.length === 0 && cards.length === 0) {
      selected.push(...scope)
    }

    const selection = await buildExportSelection(selected, scope, cards, filters)
    const rendered = await renderExport(selection.entries, settings, {
      lookupPrintings: getCachedCardPrintings,
    })
    const warnings = [...selection.warnings, ...rendered.warnings].map(exportWarningMessage)

    if (body.write === true) {
      const written = await writeExportFile(rendered.content, {
        lists: namedLists,
        hasCardPicks: cards.length > 0,
        format: settings.format,
        now: new Date(),
        existing: await listExistingExports(),
      })
      // A name the server could not settle on is the server's failure, not the caller's.
      if (!written.ok) return nestedRefusal(exportProblemMessage(written.problem), 500)
      const filePayload: ExportFileResponse = {
        success: true,
        mode: 'file',
        format: settings.format,
        entryCount: selection.entries.length,
        warnings,
        path: written.value.path,
        bytes: written.value.bytes,
      }
      return Response.json(filePayload)
    }

    const payload: ExportContentResponse = {
      success: true,
      mode: 'content',
      format: settings.format,
      entryCount: selection.entries.length,
      warnings,
      content: rendered.content,
    }
    return Response.json(payload)
  } catch (error) {
    return errorResponse(error)
  }
}
