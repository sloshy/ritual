import { hashPath } from '../../content-hash'
import { isListType, LIST_TYPES, type ListType } from '../../list-type'
import { DECK_FORMAT_KEYS, normalizeFormatKey, type DeckFormatKey } from '../../deck-format'
import { convertCsvRows, parseColumnsSpec, parseCsv, type CsvRowFailure } from '../../importers/csv'
import { applyCsvImport, type CsvImportMode } from '../../importers/csv-apply'
import { dirForType } from '../../resolve-list'
import { apiHandler } from '../utils'
import { autoCommitAndPush } from './save-helpers'

/**
 * CSV import request from the admin site (and, through the in-process dispatch,
 * the MCP server). Carries the raw CSV text plus the same column-mapping spec
 * the CLI's `--columns` flag uses.
 */
interface ImportCsvRequest {
  listType: ListType
  /** New list name for create/overwrite, or an existing list for append. */
  name: string
  /** Defaults to 'create'. */
  mode?: CsvImportMode
  /** Deck format; required when creating or overwriting a deck. */
  format?: string
  /** Raw CSV text. */
  content: string
  /** Column mapping spec like `name=1,set=2,collector-number=3` (1-based). */
  columns: string
  /** Whether the first row is a header row. Defaults to true. */
  hasHeader?: boolean
}

export interface ImportCsvResponse {
  success: boolean
  message: string
  cardCount?: number
  /** Rows that failed validation (the rest were still imported). */
  failures?: CsvRowFailure[]
}

const MODES: readonly CsvImportMode[] = ['create', 'overwrite', 'append']

function isImportCsvRequest(value: unknown): value is ImportCsvRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.listType === 'string' &&
    typeof record.name === 'string' &&
    typeof record.content === 'string' &&
    typeof record.columns === 'string' &&
    (record.mode === undefined || MODES.includes(record.mode as CsvImportMode)) &&
    (record.format === undefined || typeof record.format === 'string') &&
    (record.hasHeader === undefined || typeof record.hasHeader === 'boolean')
  )
}

function badRequest(message: string, failures?: CsvRowFailure[]): Response {
  const resp: ImportCsvResponse = { success: false, message, failures }
  return Response.json(resp, { status: 400 })
}

export function handleImportCsv(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const body: unknown = await req.json()
    if (!isImportCsvRequest(body)) {
      return badRequest(
        'Invalid request: expected listType, name, content, and columns (with optional mode, format, hasHeader)',
      )
    }

    if (!isListType(body.listType)) {
      return badRequest(`Invalid listType '${body.listType}'. Use: ${LIST_TYPES.join(', ')}`)
    }
    const listType = body.listType
    const mode = body.mode ?? 'create'

    const name = body.name.trim()
    if (name === '') return badRequest('name is required')

    let format: DeckFormatKey | undefined
    if (body.format !== undefined) {
      const normalized = normalizeFormatKey(body.format)
      if (normalized === null) {
        return badRequest(
          `Invalid deck format '${body.format}'. Valid formats: ${DECK_FORMAT_KEYS.join(', ')}`,
        )
      }
      format = normalized
    }
    if (listType === 'deck' && mode !== 'append' && format === undefined) {
      return badRequest('format is required when creating or overwriting a deck')
    }

    const parsed = parseCsv(body.content)
    if ('error' in parsed) return badRequest(`Failed to parse CSV: ${parsed.error}`)

    const mapping = parseColumnsSpec(body.columns, listType)
    if (typeof mapping === 'string') return badRequest(mapping)

    const hasHeader = body.hasHeader ?? true
    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
    if (dataRows.length === 0) return badRequest('CSV contains no data rows')

    const { entries, failures } = convertCsvRows(dataRows, mapping, listType)
    if (entries.length === 0) {
      return badRequest('No rows could be imported', failures)
    }

    const result = await applyCsvImport({ listType, name, mode, format }, entries)
    if ('error' in result) return badRequest(result.error)

    const filesToCommit = [result.filePath, hashPath(result.filePath)]
    if (result.changelogPath) filesToCommit.push(result.changelogPath)
    await autoCommitAndPush(
      dirForType(listType),
      filesToCommit,
      `Import CSV into ${listType}: ${name} (${result.cardCount} cards)`,
    )

    const verb = result.mode === 'append' ? 'Appended' : 'Imported'
    const preposition = result.mode === 'append' ? 'to' : 'into'
    const resp: ImportCsvResponse = {
      success: true,
      message: `${verb} ${result.cardCount} card(s) ${preposition} ${listType} '${name}'`,
      cardCount: result.cardCount,
      failures: failures.length > 0 ? failures : undefined,
    }
    return Response.json(resp)
  })
}
