/**
 * The Archidekt deck-sync engine, shared by every surface that syncs decks: the
 * `deck-sync` CLI command, the admin site's Sync Decks page (and its SSE stream),
 * and the `sync_decks` MCP tool.
 *
 * Progress is reported as structured {@link DeckSyncEvent}s rather than log lines
 * so each surface can present it in its own idiom — the CLI renders them to the
 * logger, the admin stream forwards them to the browser as they happen.
 */

import { ArchidektClient, createPacedArchidektClient } from '../clients/ArchidektClient'
import { getErrorMessage } from '../util/errors'
import { t } from '../i18n/t'
import {
  serializeDeckToMarkdown,
  writeDeckFrontMatter,
  type DeckFrontMatter,
} from '../list/deck-file'
import { getDeckFormatLabel } from '../list/deck-format'
import { appendChangelog } from '../changes/changelog-writer'
import type { DeckData } from '../list/deck'
import type { ArchidektRawDeckResponse } from '../importers/archidekt-types'
import {
  diffDeckCards,
  diffToChangeEvents,
  buildCardIdResolver,
  buildCardIdsResolver,
  filterDeckDiff,
  isDiffEmpty,
  applyDownloadDiff,
  applyPrintingUpdates,
  printingUpdatesToChangeEvents,
  syncDeckFormat,
  type DeckDiff,
  type PrintingMismatch,
} from './diff'
import { describeSkippedChanges, syncCancellationLog, SYNC_CANCELLED_REASON } from '../sync/common'
import { assignMissingDeckCardIds, collectDeckCardIds } from '../card/card-id'
import { reconcileListRefs } from '../list/list-refs'
import { checkDeckDivergence, describeDivergence } from './divergence'
import { hashPath, writeFileWithHash } from '../changes/content-hash'
import { getDecksDir } from '../config/ritual-config'
import type {
  DeckSyncDeckResult,
  DeckSyncEventHandler,
  DeckSyncOptions,
  DeckSyncRun,
  DeckTarget,
  SyncOutcome,
  SyncFlow,
} from './types'
import { buildUploadPlan } from './upload-plan'
import { resolveTargetDecks } from './targets'

export { listSyncableDecks } from './targets'

export type {
  DeckSyncStatus,
  DeckSyncDeckResult,
  DeckSyncReport,
  DeckSyncLogLevel,
  UnreadableDeck,
  DeckSyncEvent,
  DeckSyncEventHandler,
  DeckSyncOptions,
  DeckSyncRun,
  SyncableDeck,
  ConfirmUnreadable,
} from './types'

// ── Persistence helpers ───────────────────────────────────────────────

/**
 * The front matter a completed sync stamps: `lastSynced` from the local clock
 * (what the user is shown), and `sourceUpdatedAt` copied verbatim from the
 * remote deck (the divergence guard's single-clock baseline — see
 * {@link checkDeckDivergence}).
 *
 * A remote timestamp Archidekt did not report clears the key rather than leaving
 * a stale one: a baseline older than the sync that just happened would refuse
 * the *next* push over changes this run already reconciled, and "no baseline"
 * fails open the way a never-synced deck does.
 */
function syncedFrontMatter(
  frontMatter: DeckFrontMatter,
  remoteUpdatedAt: string | undefined,
): DeckFrontMatter {
  const next: DeckFrontMatter = { ...frontMatter, lastSynced: new Date().toISOString() }
  if (typeof remoteUpdatedAt === 'string' && remoteUpdatedAt.trim() !== '') {
    next.sourceUpdatedAt = remoteUpdatedAt
  } else {
    delete next.sourceUpdatedAt
  }
  return next
}

/**
 * Write the deck back with a fresh sync stamp, returning every file the write
 * touched — the deck and its content-hash sidecar — so callers that commit a
 * run (the admin endpoints) stage the same set the editors do.
 */
