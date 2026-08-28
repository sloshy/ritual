/**
 * @fileoverview Pushing a large batch of additions to Archidekt as one CSV
 * import instead of one request per printing: choosing the route, the
 * question the run asks past the threshold, and the upload itself.
 */

import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import type { CollectionCsvUploadResult } from '../importers/archidekt-collection'
import { describeCsvFailure, describeCsvFailureReasons, describeCsvSize } from './describe'
import type { PushCreate } from './diff'
import {
  ARCHIDEKT_IMPORT_URL,
  COLLECTION_CSV_UPLOAD,
  collectionCsvOutcome,
  CSV_UPLOAD_THRESHOLD,
  planCollectionCsv,
} from './csv'
import type {
  CollectionSyncCsvCounts,
  CollectionSyncCsv,
  CsvUploadDecision,
  SyncFlow,
} from './types'

// ── Push additions as a CSV import ────────────────────────────────────

/**
 * How a push's additions reach Archidekt, once the question is settled: one
 * at a time (`individual`, every push below the threshold), as one CSV import
 * (`upload`), or written to a file instead of being pushed (`export`).
 */
export type CsvRoute = Exclude<CsvUploadDecision, { kind: 'abort' }>

/** The two routes that build a CSV out of the additions. */
export type CsvBulkRoute = Exclude<CsvRoute, { kind: 'individual' }>

/**
 * Decide the route the additions take, or return the message explaining why the
 * run cannot proceed. Nothing has been written to Archidekt when this is called.
 *
 * Precedence: `csvFile` (write instead of push) beats `csv` (upload), both beat
 * the threshold; at or below the threshold nothing changes about how a push
 * behaves. Over it, a dry run answers itself — it previews the upload rather than
 * resolving printings one at a time, which is what makes a first dry run cheap —
 * and a real run asks `DecideCsvUpload`, or fails when there is nobody to
 * ask.
 *
 * Whichever way a CSV route is reached, the local cache the rows are keyed from
 * has to be fit for it, so `EnsureCsvCache` gets the last word — a refusal
 * there is a refusal of the run.
 */
