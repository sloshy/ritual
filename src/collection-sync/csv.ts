/**
 * The CSV bulk-import path of a collection push.
 *
 * A push resolves every new printing with its own Archidekt search, so a first
 * push of a real collection is hundreds of paced requests — the rate-limit trap
 * that made a plain dry run unusable. Archidekt's own collection importer takes
 * a CSV instead, and a uid-keyed CSV needs no name matching at all: the rows are
 * built entirely from the **local Scryfall cache**, so the whole batch costs one
 * upload (or none, when the file is written for a manual import).
 *
 * Everything here is either pure or cache-only — no Archidekt request is made
 * from this module. The rows themselves are rendered by the export engine's
 * built-in `archidekt` preset ({@link ARCHIDEKT_EXPORT_SETTINGS}), so
 * `ritual export --preset archidekt` and a sync upload cannot disagree about
 * the format, the column order, or Archidekt's value spellings (variant
 * `Normal|Foil|Etched`, condition `NM|LP|MP|HP|D`).
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { CollectionCsvUploadOptions } from '../clients/ArchidektClient'
import type { CardPrintingsLookup } from '../card-printing'
import type { ExportEntry } from '../export/entries'
import { ARCHIDEKT_EXPORT_SETTINGS } from '../export/presets'
import { exportPropertyLabel, renderCsvExport, type ExportProperty } from '../export/render'
import { resolveExportScryfallIds } from '../export/scryfall-id'
import {
  archidektCsvCondition,
  archidektModifier,
  type ArchidektCsvColumn,
  type CollectionCsvRowResult,
  type CollectionCsvUploadResult,
} from '../importers/archidekt-collection'
import { parseCsv } from '../importers/csv'
import { DEFAULT_SECTION } from '../types'
// The row-failure type and its describers live in `describe.ts`: the admin page
// renders a finished report's CSV outcome, and this module reaches for the
// filesystem, so it cannot be part of the browser bundle.
import { describeCollectionKey, type CollectionCsvFailure } from './describe'
import type { PushCreate } from './diff'

/**
 * How many create operations a push may make one at a time before its additions
 * take the CSV path instead. Counted in **printings** (one create per printing),
 * because that is what costs a search each.
 */
export const CSV_UPLOAD_THRESHOLD = 25

/** Where a user uploads a CSV Ritual wrote for them. */
export const ARCHIDEKT_IMPORT_URL = 'https://archidekt.com/collections/import'

/**
 * Which Archidekt CSV field each exported property fills — the upload's only
 * mapping rule, and the one thing that makes a rendered cell land in the right
 * place. A property with no entry here cannot be uploaded at all, so the
 * derivation below throws rather than shifting the remaining columns.
 */
const ARCHIDEKT_COLUMN_BY_PROPERTY: Partial<Record<ExportProperty, ArchidektCsvColumn>> = {
  scryfallId: 'uid',
  quantity: 'quantity',
  finish: 'modifier',
  condition: 'condition',
}

/**
 * The upload contract matching what {@link planCollectionCsv} renders: the
 * `archidekt` preset's columns, in the preset's order, mapped through
 * {@link ARCHIDEKT_COLUMN_BY_PROPERTY}, plus the preset's header row. Derived
 * from the preset rather than restated beside it, so reordering the preset
 * reorders what Archidekt is told each column means instead of silently
 * uploading quantities as variants.
 */
export const COLLECTION_CSV_UPLOAD: CollectionCsvUploadOptions = {
  columns: ARCHIDEKT_EXPORT_SETTINGS.columns.map((property) => {
    const column = ARCHIDEKT_COLUMN_BY_PROPERTY[property]
    if (!column) {
      throw new Error(`No Archidekt CSV column for the export property '${property}'`)
    }
    return column
  }),
  header: ARCHIDEKT_EXPORT_SETTINGS.header,
}

/** Writes the file `--csv-file` asks for; the filesystem by default. */
export type CsvFileWriter = (filePath: string, content: string) => Promise<void>

/** The production {@link CsvFileWriter}: creates parent directories, then writes. */
export const writeCsvFile: CsvFileWriter = async (filePath, content) => {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
}

/**
 * A push's additions as a CSV, plus the ones that could not be turned into a
 * row. `rows[n]` is the plan's own order; pairing an upload *result* back to a
 * row goes through the response's echoed line first ({@link collectionCsvOutcome})
 * — the server can report lines Ritual never counted, so position alone is only
 * a fallback.
 */
export type CollectionCsvPlan = {
  /**
   * The rendered CSV — the `archidekt` preset's header row plus one row per
   * resolved printing. Empty string when {@link rows} is empty.
   */
  csv: string
  /** The creates the CSV carries, in row order. */
  rows: PushCreate[]
  /** The Scryfall id each row was rendered with, index-aligned with {@link rows}. */
  rowIds: string[]
  /** Copies {@link rows} covers; one row may carry several. */
  copies: number
  /**
   * Creates whose printing the local Scryfall cache does not hold. A row needs a
   * Scryfall id to be unambiguous, so these cannot ride the CSV — the caller
   * adds them the slow way instead.
   */
  uncached: PushCreate[]
  /** One message per printing that has no cached Scryfall id, as the export engine words it. */
  warnings: string[]
}

