import { getErrorMessage } from '../../errors'
import {
  buildExportSelection,
  parseConditionFilterValues,
  type ExportFilters,
} from '../../export/entries'
import { renderExport } from '../../export/output'
import {
  EXPORT_FORMATS,
  exportPresetNames,
  findExportPreset,
  isExportFormat,
  resolveExportSettings,
  type ExportPreset,
  type ExportSettingsFlags,
} from '../../export/presets'
import { EXPORT_DIALECTS, isExportDialect, parseExportColumns } from '../../export/render'
import { listExistingExports, writeExportFile } from '../../export/file'
import { isFinish } from '../../finish-condition'
import { isListType } from '../../list-type'
import {
  formatResolveListError,
  isResolveListError,
  listLocations,
  resolveList,
  type ListLocation,
} from '../../resolve-list'
import { getExportPresets } from '../../ritual-config'
import { validateBodySize } from './save-helpers'

/** One list selection in the request body. */
export type ExportRequestListRef = { type?: string; name: string }

/** The request body's filter block (validated into {@link ExportFilters}). */
type ExportRequestFilters = {
  name?: string
  set?: string
  finish?: string
  /** Condition values to match; `'none'` selects entries without one marked. */
  conditions?: string[]
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
  /** Value spellings for finish/condition; `ritual` by default. */
  dialect?: string
  /** A saved or built-in preset name; explicit fields above override its values. */
  preset?: string
  /** Write the export to a server-chosen file under `exports/` instead of returning its content. */
  write?: boolean
}

/** Content mode: the rendered export inline. */
export type ExportContentResponse = {
  success: true
  mode: 'content'
  format: string
  entryCount: number
  warnings: string[]
  content: string
}

/** File mode: the base-dir-relative path of the file written. */
export type ExportFileResponse = {
  success: true
  mode: 'file'
  format: string
  entryCount: number
  warnings: string[]
  /** Base-dir-relative, e.g. `exports/binder-20260728.csv`. */
  path: string
  bytes: number
}

/** `POST /api/export` success body, discriminated by `mode`. */
export type ExportResponseBody = ExportContentResponse | ExportFileResponse

/** `POST /api/export` failure body. */
export type ExportErrorResponse = { success: false; message: string }

/** Every body `POST /api/export` can return. */
export type ExportResponse = ExportResponseBody | ExportErrorResponse

function badRequest(message: string): Response {
  const body: ExportErrorResponse = { success: false, message }
  return Response.json(body, { status: 400 })
}

/** Validate the body's output-shape fields into settings flags, or an error string. */
function parseSettingsFlags(body: ExportRequestBody): ExportSettingsFlags | string {
  const flags: ExportSettingsFlags = {}
  if (body.header !== undefined) {
    if (typeof body.header !== 'boolean') return 'header must be a boolean.'
    flags.header = body.header
  }
  if (body.quoteAll !== undefined) {
    if (typeof body.quoteAll !== 'boolean') return 'quoteAll must be a boolean.'
    flags.quoteAll = body.quoteAll
  }
  if (body.format !== undefined) {
    if (typeof body.format !== 'string' || !isExportFormat(body.format)) {
      return `Invalid format '${String(body.format)}'. Use one of: ${EXPORT_FORMATS.join(', ')}.`
    }
    flags.format = body.format
  }
  if (body.columns !== undefined) {
    if (!Array.isArray(body.columns)) return 'columns must be an array of property names.'
    const columns = parseExportColumns(body.columns)
    if (typeof columns === 'string') return columns
    flags.columns = columns
  }
  if (body.dialect !== undefined) {
    if (typeof body.dialect !== 'string' || !isExportDialect(body.dialect)) {
      return `Invalid dialect '${String(body.dialect)}'. Use one of: ${EXPORT_DIALECTS.join(', ')}.`
    }
    flags.dialect = body.dialect
  }
  return flags
}