export async function routeAdditions(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<CsvRoute | string> {
  const route = await chooseAdditionsRoute(flow, creates)
  if (typeof route === 'string' || route.kind === 'individual') return route

  // The rows are built from the local Scryfall cache, so a cache the surface's
  // policy will not vouch for stops the run here — before the first remote write,
  // and without falling back to a search per card.
  if (flow.ensureCsvCache) {
    let ready: true | string
    try {
      ready = await flow.ensureCsvCache({
        additions: creates.length,
        log: (message) => flow.emit({ kind: 'log', level: 'info', item: null, message }),
      })
    } catch (error: unknown) {
      return `Could not prepare the card cache for a CSV upload: ${getErrorMessage(error)}. Nothing was pushed.`
    }
    if (ready !== true) return `${ready} Nothing was pushed.`
  }
  return route
}

/** The route itself, before the cache the rows come from is taken into account. */
async function chooseAdditionsRoute(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<CsvRoute | string> {
  if (creates.length === 0) return { kind: 'individual' }
  if (flow.csvFile !== undefined) return { kind: 'export', path: flow.csvFile }
  if (flow.csv) return { kind: 'upload' }
  if (creates.length <= CSV_UPLOAD_THRESHOLD) return { kind: 'individual' }
  if (flow.dryRun) return { kind: 'upload' }

  if (!flow.decideCsv) {
    // Surface-neutral: this branch is reached only by callers that supply no
    // decider (the admin API, the MCP tool), where naming CLI flags would be
    // advice the reader cannot take. The CLI's own decider words its refusal with
    // the flags that settle it.
    return `${creates.length} cards would be added — more than ${CSV_UPLOAD_THRESHOLD}, so adding them one at a time would cost ${creates.length} printing searches, and this run was not told to upload them as one CSV import instead. Nothing was pushed.`
  }

  let decision: CsvUploadDecision
  try {
    decision = await flow.decideCsv({
      additions: creates.length,
      threshold: CSV_UPLOAD_THRESHOLD,
    })
  } catch (error: unknown) {
    // A decider that throws is a decision that was never made — refuse.
    return `Could not decide how to add ${creates.length} cards: ${getErrorMessage(error)}. Nothing was pushed.`
  }

  switch (decision.kind) {
    case 'individual':
      return { kind: 'individual' }
    case 'upload':
      return { kind: 'upload' }
    case 'export': {
      // A blank path is not a destination: writing to it would fail after the
      // rest of the push had already gone out.
      const path = decision.path.trim()
      if (path === '') return 'No file was named for the additions CSV. Nothing was pushed.'
      return { kind: 'export', path }
    }
    case 'abort':
      // The decider's own wording — "cancelled" and "no terminal" are different
      // things to be told, and only it knows which happened.
      return `${decision.message} Nothing was pushed.`
  }
}

/** What the CSV path did, and which creates it took off the per-card path. */
export type CsvAdditions = {
  csv: CollectionSyncCsv | null
  /** The CSV file a `csvFile` run wrote; empty otherwise. */
  writtenFiles: string[]
  /** Copies the upload landed on Archidekt. */
  added: number
  /** Copies waiting in a file for a manual import. */
  pending: number
  /**
   * The creates the CSV took responsibility for — excluded from the per-card path
   * whether they were imported, exported, or lost to a failed upload. Empty when
   * no row could be built at all, which sends every addition back the slow way.
   */
  carried: PushCreate[]
}

/** How many failed rows are named individually before the log stops listing them. */
const CSV_FAILURE_DETAIL_LIMIT = 10

/**
 * Send a push's additions through Archidekt's CSV importer — or write them to a
 * file for the user to import — crediting each list with the copies that actually
 * landed.
 *
 * Additions whose printing the local cache does not hold cannot be turned into a
 * row (a uid-less row is one Archidekt would have to guess about), so they are
 * reported and handed back to the per-card path. A wholesale upload failure fails
 * those additions' lists and nothing else: the run's quantity changes and
 * removals are unaffected by it.
 */
export async function pushAdditionsAsCsv(
  flow: SyncFlow,
  route: CsvBulkRoute,
  creates: readonly PushCreate[],
): Promise<CsvAdditions> {
  const { emit, results, dryRun } = flow
  const nothing: CsvAdditions = {
    csv: null,
    writtenFiles: [],
    added: 0,
    pending: 0,
    carried: [],
  }

  const plan = await planCollectionCsv(creates, flow.lookupPrintings)
  for (const warning of plan.warnings) {
    emit({ kind: 'log', level: 'warn', item: null, message: warning })
  }
  if (plan.uncached.length > 0) {
    const count = plan.uncached.length
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      message: t('domain.sync.csvUncachedAdditions', { count }),
    })
  }
  const counts: CollectionSyncCsvCounts = {
    cards: plan.copies,
    rows: plan.rows.length,
    uncached: plan.uncached.length,
  }
  // Not a single row could be keyed, so there is nothing to upload or write — but
  // the run *did* take the CSV route, and a caller reading only the report would
  // otherwise see `csv: null` and no explanation for the slow path those
  // additions took.
  if (plan.rows.length === 0) return { ...nothing, csv: { ...counts, status: 'empty' } }

  const size = describeCsvSize(counts.cards, counts.rows)

  /** Credit every list holding these creates, and total the copies. */
  const credit = (rows: readonly PushCreate[], field: 'added' | 'pending'): number => {
    let total = 0
    for (const operation of rows) {
      total += operation.quantity
      for (const list of operation.lists) {
        results.track(list)[field] += operation.quantity
      }
    }
    return total
  }

  /** Fail every list whose additions the CSV lost, without touching the run. */
  const failRows = (rows: readonly PushCreate[], reason: string): void => {
    for (const operation of rows) {
      for (const list of operation.lists) results.fail(list, reason)
    }
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      item: null,
      message:
        route.kind === 'export'
          ? `[dry-run] Would write ${size} to ${route.path} for a manual upload at ${ARCHIDEKT_IMPORT_URL}.`
          : `[dry-run] Would upload ${size} as a CSV import.`,
    })
    return {
      csv:
        route.kind === 'export'
          ? { ...counts, status: 'planned', destination: 'export', path: route.path }
          : { ...counts, status: 'planned', destination: 'upload' },
      writtenFiles: [],
      // A preview counts what a real run would do, exactly as the rest of a dry
      // run does — as pending when the cards would only be written to a file.
      added: route.kind === 'export' ? 0 : credit(plan.rows, 'added'),
      pending: route.kind === 'export' ? credit(plan.rows, 'pending') : 0,
      carried: plan.rows,
    }
  }

  if (route.kind === 'export') {
    try {
      await flow.writeCsv(route.path, `${plan.csv}\n`)
    } catch (error: unknown) {
      const message = `Failed to write the additions CSV to ${route.path}: ${getErrorMessage(error)}`
      emit({ kind: 'log', level: 'error', item: null, message })
      failRows(plan.rows, message)
      return { ...nothing, csv: { ...counts, status: 'failed', message }, carried: plan.rows }
    }
    emit({
      kind: 'log',
      level: 'info',
      item: null,
      message: `Wrote ${size} to ${route.path}; they were not pushed. Import the file at ${ARCHIDEKT_IMPORT_URL}.`,
    })
    return {
      csv: { ...counts, status: 'exported', path: route.path },
      writtenFiles: [route.path],
      added: 0,
      pending: credit(plan.rows, 'pending'),
      carried: plan.rows,
    }
  }

  emit({ kind: 'log', level: 'info', item: null, message: `Uploading ${size} as a CSV import...` })
  let result: CollectionCsvUploadResult
  try {
    result = await flow.client.uploadCollectionCsv(plan.csv, COLLECTION_CSV_UPLOAD, flow.token)
  } catch (error: unknown) {
    const message = `Failed to upload ${size} as a CSV import: ${getErrorMessage(error)}`
    emit({ kind: 'log', level: 'error', item: null, message })
    failRows(plan.rows, message)
    return { ...nothing, csv: { ...counts, status: 'failed', message }, carried: plan.rows }
  }

  for (const unreadable of result.unreadable) {
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      message: `Could not read Archidekt's answer for CSV chunk ${unreadable.chunk}: ${unreadable.message}. Response: ${unreadable.body}`,
    })
  }

  // Paired once, by operation rather than by row number: `failed` is the creates
  // Archidekt refused, so nothing below has to trust a row index a second time.
  const { failures, failed, unpaired } = collectionCsvOutcome(plan, result)
  if (unpaired > 0) {
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      message: `${t('domain.count.refusedRows', { count: unpaired })} could not be matched to a card; the copies they carried are credited on faith — a later push reconciles anything actually missed.`,
    })
  }
  const refused = new Set<PushCreate>(failed)
  if (failures.length > 0) {
    const reasons = describeCsvFailureReasons(failures)
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      message: `Archidekt did not import ${failures.length} of ${counts.rows} CSV rows${reasons ? ` (${reasons})` : ''}.`,
    })
    for (const failure of failures.slice(0, CSV_FAILURE_DETAIL_LIMIT)) {
      emit({
        kind: 'log',
        level: 'warn',
        item: null,
        // The describer always has something to say, so there is no empty-reason
        // shape to word around here.
        message: `  Not imported: ${failure.card} — ${describeCsvFailure(failure)}.`,
      })
    }
    if (failures.length > CSV_FAILURE_DETAIL_LIMIT) {
      emit({
        kind: 'log',
        level: 'warn',
        item: null,
        message: `  …and ${failures.length - CSV_FAILURE_DETAIL_LIMIT} more.`,
      })
    }
    failRows(
      failed,
      `${t('domain.count.cards', { count: failures.length })} could not be imported from the CSV`,
    )
  }

  const landed = plan.rows.filter((operation) => !refused.has(operation))
  const imported = landed.reduce((total, operation) => total + operation.quantity, 0)
  emit({
    kind: 'log',
    level: 'info',
    item: null,
    message: `Imported ${describeCsvSize(imported, landed.length)} from the CSV in ${t('domain.count.requests', { count: result.chunkCount })}.`,
  })

  return {
    csv: {
      ...counts,
      status: 'uploaded',
      chunks: result.chunkCount,
      failures,
      // Rows in a chunk whose answer could not be read are counted as imported
      // because nothing said otherwise; the count is how a report-only consumer
      // tells that apart from a confirmed import.
      unconfirmedChunks: new Set(result.unreadable.map((entry) => entry.chunk)).size,
    },
    writtenFiles: [],
    added: credit(landed, 'added'),
    pending: 0,
    carried: plan.rows,
  }
}