/**
 * Turn create operations into the CSV Archidekt's importer reads, resolving each
 * printing's Scryfall id from the local cache through the same lookup the
 * engine's finish canonicalization uses.
 *
 * The rendering goes through the export engine (`archidekt` preset) rather than
 * being assembled here, but the id resolution is done in this module rather than
 * left to `renderExport`: a row whose uid cell came out empty would be a card
 * Archidekt has to guess about, so those creates have to be *separated* from the
 * file, not merely warned about.
 */
export async function planCollectionCsv(
  creates: readonly PushCreate[],
  lookup: CardPrintingsLookup,
): Promise<CollectionCsvPlan> {
  const entries = creates.map(
    (operation, fileOrder): ExportEntry => ({
      listType: 'collection',
      // Only the columns the preset selects are rendered, so the list a copy
      // came from is carried for completeness rather than for the file.
      listName: operation.lists[0] ?? '',
      section: DEFAULT_SECTION,
      name: operation.name,
      quantity: operation.quantity,
      set: operation.parts.set,
      collectorNumber: operation.parts.collectorNumber,
      finish: operation.parts.finish,
      condition: operation.parts.condition,
      fileOrder,
    }),
  )

  // One entry out per entry in, in order — which is what lets the split below
  // pair a resolved entry back to the operation it came from.
  const resolved = await resolveExportScryfallIds(entries, lookup)
  const rows: PushCreate[] = []
  const rowIds: string[] = []
  const rowEntries: ExportEntry[] = []
  const uncached: PushCreate[] = []
  resolved.entries.forEach((entry, index) => {
    const operation = creates[index]
    if (!operation) return
    if (entry.scryfallId === undefined) {
      uncached.push(operation)
      return
    }
    rows.push(operation)
    rowIds.push(entry.scryfallId)
    rowEntries.push(entry)
  })

  return {
    csv:
      rowEntries.length === 0
        ? ''
        : renderCsvExport(rowEntries, ARCHIDEKT_EXPORT_SETTINGS.columns, {
            header: ARCHIDEKT_EXPORT_SETTINGS.header,
            quoteAll: ARCHIDEKT_EXPORT_SETTINGS.quoteAll,
            dialect: ARCHIDEKT_EXPORT_SETTINGS.dialect,
          }),
    rows,
    rowIds,
    copies: rows.reduce((total, operation) => total + operation.quantity, 0),
    uncached,
    warnings: resolved.warnings,
  }
}

/** What an upload's per-row results came to, once paired with the creates they answer. */
export type CollectionCsvOutcome = {
  /** Every row Archidekt did not import, named after the card it carried. */
  failures: CollectionCsvFailure[]
  /**
   * The creates whose row Archidekt refused — the pairing done once, here, so
   * callers credit and fail *operations* rather than trusting a row number twice.
   * A refused row no create answers to is in {@link failures} but not here.
   */
  failed: PushCreate[]
  /**
   * Refused rows no create could be paired with, by echo or by position. The
   * copies they carried are credited on faith — the caller should say so, and a
   * later push reconciles whatever was actually missed.
   */
  unpaired: number
}

/** The one row identity, named so the two call sites cannot transpose the cells. */
type CsvRowIdentityParts = {
  uid: string
  variant: string
  condition: string
}

/**
 * The identity a rendered row shares with Archidekt's echo of it. Quantity is
 * left out: the push key is (printing, finish, condition), so uid + variant +
 * condition is unique per row by construction, while quantity carries no
 * distinguishing power.
 */
function csvRowIdentity(parts: CsvRowIdentityParts): string {
  return `${parts.uid.toLowerCase()}|${parts.variant.toLowerCase()}|${parts.condition.toLowerCase()}`
}

/** Where each identity cell sits in an uploaded row, per the upload's own column order. */
type IdentityCells = {
  uid: number
  variant: number
  condition: number
}

// Derived from the same mapping the upload sends, so a preset reorder moves
// these with it instead of silently unmatching every echo. Throws at module
// load, like the COLLECTION_CSV_UPLOAD derivation above.
const IDENTITY_CELLS: IdentityCells = ((): IdentityCells => {
  const at = (column: ArchidektCsvColumn): number => {
    const index = COLLECTION_CSV_UPLOAD.columns.indexOf(column)
    if (index === -1) throw new Error(`The Archidekt CSV upload has no '${column}' column`)
    return index
  }
  return { uid: at('uid'), variant: at('modifier'), condition: at('condition') }
})()

