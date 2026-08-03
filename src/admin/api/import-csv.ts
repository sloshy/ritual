import { hashPath } from '../../content-hash'
import { isListType, LIST_TYPES, type ListType } from '../../list-type'
import { invalidDeckFormatMessage, parseDeckFormat, type DeckFormatKey } from '../../deck-format'
import {
  convertCsvRows,
  guessHasHeader,
  parseColumnsSpec,
  parseCsv,
  validateMappingWidth,
  type CsvRowFailure,
} from '../../importers/csv'
import { applyCsvImport, type CsvImportMode } from '../../importers/csv-apply'
import { dirForType } from '../../resolve-list'
import { apiHandler } from '../utils'
import { autoCommitAndPush, badRequest, readJsonObjectBody } from './save-helpers'

/**
 * CSV import request from the admin site (and, through the in-process dispatch,
 * the MCP server). Carries the raw CSV text plus the same column-mapping spec
 * the CLI's `--columns` flag uses.
 */
export interface ImportCsvRequest {
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

/**
 * `POST /api/import-csv` — what the import did.
 *
 * `success` is a pure envelope flag. A partially-failed import is still a
 * processed request whose per-row report is the whole point, and folding that
 * into the envelope is what made every client treating `success: false` as
 * "throw" discard the report exactly when it mattered (the same reasoning
 * `import-changes.ts` records for the bundle import). A 400 here means the
 * *request* was malformed, never that some rows were.
 */
export interface ImportCsvResponse {
  success: true
  message: string
  /**
   * **Copies** imported — the sum of the accepted rows' quantities, not the row
   * count. Always present; `0` when every row failed validation.
   */
  cardCount: number
  /** Rows that failed validation; the rest were still imported. Always present. */
  failures: CsvRowFailure[]
  /**
   * `failures.length` — a **row** count, unlike `cardCount`'s copies. Named so a
   * client can branch on it without walking the array.
   */
  failedCount: number
  /**
   * Notices about the import as a whole, as opposed to a single row: today, what
   * `hasHeader` caused. A client has no wizard to ask the header question with,
   * so the assumption is stated out loud — dropping a data row as a header is a
   * lost card that would otherwise look like a clean import. Always present.
   */
  warnings: string[]
}

const MODES: readonly CsvImportMode[] = ['create', 'overwrite', 'append']

function isCsvImportMode(value: unknown): value is CsvImportMode {
  return typeof value === 'string' && MODES.includes(value as CsvImportMode)
}

/**
 * Whether a parsed body is an {@link ImportCsvRequest}.
 *
 * The two closed vocabularies are proved rather than assumed: the guard used to
 * claim `listType: ListType` off a bare `typeof === 'string'` and `mode:
 * CsvImportMode` off a cast, which is a predicate that lies — the handler then
 * had to re-check `listType` anyway to get a message worth reading.
 */
function isImportCsvRequest(value: unknown): value is ImportCsvRequest {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.listType === 'string' &&
    isListType(record.listType) &&
    typeof record.name === 'string' &&
    typeof record.content === 'string' &&
    typeof record.columns === 'string' &&
    (record.mode === undefined || isCsvImportMode(record.mode)) &&
    (record.format === undefined || typeof record.format === 'string') &&
    (record.hasHeader === undefined || typeof record.hasHeader === 'boolean')
  )
}

export function handleImportCsv(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response
    const body: unknown = parsedBody.body
    if (!isImportCsvRequest(body)) {
      return badRequest(
        `Invalid request: expected listType (${LIST_TYPES.join(', ')}), name, content, and columns ` +
          `(with optional mode [${MODES.join('|')}], format, hasHeader)`,
      )
    }
    const listType = body.listType
    const mode = body.mode ?? 'create'

    const name = body.name.trim()
    if (name === '') return badRequest('name is required')

    let format: DeckFormatKey | undefined
    if (body.format !== undefined) {
      const normalized = parseDeckFormat(body.format)
      if (normalized === null) {
        return badRequest(invalidDeckFormatMessage(body.format))
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

    // A mapped column the file has no column for is one bad *request*, not a
    // per-row 'Missing card name' for every row — the CLI exits 2 on the same
    // check (see `validateMappingWidth`), and this is the shared engine's rule.
    const columnCount = Math.max(...parsed.rows.map((row) => row.cells.length))
    const widthError = validateMappingWidth(mapping, columnCount)
    if (widthError !== null) return badRequest(widthError)

    const hasHeader = body.hasHeader ?? true
    const warnings: string[] = []
    const firstRow = parsed.rows[0]
    if (hasHeader && firstRow !== undefined) {
      warnings.push(`Skipped header row: ${firstRow.raw}`)
      if (!guessHasHeader(firstRow.cells)) {
        warnings.push(
          `The first row does not look like a header but was skipped as one: ${firstRow.raw}` +
            ' — set hasHeader to false to import it as a card.',
        )
      }
    }
    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
    if (dataRows.length === 0) return badRequest('CSV contains no data rows')

    const { entries, failures } = convertCsvRows(dataRows, mapping, listType)
    if (entries.length === 0) {
      // A well-formed request whose every row failed validation: the per-row
      // report is the answer, and there is nothing to write.
      const empty: ImportCsvResponse = {
        success: true,
        message: `Imported 0 card(s) into ${listType} '${name}'; ${failures.length} row(s) failed validation`,
        cardCount: 0,
        failures,
        failedCount: failures.length,
        warnings,
      }
      return Response.json(empty)
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
    // A partial import says so in the same sentence: `message` is what the admin
    // UI banners and what an agent reads back, and a count of what worked reads
    // as "it all worked" unless the rest is named beside it.
    const shortfall = failures.length > 0 ? `; ${failures.length} row(s) failed validation` : ''
    const resp: ImportCsvResponse = {
      success: true,
      message: `${verb} ${result.cardCount} card(s) ${preposition} ${listType} '${name}'${shortfall}`,
      cardCount: result.cardCount,
      failures,
      failedCount: failures.length,
      warnings,
    }
    return Response.json(resp)
  })
}
