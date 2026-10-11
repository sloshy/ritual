/**
 * @fileoverview The push half of the collection-sync engine (local →
 * Archidekt): applying the planned operations one by one, routing bulk
 * additions through `push-csv`, and recording what landed.
 */

import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { describeSkippedChanges } from '../sync/common'
import { archidektPlace, describeCollectionCardChange } from './describe'
import { describeSyncCard } from '../sync/describe'
import { pushOperationChange, recordCardChange } from './card-changes'
import {
  createRecordBody,
  planPush,
  unmappableLanguageWarning,
  updateRecordBody,
  type LocalCollectionIndex,
  type PushCreate,
  type PushOperation,
  type PushPlan,
  type RemoteCollectionIndex,
} from './diff'
import {
  type CollectionSyncCardAdded,
  type CollectionSyncCardRemoved,
  type CollectionSyncCsv,
  type SyncFlow,
  type FlowOutcome,
  abortedOutcome,
  emitListLines,
  markCancelled,
} from './types'
import { routeAdditions, pushAdditionsAsCsv } from './push-csv'

// ── Push (local → Archidekt) ──────────────────────────────────────────

export async function pushToArchidekt(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
  names: string[],
): Promise<FlowOutcome> {
  const { emit, results } = flow
  const errors: string[] = []

  // How the additions reach Archidekt is settled *before* the first remote
  // write, the way an ambiguous removal is settled before the first file write: a
  // run that cannot answer the question leaves the account untouched rather than
  // half-pushed.
  let planned = planOperations(flow, local, remote)
  const routed = await routeAdditions(flow, planned.creates)
  if (typeof routed === 'string') {
    emit({ kind: 'log', level: 'error', item: null, message: routed })
    return abortedOutcome([routed])
  }
  const { route } = routed
  // Settling the route refreshed the card cache, and the local index keyed each
  // unmarked line's finish against the cache it replaced — a printing the old
  // cache lacked was guessed as nonfoil. Re-plan from an index of the new cache;
  // the route stands, since the question it answered was about the upload's size.
  if (routed.refreshed) planned = planOperations(flow, await flow.reindexLocal(), remote)
  // A refresh is a bulk download that can take minutes, and a cancel during it
  // must not be followed by the CSV upload that runs ahead of the per-list loop.
  if (flow.signal?.aborted) {
    markCancelled(names, emit, results, 'push')
    return { ...abortedOutcome([]), aborted: false, cancelled: true }
  }

  const { plan, creates, withheldCopies } = planned
  let { operations } = planned
  const skippedMessage = describeSkippedChanges(flow.only, plan.skipped)
  if (skippedMessage) emit({ kind: 'log', level: 'info', item: null, message: skippedMessage })
  if (withheldCopies > 0) {
    emit({
      kind: 'log',
      level: 'error',
      item: null,
      message: `Not removing ${t('domain.count.copies', { count: withheldCopies })} from Archidekt: some collection lists in scope could not be read, so cards they still hold would look gone. Fix or accept those lists and run again.`,
    })
  }

  let added = 0
  let removed = 0
  let pending = 0
  let csv: CollectionSyncCsv | null = null
  const writtenFiles: string[] = []

  if (route.kind !== 'individual' && creates.length > 0) {
    const bulk = await pushAdditionsAsCsv(flow, route, creates)
    csv = bulk.csv
    added += bulk.added
    pending += bulk.pending
    writtenFiles.push(...bulk.writtenFiles)
    // Whatever the outcome, the creates the CSV took are not tried again one at a
    // time — a failed upload is reported as a failure, not retried by another
    // route (which would double-import on a partial success).
    const carried = new Set<PushOperation>(bulk.carried)
    operations = operations.filter((operation) => !carried.has(operation))
  }

  // Operations belong to the list holding the key's copies; the ones for cards
  // that live in no list any more belong to the run. `lists` follows scope
  // order (the local index was built in it), so an operation always executes at
  // its *earliest* list's turn — every other list it counts against is still
  // ahead of the loop and has not been reported yet.
  const byList = new Map<string, PushOperation[]>()
  const orphaned: PushOperation[] = []
  for (const operation of operations) {
    const owner = operation.lists[0]
    if (owner === undefined) {
      orphaned.push(operation)
      continue
    }
    const existing = byList.get(owner)
    if (existing) existing.push(operation)
    else byList.set(owner, [operation])
  }

  /** Removals of cards no list holds any more, as they went through. */
  const unlisted: CollectionSyncCardRemoved[] = []
  let cancelled = false
  for (const [index, name] of names.entries()) {
    if (flow.signal?.aborted) {
      markCancelled(names.slice(index), emit, results, 'push')
      cancelled = true
      break
    }
    emit({ kind: 'item-start', item: name, index, total: names.length })
    const owned = byList.get(name) ?? []

    for (const operation of owned) {
      const change = await runPushOperation(flow, operation, name, route.kind !== 'individual')
      if (change === null) continue
      if (change.kind === 'added') added += change.quantity
      else removed += change.quantity
      // A key held in several lists is equally pushed from each of them, so the
      // change (and any failure) is recorded against all of them.
      for (const list of operation.lists) results.record(list, change)
    }

    // A key held in several binders is pushed once, at its first list's turn
    // (or by the CSV upload, before the loop began), and credited to every list
    // holding it — so a list with nothing of its own may still have moved
    // copies, and must not report "no changes". Nor may a list the CSV already
    // failed: "could not be imported; no changes" is two answers to one
    // question. Its lines come once its operations are done, so they describe
    // what went through — including what an earlier list's turn pushed for it.
    const entry = results.track(name)
    if (entry.changes.length > 0) {
      emitListLines(emit, name, entry.changes, archidektPlace())
      results.finish(name)
    } else if (entry.status !== 'failed' && owned.length === 0) {
      emit({ kind: 'log', level: 'info', item: name, message: 'No changes.' })
      results.finish(name, 'no changes')
    } else {
      results.finish(name)
    }
  }

  for (const operation of orphaned) {
    // Orphans belong to no list, so a cancellation here has no row to report
    // under; the remaining removals are simply not made, and the flag says so.
    if (cancelled || flow.signal?.aborted) {
      cancelled = true
      break
    }
    // Orphans are removals — a card no list holds any more — so the CSV route
    // never applies to them.
    const change = await runPushOperation(flow, operation, null, false)
    if (change === null) {
      errors.push(pushFailureReason(operation))
      continue
    }
    if (change.kind !== 'removed') continue
    removed += change.quantity
    recordCardChange(unlisted, change)
    emit({
      kind: 'log',
      level: 'detail',
      item: null,
      message: describeCollectionCardChange(change, archidektPlace()),
    })
  }

  return {
    writtenFiles,
    errors,
    ambiguous: [],
    csv,
    totals: { added, removed, skipped: plan.skipped, pending },
    // A push applies its operations one by one: a failed one is a failure of
    // that operation, not of the run, which still reached Archidekt.
    aborted: false,
    cancelled,
    // A push never removes locally, so it never meets an ambiguous removal.
    unresolvedAmbiguity: false,
    unlisted,
  }
}