/** The uid column's header cell, lowercased, as the preset's dialect labels it. */
const UID_HEADER_CELL = exportPropertyLabel(
  'scryfallId',
  ARCHIDEKT_EXPORT_SETTINGS.dialect,
).toLowerCase()

/** The cells of a result's echoed `raw` line, in the upload's column order. */
function rawRowCells(raw: string): string[] | undefined {
  const parsed = parseCsv(raw)
  if ('error' in parsed) return undefined
  return parsed.rows[0]?.cells
}

type RowPairing =
  | { kind: 'operation'; operation: PushCreate }
  | { kind: 'header-echo' }
  | { kind: 'unmatched' }

/**
 * Pair one row result with the create it answers: by the identity parsed from
 * the result's echoed `raw` line when Archidekt sent one (immune to the server
 * counting rows Ritual did not send — the live incident was a header row echoed
 * as a data row, shifting every positional pairing after it by one). A header
 * echo pairs with nothing and is recognized by its first cell; a result with no
 * usable echo is `unmatched` and left to the caller's positional fallback.
 */
function pairRow(
  row: CollectionCsvRowResult,
  byIdentity: ReadonlyMap<string, PushCreate>,
): RowPairing {
  if (row.raw === undefined) return { kind: 'unmatched' }
  const cells = rawRowCells(row.raw)
  const uid = cells?.[IDENTITY_CELLS.uid]?.trim()
  if (cells === undefined || uid === undefined || uid === '') return { kind: 'unmatched' }
  if (uid.toLowerCase() === UID_HEADER_CELL) return { kind: 'header-echo' }
  const operation = byIdentity.get(
    csvRowIdentity({
      uid,
      variant: cells[IDENTITY_CELLS.variant]?.trim() ?? '',
      condition: cells[IDENTITY_CELLS.condition]?.trim() ?? '',
    }),
  )
  return operation ? { kind: 'operation', operation } : { kind: 'unmatched' }
}

/** Whether Archidekt refused the row, preferring its own verdict when it sent one. */
function rowRefused(row: CollectionCsvRowResult): boolean {
  if (row.imported !== undefined) return !row.imported
  return row.ambiguous || row.notFound || row.errors.length > 0
}

/**
 * Pair an upload's row results with the creates they were built from, keeping the
 * rows Archidekt did not import.
 *
 * Two passes: every result that carries a readable echo is paired by identity
 * first; a refused row without one then falls back to its positional index, but
 * only onto an operation no identity match already claimed — position is what
 * the live incident proved unreliable, so it never overrides an echo. Rows
 * Archidekt reported nothing about are not failures here — a response that
 * covered fewer rows than were sent lands in
 * {@link CollectionCsvUploadResult.unreadable} instead. A refused *header echo*
 * (the server processing a header line as data) fails no card: no card was on
 * that line.
 */
export function collectionCsvOutcome(
  plan: Pick<CollectionCsvPlan, 'rows' | 'rowIds'>,
  result: CollectionCsvUploadResult,
): CollectionCsvOutcome {
  const byIdentity = new Map<string, PushCreate>()
  plan.rows.forEach((operation, index) => {
    const uid = plan.rowIds[index]
    if (uid === undefined) return
    byIdentity.set(
      csvRowIdentity({
        uid,
        variant: archidektModifier(operation.parts.finish),
        condition: archidektCsvCondition(operation.parts.condition),
      }),
      operation,
    )
  })

  // Pass 1: pair every result with a readable echo, whatever its verdict —
  // an operation claimed by any echo must not also answer a positional fallback.
  const pairings = result.rows.map((row) => pairRow(row, byIdentity))
  const claimed = new Set<PushCreate>()
  for (const pairing of pairings) {
    if (pairing.kind === 'operation') claimed.add(pairing.operation)
  }

  const failures: CollectionCsvFailure[] = []
  const failed: PushCreate[] = []
  let unpaired = 0
  result.rows.forEach((row, index) => {
    if (!rowRefused(row)) return
    let pairing = pairings[index] ?? { kind: 'unmatched' as const }
    if (pairing.kind === 'header-echo') return
    if (pairing.kind === 'unmatched') {
      const positional = plan.rows[row.row]
      if (positional && !claimed.has(positional)) {
        pairing = { kind: 'operation', operation: positional }
      }
    }
    if (pairing.kind === 'operation') {
      failed.push(pairing.operation)
    } else {
      unpaired += 1
    }
    failures.push({
      row: row.row,
      // A result Ritual cannot pair with a create means the response described
      // a row it never sent; show the echoed line rather than inventing a card.
      card:
        pairing.kind === 'operation'
          ? describeCollectionKey(pairing.operation.name, pairing.operation.parts)
          : row.raw === undefined
            ? `CSV row ${row.row + 1}`
            : `CSV row ${row.row + 1} (${row.raw.trim()})`,
      ambiguous: row.ambiguous,
      notFound: row.notFound,
      errors: row.errors,
    })
  })
  return { failures, failed, unpaired }
}