/** Validate the body's filters, or an error string. */
function parseFilters(raw: ExportRequestFilters | undefined): ExportFilters | string {
  const filters: ExportFilters = {}
  if (raw === undefined) return filters
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'filters must be an object.'
  }
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') return 'filters.name must be a string.'
    filters.name = raw.name
  }
  if (raw.set !== undefined) {
    if (typeof raw.set !== 'string') return 'filters.set must be a string.'
    filters.set = raw.set
  }
  if (raw.finish !== undefined) {
    if (typeof raw.finish !== 'string' || !isFinish(raw.finish)) {
      return `Invalid finish '${String(raw.finish)}'.`
    }
    filters.finish = raw.finish
  }
  if (raw.conditions !== undefined) {
    if (!Array.isArray(raw.conditions)) {
      return 'filters.conditions must be an array of condition values.'
    }
    const conditions = parseConditionFilterValues(raw.conditions)
    if (typeof conditions === 'string') return conditions
    filters.conditions = conditions
  }
  return filters
}

/**
 * `POST /api/export` — assemble and render a card export. Mirrors the CLI
 * `export` command's flag mode: selected lists (or every list when none are
 * named and no card picks are given) plus card picks, filtered, rendered to
 * CSV, JSON, plain text, or Markdown (columns, the CSV toggles, and the value
 * dialect only shape csv/json output).
 *
 * Returns the rendered content inline (`mode: 'content'`) by default. With
 * `write: true` the render is written to a server-named file under the
 * gitignored `exports/` directory in the base dir and the response carries its
 * base-dir-relative `path` instead (`mode: 'file'`); an existing name is never
 * overwritten.
 */
export async function handleExport(req: Request): Promise<Response> {
  try {
    const sizeError = validateBodySize(req)
    if (sizeError) return sizeError

    let body: ExportRequestBody
    try {
      body = (await req.json()) as ExportRequestBody
    } catch {
      return badRequest('Request body must be JSON.')
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return badRequest('Request body must be a JSON object.')
    }

    let preset: ExportPreset | undefined
    if (body.preset !== undefined) {
      if (typeof body.preset !== 'string') return badRequest('preset must be a string.')
      const saved = getExportPresets()
      preset = findExportPreset(body.preset, saved)
      if (!preset) {
        return badRequest(
          `No export preset named '${body.preset}'. Available presets: ${exportPresetNames(saved).join(', ')}.`,
        )
      }
    }
    const flags = parseSettingsFlags(body)
    if (typeof flags === 'string') return badRequest(flags)
    const settings = resolveExportSettings(preset, flags)

    const filters = parseFilters(body.filters)
    if (typeof filters === 'string') return badRequest(filters)

    if (body.write !== undefined && typeof body.write !== 'boolean') {
      return badRequest('write must be a boolean.')
    }

    if (body.cards !== undefined && !Array.isArray(body.cards)) {
      return badRequest('cards must be an array of search-term strings.')
    }
    const cards = body.cards ?? []
    if (cards.some((terms) => typeof terms !== 'string')) {
      return badRequest('cards must be an array of search-term strings.')
    }

    if (body.lists !== undefined && !Array.isArray(body.lists)) {
      return badRequest('lists must be an array of { type?, name } objects.')
    }
    const listRefs = body.lists ?? []
    const selected: ListLocation[] = []
    for (const list of listRefs) {
      if (typeof list?.name !== 'string') return badRequest('Each list needs a name.')
      if (list.type !== undefined && (typeof list.type !== 'string' || !isListType(list.type))) {
        return badRequest(`Invalid list type '${String(list.type)}'.`)
      }
      const resolved = await resolveList(list.name, list.type)
      if (isResolveListError(resolved)) return badRequest(formatResolveListError(resolved))
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
    const rendered = await renderExport(selection.entries, settings)
    const warnings = [...selection.warnings, ...rendered.warnings]

    if (body.write === true) {
      const written = await writeExportFile(rendered.content, {
        lists: namedLists,
        hasCardPicks: cards.length > 0,
        format: settings.format,
        now: new Date(),
        existing: await listExistingExports(),
      })
      const filePayload: ExportFileResponse = {
        success: true,
        mode: 'file',
        format: settings.format,
        entryCount: selection.entries.length,
        warnings,
        path: written.path,
        bytes: written.bytes,
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
    const body: ExportErrorResponse = { success: false, message: getErrorMessage(error) }
    return Response.json(body, { status: 500 })
  }
}