/** A push plan, with the operations this run may actually apply. */
type PlannedPush = {
  plan: PushPlan
  /** The plan's operations, less any withheld for an incomplete local side. */
  operations: PushOperation[]
  /** The creates among {@link operations} — the additions a route is chosen for. */
  creates: PushCreate[]
  /** Copies the withheld operations would have removed; 0 when none were. */
  withheldCopies: number
}

/**
 * Plan the push from a local index, withholding what an incomplete local side
 * cannot vouch for: a list missing from the comparison makes the cards it holds
 * look gone, and a push would delete them from the account — the mirror image of
 * the pull's guard. Only the operations that take copies away are withheld; the
 * ones that add copies are as valid as they would be with the list present.
 */
function planOperations(
  flow: SyncFlow,
  local: LocalCollectionIndex,
  remote: RemoteCollectionIndex,
): PlannedPush {
  const plan = planPush(local, remote, flow.only)
  let operations = plan.operations
  let withheldCopies = 0
  if (!flow.localComplete) {
    const removes = (operation: PushOperation): boolean =>
      pushOperationChange(operation).kind === 'removed'
    for (const operation of operations) {
      if (removes(operation)) withheldCopies += pushOperationChange(operation).quantity
    }
    operations = operations.filter((operation) => !removes(operation))
  }
  const creates = operations.filter(
    (operation): operation is PushCreate => operation.kind === 'create',
  )
  return { plan, operations, creates, withheldCopies }
}