async function saveDeckWithSyncTimestamp(
  target: DeckTarget,
  deck: DeckData,
  remoteUpdatedAt: string | undefined,
): Promise<string[]> {
  const markdown = serializeDeckToMarkdown(
    deck,
    syncedFrontMatter(target.frontMatter, remoteUpdatedAt),
  )
  await writeFileWithHash(target.filePath, markdown)
  return [target.filePath, hashPath(target.filePath)]
}

/**
 * Record a sync that changed no cards: the front matter's stamp moves, the body
 * does not. Written through {@link writeDeckFrontMatter} rather than the full
 * serializer so a pull that found nothing to apply does not also canonicalize
 * every card line — and so an unrecorded hand edit keeps its stale `.sha256`
 * sidecar, leaving `detect-changes` able to record it.
 */
async function stampSyncedFrontMatter(
  target: DeckTarget,
  remoteUpdatedAt: string | undefined,
): Promise<string[]> {
  const write = await writeDeckFrontMatter(
    target.filePath,
    syncedFrontMatter(target.frontMatter, remoteUpdatedAt),
  )
  return write.writtenFiles
}

// ── Run ───────────────────────────────────────────────────────────────

/**
 * Sync decks with Archidekt in one direction, emitting progress as it goes.
 *
 * Per-deck failures never abort the run: each deck's outcome lands in the report
 * and the next deck is attempted, so `failedCount` is what callers branch on.
 */
export async function runDeckSync(options: DeckSyncOptions): Promise<DeckSyncRun> {
  const { direction, token } = options
  const emit = options.onEvent ?? ((): void => {})
  const dryRun = options.dryRun ?? false
  const client =
    options.client ??
    createPacedArchidektClient((message) =>
      emit({ kind: 'log', level: 'warn', item: null, message }),
    )

  const { targets, problems, unreadable } = await resolveTargetDecks(
    options.deckNames ?? [],
    getDecksDir(),
    emit,
    options.confirmUnreadable,
    dryRun,
  )

  if (targets.length === 0 && problems.length === 0) {
    emit({ kind: 'log', level: 'info', item: null, message: 'No Archidekt decks found to sync.' })
  }

  const flow: SyncFlow = {
    client,
    token,
    direction,
    dryRun,
    only: options.only,
    force: options.force ?? false,
    syncPrintings: options.syncPrintings ?? false,
    emit,
    signal: options.signal,
  }
  const outcome: SyncOutcome =
    targets.length === 0
      ? { decks: [], writtenFiles: [], cancelled: false }
      : direction === 'pull'
        ? await downloadChanges(targets, flow)
        : await uploadChanges(targets, flow)

  const decks = [...problems, ...outcome.decks]
  const failedCount = decks.filter((deck) => deck.status === 'failed').length
  return {
    report: { direction, decks, failedCount, unreadable, cancelled: outcome.cancelled },
    writtenFiles: outcome.writtenFiles,
  }
}

/**
 * End a flow the caller cancelled. Every deck not yet started is reported
 * skipped — so the report still names each deck the run was asked for — and the
 * outcome says the run stopped early. Called only between decks: the one in
 * flight always finishes, so nothing is ever left half-synced.
 */
function cancelRemaining(
  remaining: readonly DeckTarget[],
  results: DeckSyncDeckResult[],
  writtenFiles: string[],
  emit: DeckSyncEventHandler,
): SyncOutcome {
  emit(syncCancellationLog('deck', remaining.length))
  for (const target of remaining) {
    finish(results, emit, {
      name: target.deck.name,
      status: 'skipped',
      reason: SYNC_CANCELLED_REASON,
    })
  }
  return { decks: results, writtenFiles, cancelled: true }
}

/** Emit a deck's final result and record it. */
function finish(
  results: DeckSyncDeckResult[],
  emit: DeckSyncEventHandler,
  result: DeckSyncDeckResult,
): void {
  results.push(result)
  emit({ kind: 'item-result', result })
}

