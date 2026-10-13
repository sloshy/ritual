import { hashPath } from '../../changes/content-hash'
import { isListType, LIST_TYPES, type ListType } from '../../list/list-type'
import {
  invalidDeckFormatMessage,
  parseDeckFormat,
  type DeckFormatKey,
} from '../../list/deck-format'
import {
  convertCsvRows,
  csvRowWarningMessage,
  guessHasHeader,
  parseColumnsSpec,
  parseCsv,
  validateMappingWidth,
  type CsvRowFailure,
} from '../../importers/csv'
import { applyCsvImport, type CsvImportMode } from '../../importers/csv-apply'
import { dirForType } from '../../list/resolve-list'
import { apiHandler } from '../utils'
import { apiMessage, plainMessage } from '../../api/result'
import {
  isSyncMessage,
  nestSync,
  syncMessage,
  syncRef,
  toSyncMessage,
  type SyncMessage,
  type SyncMessageParamsFor,
  type SyncMessageRef,
} from '../../sync/message'
import { autoCommitAndPush } from './save-helpers'
import { badRequest, nestedRefusal, readJsonObjectBody } from '../../api/http'
import { MAX_UPLOAD_BODY_SIZE } from '../validation'
import { bakedLocales } from '../../i18n/runtime'

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
export interface ImportCsvResponse extends SyncMessage {
  success: true
  /**
   * **Copies** imported — the sum of the accepted rows' quantities, not the row
   * count. Always present; `0` when every row failed validation.
   */
  cardCount: number
  /**
   * Rows that failed validation; the rest were still imported. Always present.
   * Each carries its English `reason` plus `reasonKey` / `reasonParams`.
   */
  failures: CsvRowFailure[]
  /**
   * `failures.length` — a **row** count, unlike `cardCount`'s copies. Named so a
   * client can branch on it without walking the array.
   */
  failedCount: number
  /**
   * Notices about the import as a whole, as opposed to a single row: what
   * `hasHeader` caused, category values a row refused, and anything that went
   * wrong writing the list's categories sidecar. A client has no wizard to ask
   * the header question with, so the assumption is stated out loud — dropping a
   * data row as a header is a lost card that would otherwise look like a clean
   * import. Always present. Each is a message: English `message`, plus
   * `messageKey` / `messageParams` (which may nest) when it has a catalog entry.
   */
  warnings: SyncMessage[]
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

/** What a CSV import wrote, as its summary names it. */
type CsvImportOutcome = {
  listType: ListType
  name: string
  /** Whether the rows were added to an existing list rather than creating or replacing one. */
  appended: boolean
  /** Copies written. */
  cardCount: number
}

/**
 * The import's summary. A partial import says so in the same message: `message`
 * is what the admin UI banners and what an agent reads back, and a count of what
 * worked reads as "it all worked" unless the rest is named beside it. A
 * {@link SyncMessage} because the counts are plural nouns nested as params.
 */
function csvImportMessage(outcome: CsvImportOutcome, failedRows: number): SyncMessage {
  const params: SyncMessageParamsFor<'admin.api.importCsv.imported'> = {
    listType: outcome.listType,
    cards: syncRef('domain.count.cards', { count: outcome.cardCount }),
    name: outcome.name,
  }
  const result: SyncMessageRef = outcome.appended
    ? syncRef('admin.api.importCsv.appended', params)
    : syncRef('admin.api.importCsv.imported', params)
  if (failedRows === 0) return toSyncMessage(result)
  return syncMessage('admin.api.importCsv.partial', {
    result,
    failed: syncRef('admin.api.importCsv.rowsFailed', { count: failedRows }),
  })
}

export function handleImportCsv(req: Request): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req, MAX_UPLOAD_BODY_SIZE)
    if (!parsedBody.ok) return parsedBody.response
    const body: unknown = parsedBody.body
    if (!isImportCsvRequest(body)) {
      return badRequest(
        apiMessage('admin.api.importCsv.invalidRequest', {
          types: LIST_TYPES.join(', '),
          modes: MODES.join('|'),
        }),
      )
    }
    const listType = body.listType
    const mode = body.mode ?? 'create'

    const name = body.name.trim()
    if (name === '') return badRequest(apiMessage('admin.api.importCsv.nameRequired'))

    let format: DeckFormatKey | undefined
    if (body.format !== undefined) {
      const normalized = parseDeckFormat(body.format)
      if (normalized === null) {
        return badRequest(plainMessage(invalidDeckFormatMessage(body.format)))
      }
      format = normalized
    }
    if (listType === 'deck' && mode !== 'append' && format === undefined) {
      return badRequest(apiMessage('admin.api.importCsv.formatRequired'))
    }

    const parsed = parseCsv(body.content)
    if ('error' in parsed) {
      return nestedRefusal(
        syncMessage('admin.api.importCsv.parseFailed', { reason: nestSync(parsed.error) }),
      )
    }

    const mapping = parseColumnsSpec(body.columns, listType)
    if (isSyncMessage(mapping)) return nestedRefusal(mapping)

    // A mapped column the file has no column for is one bad *request*, not a
    // per-row 'Missing card name' for every row — the CLI exits 2 on the same
    // check (see `validateMappingWidth`), and this is the shared engine's rule.
    const columnCount = Math.max(...parsed.rows.map((row) => row.cells.length))
    const widthError = validateMappingWidth(mapping, columnCount)
    if (widthError !== null) return nestedRefusal(widthError)

    const hasHeader = body.hasHeader ?? true
    const warnings: SyncMessage[] = []
    const firstRow = parsed.rows[0]
    if (hasHeader && firstRow !== undefined) {
      warnings.push(syncMessage('admin.api.importCsv.headerSkipped', { row: firstRow.raw }))
      // English plus every language this build ships, never the server's own
      // UI language: the answer — and so `warnings` — is the same bytes whoever
      // runs the server, and a reader's localized headings are not called
      // suspicious because the operator speaks another language.
      if (!guessHasHeader(firstRow.cells, bakedLocales())) {
        warnings.push(syncMessage('admin.api.importCsv.headerSuspicious', { row: firstRow.raw }))
      }
    }
    const dataRows = hasHeader ? parsed.rows.slice(1) : parsed.rows
    if (dataRows.length === 0) return badRequest(apiMessage('admin.api.importCsv.noDataRows'))

    const { entries, failures, warnings: rowWarnings } = convertCsvRows(dataRows, mapping, listType)
    warnings.push(...rowWarnings.map(csvRowWarningMessage))
    if (entries.length === 0) {
      // A well-formed request whose every row failed validation: the per-row
      // report is the answer, and there is nothing to write.
      const empty: ImportCsvResponse = {
        success: true,
        ...csvImportMessage({ listType, name, appended: false, cardCount: 0 }, failures.length),
        cardCount: 0,
        failures,
        failedCount: failures.length,
        warnings,
      }
      return Response.json(empty)
    }

    const result = await applyCsvImport({ listType, name, mode, format }, entries, {
      sourceHadLanguageColumn: mapping.language !== undefined,
      sourceHadCategoriesColumn: mapping.categories !== undefined,
    })
    if ('error' in result) return nestedRefusal(result.error)
    warnings.push(...result.categoryNotices)
    if (result.categoryError !== undefined) warnings.push(result.categoryError)

    // The categories sidecar and its `.sha256` are written by the import too, so
    // they join the auto-commit set; an import with no categories column writes
    // neither, and adds no path `git add` would fail on.
    const filesToCommit = [result.filePath, hashPath(result.filePath), ...result.writtenFiles]
    if (result.changelogPath) filesToCommit.push(result.changelogPath)
    await autoCommitAndPush(
      dirForType(listType),
      filesToCommit,
      `Import CSV into ${listType}: ${name} (${result.cardCount} cards)`,
    )

    const resp: ImportCsvResponse = {
      success: true,
      ...csvImportMessage(
        { listType, name, appended: result.mode === 'append', cardCount: result.cardCount },
        failures.length,
      ),
      cardCount: result.cardCount,
      failures,
      failedCount: failures.length,
      warnings,
    }
    return Response.json(resp)
  })
}
