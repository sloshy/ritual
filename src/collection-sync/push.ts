/**
 * @fileoverview The push half of the collection-sync engine (local →
 * Archidekt): applying the planned operations one by one, routing bulk
 * additions through `push-csv`, and recording what landed.
 */

import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import { describeSkippedChanges } from '../sync/common'
import { describeCollectionKey } from './describe'
import {
  createRecordBody,
  operationAdded,
  operationRemoved,
  planPush,
  unmappableLanguageWarning,
  updateRecordBody,
  type LocalCollectionIndex,
  type PushCreate,
  type PushOperation,
  type RemoteCollectionIndex,
} from './diff'
import { type CollectionSyncCsv, type SyncFlow, type FlowOutcome, abortedOutcome } from './types'
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

  const plan = planPush(local, remote, flow.only)
  const skippedMessage = describeSkippedChanges(flow.only, plan.skipped)
  if (skippedMessage) emit({ kind: 'log', level: 'info', item: null, message: skippedMessage })

  // The mirror image of the pull guard above: a list missing from the comparison
  // makes the cards it holds look gone, and a push would delete them from the
  // account. Only the operations that take copies away are withheld — the ones
  // that add copies are as valid as they would be with the list present.
  let operations = plan.operations
  if (!flow.localComplete) {
    const shrinking = operations.filter((operation) => operationRemoved(operation) > 0)
    if (shrinking.length > 0) {
      const copies = shrinking.reduce((total, operation) => total + operationRemoved(operation), 0)
      emit({
        kind: 'log',
        level: 'error',
        item: null,
        message: `Not removing ${t('domain.count.copies', { count: copies })} from Archidekt: some collection lists in scope could not be read, so cards they still hold would look gone. Fix or accept those lists and run again.`,
      })
      operations = operations.filter((operation) => operationRemoved(operation) === 0)
    }
  }

  // How the additions reach Archidekt is settled *before* the first remote
  // write, the way an ambiguous removal is settled before the first file write: a
  // run that cannot answer the question leaves the account untouched rather than
  // half-pushed.
  const creates = operations.filter(
    (operation): operation is PushCreate => operation.kind === 'create',
  )
  const route = await routeAdditions(flow, creates)
  if (typeof route === 'string') {
    emit({ kind: 'log', level: 'error', item: null, message: route })
    return abortedOutcome([route])
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

  for (const [index, name] of names.entries()) {
    emit({ kind: 'item-start', item: name, index, total: names.length })
    const owned = byList.get(name) ?? []
    if (owned.length === 0) {
      // A key held in several binders is pushed once, at its first list's turn
      // (or by the CSV upload, before the loop began), and credited to every list
      // holding it — so a list with nothing of its own may still have moved
      // copies, and must not report "no changes". Nor may a list the CSV already
      // failed: "could not be imported; no changes" is two answers to one
      // question.
      const entry = results.track(name)
      if (
        entry.status !== 'failed' &&
        entry.added === 0 &&
        entry.removed === 0 &&
        entry.pending === 0
      ) {
        emit({ kind: 'log', level: 'info', item: name, message: 'No changes.' })
        results.finish(name, 'no changes')
      } else {
        results.finish(name)
      }
      continue
    }

    for (const operation of owned) {
      const applied = await runPushOperation(flow, operation, name, route.kind !== 'individual')
      if (!applied) continue
      const operationAdd = operationAdded(operation)
      const operationRemove = operationRemoved(operation)
      added += operationAdd
      removed += operationRemove
      // A key held in several lists is equally pushed from each of them, so the
      // counts (and any failure) are recorded against all of them.
      for (const list of operation.lists) {
        const entry = results.track(list)
        entry.added += operationAdd
        entry.removed += operationRemove
      }
    }

    results.finish(name)
  }

  for (const operation of orphaned) {
    // Orphans are removals — a card no list holds any more — so the CSV route
    // never applies to them.
    const applied = await runPushOperation(flow, operation, null, false)
    if (!applied) {
      errors.push(pushFailureReason(operation))
      continue
    }
    removed += operationRemoved(operation)
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
  }
}

/** The reason recorded when an orphaned operation fails; the log carries the detail. */
function pushFailureReason(operation: PushOperation): string {
  return `Failed to remove ${describeCollectionKey(operation.name, operation.parts)} from Archidekt`
}

/**
 * Execute one push operation, returning whether it applied. A failure is
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
): Promise<boolean> {
  const { client, token, dryRun, emit, results } = flow
  const label = describeCollectionKey(operation.name, operation.parts)

  const fail = (reason: string): boolean => {
    emit({ kind: 'log', level: 'error', item: list, message: reason })
    for (const name of operation.lists) results.fail(name, reason)
    return false
  }

  const log = (message: string): void => {
    emit({ kind: 'log', level: 'info', item: list, message })
  }

  if (operation.kind === 'create') {
    // Said before anything is sent (and on dry runs too): the record about to be
    // created will not carry the language the local line does.
    const languageWarning = unmappableLanguageWarning(operation.name, operation.parts)
    if (languageWarning) emit({ kind: 'log', level: 'warn', item: list, message: languageWarning })
    if (dryRun && csvRouted) {
      log(
        `[dry-run] Would add ${operation.quantity} × ${label} one at a time — the printing is not in the Scryfall cache, so it cannot ride the CSV and was not resolved here.`,
      )
      return true
    }
    // Resolving the printing is a read, so a dry run does it too: an
    // unresolvable printing is the failure a dry run most needs to surface.
    const found = await client.searchCards(
      operation.name,
      operation.parts.set,
      token,
      operation.parts.collectorNumber,
    )
    if (typeof found === 'string') return fail(found)
    if (dryRun) {
      log(`[dry-run] Would add ${operation.quantity} × ${label}.`)
      return true
    }
    try {
      await client.createCollectionRecord(createRecordBody(operation, found.id), token)
    } catch (error: unknown) {
      return fail(`Failed to add ${label}: ${getErrorMessage(error)}`)
    }
    log(`Added ${operation.quantity} × ${label}.`)
    return true
  }

  if (operation.kind === 'update') {
    const grew = operation.delta > 0
    const change = `${Math.abs(operation.delta)} × ${label}`
    if (dryRun) {
      log(`[dry-run] Would ${grew ? 'add' : 'remove'} ${change}.`)
      return true
    }
    try {
      await client.updateCollectionRecord(operation.record.id, updateRecordBody(operation), token)
    } catch (error: unknown) {
      return fail(`Failed to update ${label}: ${getErrorMessage(error)}`)
    }
    log(`${grew ? 'Added' : 'Removed'} ${change}.`)
    return true
  }

  if (dryRun) {
    log(`[dry-run] Would remove ${operation.removed} × ${label}.`)
    return true
  }
  try {
    await client.deleteCollectionRecords(
      operation.records.map((record) => record.id),
      token,
    )
  } catch (error: unknown) {
    return fail(`Failed to remove ${label}: ${getErrorMessage(error)}`)
  }
  log(`Removed ${operation.removed} × ${label}.`)
  return true
}