/** Report a deck as failed: the reason on the log, then the result. */
function failDeck(
  results: DeckSyncDeckResult[],
  emit: DeckSyncEventHandler,
  name: string,
  reason: string,
): void {
  emit({ kind: 'log', level: 'error', item: name, message: reason })
  finish(results, emit, { name, status: 'failed', reason })
}

/**
 * The remote deck's `updatedAt` after a push, for the divergence baseline.
 *
 * A push that sent nothing kept `before`; one that sent cards moved the remote
 * on, so its new value has to be read back. `undefined` on any failure — the
 * baseline is then cleared and the next push fails open rather than refusing
 * over a timestamp Ritual made up.
 */
async function readRemoteUpdatedAt(
  client: ArchidektClient,
  sourceId: string,
  token: string,
  pushed: boolean,
  before: string | undefined,
): Promise<string | undefined> {
  if (!pushed) return before
  try {
    return (await client.fetchDeckRaw(sourceId, token)).updatedAt
  } catch {
    return undefined
  }
}

/** The report fields the printing pass adds to a deck's results. */
type PrintingResultFields = Pick<DeckSyncDeckResult, 'printingsChanged' | 'printingsUnaligned'>

/**
 * What this deck's results say about printings. The two fields are mutually
 * exclusive by construction: a run syncing printings reconciles them and
 * reports how many moved, while one that is not reports the cards it left
 * disagreeing. Neither reads as "zero printings were considered".
 */
function printingResultFields(flow: SyncFlow, diff: DeckDiff): PrintingResultFields {
  if (flow.syncPrintings) return { printingsChanged: diff.printingUpdates.length }
  // An advisory, so it is reported only when there is something to advise —
  // an empty array on every deck of every ordinary run would be noise.
  if (diff.unaligned.length === 0) return {}
  return { printingsUnaligned: diff.unaligned.map((mismatch) => mismatch.name) }
}

/**
 * Emit one warning per card the two sides hold at different printings. Only a
 * run without `--sync-printings` produces these: it syncs the card's quantity
 * and leaves its printings as they are, because reconciling them means adding
 * and removing copies — which is exactly what the flag opts into.
 */
