/**
 * @fileoverview Pushing a large batch of additions to Archidekt as one CSV
 * import instead of one request per printing: choosing the route, the
 * question the run asks past the threshold, and the upload itself.
 */

import {
  errorParam,
  isSyncMessage,
  nestSync,
  syncMessage,
  syncRef,
  toSyncMessage,
  type SyncMessage,
} from '../sync/message'
import { pickMessage } from '../api/result'
import type { CollectionCsvUploadResult } from '../importers/archidekt-collection'
import {
  archidektPlace,
  describeCollectionCardChange,
  csvFailureCard,
  describeCsvFailure,
  describeCsvFailureReasons,
  describeCsvSize,
} from './describe'
import { csvRowChange } from './card-changes'
import type { PushCreate } from './diff'
import type { UploadCacheReady } from '../cache/freshness'
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

/**
 * The settled route, and whether settling it refreshed the card cache — in
 * which case the plan the route was chosen for was keyed against the old one.
 */
export type RoutedAdditions = UploadCacheReady & { route: CsvRoute }

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
 * there is a refusal of the run, and a refresh there is reported back so the
 * caller can re-plan from the new cache.
 */
export async function routeAdditions(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<RoutedAdditions | SyncMessage> {
  const route = await chooseAdditionsRoute(flow, creates)
  if (isSyncMessage(route)) return route
  if (route.kind === 'individual') return { route, refreshed: false }

  // The rows are built from the local Scryfall cache, so a cache the surface's
  // policy will not vouch for stops the run here — before the first remote write,
  // and without falling back to a search per card.
  if (!flow.ensureCsvCache) return { route, refreshed: false }
  let ready: UploadCacheReady | SyncMessage
  try {
    ready = await flow.ensureCsvCache({
      additions: creates.length,
      // The cache's own progress line, keyed like the run's own.
      log: (message) =>
        flow.emit({ kind: 'log', level: 'info', item: null, ...pickMessage(message) }),
    })
  } catch (error: unknown) {
    return syncMessage('domain.sync.csvCachePrepareFailed', { error: errorParam(error) })
  }
  // The gate's refusal, nested so it renders in the reader's language too.
  if (isSyncMessage(ready)) {
    return syncMessage('domain.sync.nothingPushed', { message: nestSync(ready) })
  }
  return { route, ...ready }
}

/** The route itself, before the cache the rows come from is taken into account. */
async function chooseAdditionsRoute(
  flow: SyncFlow,
  creates: readonly PushCreate[],
): Promise<CsvRoute | SyncMessage> {
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
    return syncMessage('domain.sync.csvUndecided', {
      count: creates.length,
      threshold: CSV_UPLOAD_THRESHOLD,
    })
  }

  let decision: CsvUploadDecision
  try {
    decision = await flow.decideCsv({
      additions: creates.length,
      threshold: CSV_UPLOAD_THRESHOLD,
    })
  } catch (error: unknown) {
    // A decider that throws is a decision that was never made — refuse.
    return syncMessage('domain.sync.csvDeciderFailed', {
      count: creates.length,
      error: errorParam(error),
    })
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
      if (path === '') return syncMessage('domain.sync.csvNoFile')
      return { kind: 'export', path }
    }
    case 'abort':
      // The decider's own wording — "cancelled" and "no terminal" are different
      // things to be told, and only it knows which happened.
      return syncMessage('domain.sync.nothingPushed', { message: nestSync(decision.message) })
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
    emit({ kind: 'log', level: 'warn', item: null, ...warning })
  }
  if (plan.uncached.length > 0) {
    const count = plan.uncached.length
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...syncMessage('domain.sync.csvUncachedAdditions', { count }),
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

  /**
   * Credit every list holding these creates — the count and the listed change —
   * log each card's line at run level (the CSV runs before any list's turn),
   * and total the copies.
   */
  const credit = (rows: readonly PushCreate[], field: 'added' | 'pending'): number => {
    let total = 0
    for (const operation of rows) {
      total += operation.quantity
      const change = csvRowChange(operation, field)
      emit({
        kind: 'log',
        level: 'detail',
        item: null,
        ...toSyncMessage(describeCollectionCardChange(change, archidektPlace())),
      })
      for (const list of operation.lists) results.record(list, change)
    }
    return total
  }

  /** Fail every list whose additions the CSV lost, without touching the run. */
  const failRows = (rows: readonly PushCreate[], reason: SyncMessage): void => {
    for (const operation of rows) {
      for (const list of operation.lists) results.fail(list, reason)
    }
  }

  if (dryRun) {
    emit({
      kind: 'log',
      level: 'info',
      item: null,
      ...(route.kind === 'export'
        ? syncMessage('domain.sync.dryRunCsvExport', {
            size,
            path: route.path,
            url: ARCHIDEKT_IMPORT_URL,
          })
        : syncMessage('domain.sync.dryRunCsvUpload', { size })),
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
      const failure = syncMessage('domain.sync.csvWriteFailed', {
        path: route.path,
        error: errorParam(error),
      })
      emit({ kind: 'log', level: 'error', item: null, ...failure })
      failRows(plan.rows, failure)
      return { ...nothing, csv: { ...counts, ...failure, status: 'failed' }, carried: plan.rows }
    }
    emit({
      kind: 'log',
      level: 'info',
      item: null,
      ...syncMessage('domain.sync.csvExported', {
        size,
        path: route.path,
        url: ARCHIDEKT_IMPORT_URL,
      }),
    })
    return {
      csv: { ...counts, status: 'exported', path: route.path },
      writtenFiles: [route.path],
      added: 0,
      pending: credit(plan.rows, 'pending'),
      carried: plan.rows,
    }
  }

  emit({
    kind: 'log',
    level: 'info',
    item: null,
    ...syncMessage('domain.sync.csvUploading', { size }),
  })
  let result: CollectionCsvUploadResult
  try {
    result = await flow.client.uploadCollectionCsv(plan.csv, COLLECTION_CSV_UPLOAD, flow.token)
  } catch (error: unknown) {
    const failure = syncMessage('domain.sync.csvUploadFailed', {
      size,
      error: errorParam(error),
    })
    emit({ kind: 'log', level: 'error', item: null, ...failure })
    failRows(plan.rows, failure)
    return { ...nothing, csv: { ...counts, ...failure, status: 'failed' }, carried: plan.rows }
  }

  for (const unreadable of result.unreadable) {
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...syncMessage('domain.sync.csvChunkUnreadable', {
        chunk: unreadable.chunk,
        error: unreadable.message,
        body: unreadable.body,
      }),
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
      ...syncMessage('domain.sync.csvRowsUnpaired', { count: unpaired }),
    })
  }
  const refused = new Set<PushCreate>(failed)
  if (failures.length > 0) {
    // Never empty: every failure is counted under one of the four reasons.
    emit({
      kind: 'log',
      level: 'warn',
      item: null,
      ...syncMessage('domain.sync.csvRowsRefused', {
        failed: failures.length,
        count: counts.rows,
        reasons: describeCsvFailureReasons(failures),
      }),
    })
    for (const failure of failures.slice(0, CSV_FAILURE_DETAIL_LIMIT)) {
      emit({
        kind: 'log',
        level: 'warn',
        item: null,
        // The describer always has something to say, so there is no empty-reason
        // shape to word around here.
        ...syncMessage('domain.sync.csvRowNotImported', {
          card: nestSync(csvFailureCard(failure)),
          reason: describeCsvFailure(failure),
        }),
      })
    }
    if (failures.length > CSV_FAILURE_DETAIL_LIMIT) {
      emit({
        kind: 'log',
        level: 'warn',
        item: null,
        ...syncMessage('domain.sync.csvMoreFailures', {
          count: failures.length - CSV_FAILURE_DETAIL_LIMIT,
        }),
      })
    }
    failRows(failed, syncMessage('domain.sync.csvCardsNotImported', { count: failures.length }))
  }

  const landed = plan.rows.filter((operation) => !refused.has(operation))
  const imported = landed.reduce((total, operation) => total + operation.quantity, 0)
  emit({
    kind: 'log',
    level: 'info',
    item: null,
    ...syncMessage('domain.sync.csvImported', {
      size: describeCsvSize(imported, landed.length),
      requests: syncRef('domain.count.requests', { count: result.chunkCount }),
    }),
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