/** What one push operation did to Archidekt: copies added or removed. */
type PushedChange = CollectionSyncCardAdded | CollectionSyncCardRemoved

/** The reason recorded when an orphaned operation fails; the log carries the detail. */
function pushFailureReason(operation: PushOperation): string {
  return `Failed to remove ${describeSyncCard(operation.name, operation.parts)} from Archidekt`
}

/**
 * Execute one push operation, returning the change it made — or `null` when it
 * failed. A failure is
 * reported against every list holding the key (a card split across binders is
 * equally unpushed from either) and never aborts the run.
 *
 * @param csvRouted Whether this run's additions took the CSV path. A create that
 *   is here despite that is one the local cache could not key, and a **dry run**
 *   then reports it rather than resolving it: the whole point of previewing a
 *   large push is that it costs no per-card search, and a stale cache must not be
 *   able to turn one preview into hundreds of them.
 */
async function runPushOperation(
  flow: SyncFlow,
  operation: PushOperation,
  list: string | null,
  csvRouted: boolean,
): Promise<PushedChange | null> {
  const { client, token, dryRun, emit, results } = flow
  const label = describeSyncCard(operation.name, operation.parts)
  const change = pushOperationChange(operation)

  const fail = (reason: string): null => {
    emit({ kind: 'log', level: 'error', item: list, message: reason })
    for (const name of operation.lists) results.fail(name, reason)
    return null
  }

  /** The operation went through (or would, on a dry run). */
  const done = (): PushedChange => change

  if (operation.kind === 'create') {
    // Said before anything is sent (and on dry runs too): the record about to be
    // created will not carry the language the local line does.
    const languageWarning = unmappableLanguageWarning(operation.name, operation.parts)
    if (languageWarning) emit({ kind: 'log', level: 'warn', item: list, message: languageWarning })
    // A preview of a CSV-routed run does not resolve the printings the cache
    // could not key (the run-level warning says they go one at a time).
    if (dryRun && csvRouted) return done()
    // Resolving the printing is a read, so a dry run does it too: an
    // unresolvable printing is the failure a dry run most needs to surface.
    const found = await client.searchCards(
      operation.name,
      operation.parts.set,
      token,
      operation.parts.collectorNumber,
    )
    if (typeof found === 'string') return fail(found)
    if (dryRun) return done()
    try {
      await client.createCollectionRecord(createRecordBody(operation, found.id), token)
    } catch (error: unknown) {
      return fail(`Failed to add ${label}: ${getErrorMessage(error)}`)
    }
    return done()
  }

  if (operation.kind === 'update') {
    if (dryRun) return done()
    try {
      await client.updateCollectionRecord(operation.record.id, updateRecordBody(operation), token)
    } catch (error: unknown) {
      return fail(`Failed to update ${label}: ${getErrorMessage(error)}`)
    }
    return done()
  }

  if (dryRun) return done()
  try {
    await client.deleteCollectionRecords(
      operation.records.map((record) => record.id),
      token,
    )
  } catch (error: unknown) {
    return fail(`Failed to remove ${label}: ${getErrorMessage(error)}`)
  }
  return done()
}