function emitPrintingMismatches(
  flow: SyncFlow,
  deck: string,
  unaligned: readonly PrintingMismatch[],
): void {
  for (const mismatch of unaligned) {
    flow.emit({
      kind: 'log',
      level: 'warn',
      item: deck,
      message:
        `Printings not synced for "${mismatch.name}": the local file and Archidekt hold ` +
        'different printings of it. Re-run with --sync-printings to reconcile them.',
    })
  }
}

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  for (const [index, target] of targets.entries()) {
    if (flow.signal?.aborted)
      return cancelRemaining(targets.slice(index), results, writtenFiles, emit)
    const name = target.deck.name
    emit({ kind: 'item-start', item: name, index, total: targets.length })

    // Fetched with its raw payload: the pull records the remote's `updatedAt` as
    // the divergence baseline a later push compares against.
    let remoteDeck: DeckData
    let remoteUpdatedAt: string | undefined
    try {
      const fetched = await client.fetchDeckWithRaw(target.sourceId, token)
      remoteDeck = fetched.deck
      remoteUpdatedAt = fetched.raw.updatedAt
    } catch (error: unknown) {
      failDeck(results, emit, name, getErrorMessage(error))
      continue
    }

    // The filter narrows the diff before anything acts on it, so "no changes"
    // means "nothing left to apply" — with the skipped side reported either way.
    const { diff, skipped } = filterDeckDiff(
      diffDeckCards(target.deck.sections, remoteDeck.sections, {
        withPrintings: flow.syncPrintings,
      }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', item: name, message: skippedMessage })
    }
    emitPrintingMismatches(flow, name, diff.unaligned)
    // Spread into every result this deck produces, so structured consumers see
    // what the printing pass did without reading the log.
    const printingReport = printingResultFields(flow, diff)
    const formatSync = syncDeckFormat(target.deck, target.frontMatter.format, remoteDeck)

    if (isDiffEmpty(diff) && !formatSync.changed) {
      emit({ kind: 'log', level: 'info', item: name, message: 'No changes detected.' })
      // The sync still happened, so its stamp is still recorded. Skipping this
      // is what used to lock a deck out of `push`: a remote edit that touches no
      // card list (a rename, a category shuffle, another machine's push) moves
      // Archidekt's `updatedAt` without giving a pull anything to apply, and the
      // divergence guard's documented remedy — pull first — could never clear it.
      if (!dryRun && target.frontMatter.sourceUpdatedAt !== remoteUpdatedAt) {
        writtenFiles.push(...(await stampSyncedFrontMatter(target, remoteUpdatedAt)))
      }
      finish(results, emit, { name, status: 'synced', reason: 'no changes', ...printingReport })
      continue
    }

    const printingClause =
      diff.printingUpdates.length > 0
        ? `, ${t('domain.count.printings', { count: diff.printingUpdates.length })} changed`
        : ''
    const changeSummary = `+${diff.added.length} added, -${diff.removed.length} removed, ~${diff.quantityChanged.length} quantity changed${printingClause}`
    if (!isDiffEmpty(diff)) {
      emit({ kind: 'log', level: 'info', item: name, message: `Changes: ${changeSummary}` })
    }
    if (formatSync.changed && formatSync.format) {
      const was = formatSync.localFormat ? getDeckFormatLabel(formatSync.localFormat) : 'not set'
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        message: `Format: ${was} → ${getDeckFormatLabel(formatSync.format)}`,
      })
    }

    if (dryRun) {
      emit({ kind: 'log', level: 'info', item: name, message: '[dry-run] Not saved.' })
      finish(results, emit, {
        name,
        status: 'synced',
        reason: `dry-run: ${changeSummary}`,
        ...printingReport,
      })
      continue
    }

    // Apply changes to local sections, assigning IDs to any newly added cards so
    // they are persisted with a stable `&N` rather than being backfilled later.
    // Printings move first: a quantity change for re-pinned copies is keyed by
    // the printing they end up on, so the lines must already carry it.
    const updatedSections = applyDownloadDiff(
      applyPrintingUpdates(target.deck.sections, diff.printingUpdates),
      diff,
    )
    // Read before the ids are assigned: a card the pull removed frees its `&N`,
    // and the assigner hands free ids straight to the cards the same pull added,
    // so comparing against the *finished* deck would miss exactly the lines
    // whose art would otherwise resurface on a different card.
    const survivingIds = new Set(collectDeckCardIds({ sections: updatedSections }))
    const removedCardIds = collectDeckCardIds(target.deck).filter((id) => !survivingIds.has(id))

    const updatedDeck: DeckData = assignMissingDeckCardIds({
      ...target.deck,
      format: formatSync.format ?? undefined,
      sections: updatedSections,
    })

    // Write updated deck with lastSynced, THEN record the changelog — the same
    // ordering `finishListSave` converged the three save routes on, for the same
    // reason: neither order is atomic, and a crash between the two leaves either
    // a phantom history entry for an edit the file never received or a correct
    // file with a gap in its audit trail. `ritual history`, the change-bundle
    // export, and the editors' undo all *act on* changelog entries, so a phantom
    // propagates while a gap does not.
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, updatedDeck, remoteUpdatedAt)))

    // The deck's custom art and its cover image are filed under its card lines'
    // `&N`, so a pull that dropped lines must drop them with those lines. Only
    // pulls need this: a push writes the local deck back unchanged apart from
    // its sync stamp.
    // A cover rewrite touches the deck file a second time, so its paths are
    // deduplicated against the save's — staging the same path twice would make
    // the auto-commit's `git add` list lie about what changed.
    const refs = await reconcileListRefs(target.filePath, { removed: removedCardIds })
    for (const file of refs.writtenFiles) {
      if (!writtenFiles.includes(file)) writtenFiles.push(file)
    }

    // Changes are stamped with their card ID. Added and quantity-changed cards
    // resolve against the post-sync deck; removed cards (no longer present)
    // resolve against the pre-sync deck. Printing updates rewrite every line
    // of a card, so they resolve to one event per rewritten line.
    const resolveCardId = buildCardIdResolver(updatedDeck.sections, target.deck.sections)
    const changes = [
      ...diffToChangeEvents(diff, resolveCardId),
      ...printingUpdatesToChangeEvents(
        diff.printingUpdates,
        buildCardIdsResolver(updatedDeck.sections),
      ),
    ]
    if (changes.length > 0) {
      writtenFiles.push(await appendChangelog(target.filePath, target.deck.name, changes))
    }
    emit({ kind: 'log', level: 'info', item: name, message: 'Saved.' })
    finish(results, emit, { name, status: 'synced', ...printingReport })
  }

  return { decks: results, writtenFiles, cancelled: false }
}

// ── Upload flow ───────────────────────────────────────────────────────

async function uploadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, force, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []

  // A call cancelled before the run got this far skips the ownership fetch too.
  if (flow.signal?.aborted) return cancelRemaining(targets, results, writtenFiles, emit)

  // Fetch owned deck IDs for ownership check
  let ownedDeckIds: Set<string>
  try {
    const ownDecks = await client.fetchOwnDecks(token)
    ownedDeckIds = new Set(ownDecks.map((d) => d.id.toString()))
  } catch (error: unknown) {
    // No outer prefix: the client's error already names the operation that
    // failed ("Failed to fetch own decks: 502 …").
    const reason = getErrorMessage(error)
    emit({ kind: 'log', level: 'error', item: null, message: reason })
    // No deck could be synced without the ownership list — all failed.
    for (const target of targets) {
      finish(results, emit, { name: target.deck.name, status: 'failed', reason })
    }
    return { decks: results, writtenFiles, cancelled: false }
  }

  for (const [index, target] of targets.entries()) {
    if (flow.signal?.aborted)
      return cancelRemaining(targets.slice(index), results, writtenFiles, emit)
    const name = target.deck.name
    emit({ kind: 'item-start', item: name, index, total: targets.length })

    if (!ownedDeckIds.has(target.sourceId)) {
      const reason = `you do not own Archidekt deck ${target.sourceId}`
      emit({ kind: 'log', level: 'warn', item: name, message: `Skipping: ${reason}` })
      finish(results, emit, { name, status: 'skipped', reason })
      continue
    }

    // One fetch, read both ways: the raw payload for the upload plan's card ids
    // and `updatedAt`, the parsed deck for the diff. A failure leaves this deck
    // unsynced, and the run moves on to the next one rather than aborting.
    let rawDeck: ArchidektRawDeckResponse
    let remoteDeck: DeckData
    try {
      const fetched = await client.fetchDeckWithRaw(target.sourceId, token)
      rawDeck = fetched.raw
      remoteDeck = fetched.deck
    } catch (error: unknown) {
      failDeck(results, emit, name, getErrorMessage(error))
      continue
    }

    // A push overwrites the remote deck with the local file, so a remote that
    // moved on since the recorded sync is quiet data loss unless it was asked
    // for. A dry run reports the same refusal — that is what a real run would
    // do — rather than requiring --force to preview it.
    if (!force) {
      const check = checkDeckDivergence({
        remoteUpdatedAt: rawDeck.updatedAt,
        syncedUpdatedAt:
          typeof target.frontMatter.sourceUpdatedAt === 'string'
            ? target.frontMatter.sourceUpdatedAt
            : null,
      })
      if (check.kind === 'diverged') {
        failDeck(results, emit, name, describeDivergence(check.divergence))
        continue
      }
      // Failing open is deliberate, but silently is not: the push goes ahead
      // and the run log says the guard could not run. (`unsynced` is the
      // documented first-push case and needs no line.)
      if (check.kind === 'unknown') {
        emit({
          kind: 'log',
          level: 'warn',
          item: name,
          message: `${check.reason} — pushing without the divergence check.`,
        })
      }
    }

    // Uploads diff by name only: the modifyCards API path cannot yet target a
    // specific remote board/category, so board placement must be ignored here to
    // avoid spuriously moving cards on Archidekt. `withPrintings` rides the
    // flag so a new card's printing pin comes from the summary — set only when
    // the card's local lines agree on one printing.
    const { diff, skipped } = filterDeckDiff(
      diffDeckCards(remoteDeck.sections, target.deck.sections, {
        byBoard: false,
        withPrintings: flow.syncPrintings,
      }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', item: name, message: skippedMessage })
    }
    emitPrintingMismatches(flow, name, diff.unaligned)
    const printingReport = printingResultFields(flow, diff)

    if (isDiffEmpty(diff)) {
      emit({ kind: 'log', level: 'info', item: name, message: 'No changes to upload.' })
      finish(results, emit, { name, status: 'synced', reason: 'no changes', ...printingReport })
      continue
    }

    const printingClause =
      diff.printingUpdates.length > 0
        ? `, ${t('domain.count.printings', { count: diff.printingUpdates.length })} to change`
        : ''
    emit({
      kind: 'log',
      level: 'info',
      item: name,
      message: `Changes: +${diff.added.length} to add, -${diff.removed.length} to remove, ~${diff.quantityChanged.length} quantity changes${printingClause}`,
    })

    const plan = await buildUploadPlan(diff, target.deck.sections, rawDeck, client, token)

    // Plan errors are partial failures: some cards could not be turned into
    // upload entries, so the deck did not fully sync even if the rest pushes.
    const deckFailed = plan.errors.length > 0
    for (const err of plan.errors) {
      emit({ kind: 'log', level: 'warn', item: name, message: err })
    }

    if (dryRun) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        message: `[dry-run] Would push ${plan.entries.length} card changes to Archidekt.`,
      })
      finish(
        results,
        emit,
        deckFailed
          ? { name, status: 'failed', reason: plan.errors.join('; '), ...printingReport }
          : {
              name,
              status: 'synced',
              reason: `dry-run: would push ${plan.entries.length} card changes`,
              ...printingReport,
            },
      )
      continue
    }

    if (plan.entries.length > 0) {
      try {
        await client.modifyCards(target.sourceId, plan.entries, token)
        emit({
          kind: 'log',
          level: 'info',
          item: name,
          message: `Pushed ${plan.entries.length} card changes to Archidekt.`,
        })
      } catch (error: unknown) {
        failDeck(results, emit, name, `Failed to push changes: ${getErrorMessage(error)}`)
        continue
      }
    }

    // `lastSynced` records a sync that happened, so a deck whose plan could not
    // be fully built does not get one: it is reported as failed, and stamping it
    // would have the front matter (and every status surface reading it) claim a
    // sync the deck never completed.
    if (deckFailed) {
      finish(results, emit, {
        name,
        status: 'failed',
        reason: plan.errors.join('; '),
        ...printingReport,
      })
      continue
    }

    // The push itself moved the remote's `updatedAt`, so the pre-push value is
    // already stale as a divergence baseline — re-read it, or the very next push
    // would diverge against this run's own changes. A re-read that fails records
    // no baseline at all (the next push fails open and re-establishes one)
    // rather than a value known to be wrong.
    const pushedUpdatedAt = await readRemoteUpdatedAt(
      client,
      target.sourceId,
      token,
      plan.entries.length > 0,
      rawDeck.updatedAt,
    )
    writtenFiles.push(...(await saveDeckWithSyncTimestamp(target, target.deck, pushedUpdatedAt)))
    emit({ kind: 'log', level: 'info', item: name, message: 'Updated lastSynced.' })

    finish(results, emit, { name, status: 'synced', ...printingReport })
  }

  return { decks: results, writtenFiles, cancelled: false }
}
