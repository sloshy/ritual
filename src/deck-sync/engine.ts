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
import {
  serializeDeckToMarkdown,
  writeDeckFrontMatter,
  type DeckFrontMatter,
} from '../list/deck-file'
import { deckFormatLabelKey } from '../list/deck-format'
import { appendChangelog } from '../changes/changelog-writer'
import type { DeckData } from '../list/deck'
import type { ArchidektRawDeckResponse } from '../importers/archidekt-types'
import {
  diffDeckCards,
  filterDeckDiff,
  isDiffEmpty,
  applyDownloadDiff,
  applyPrintingUpdates,
  pullChangeEvents,
  syncDeckFormat,
  type DeckDiff,
  type PrintingMismatch,
} from './diff'
import {
  cancelledReason,
  describeSkippedChanges,
  dryRunReason,
  noChangesReason,
  syncCancellationLog,
} from '../sync/common'
import {
  errorMessage,
  errorParam,
  isNonEmpty,
  joinSyncMessages,
  nestSync,
  reasonFields,
  syncMessage,
  syncMessageOf,
  syncRef,
  type SyncMessage,
} from '../sync/message'
import { assignMissingDeckCardIds, collectDeckCardIds } from '../card/card-id'
import { reconcileListRefs } from '../list/list-refs'
import { checkDeckDivergence, describeDivergence } from './divergence'
import { hashPath, writeFileWithHash } from '../changes/content-hash'
import type {
  DeckSyncCardChange,
  DeckSyncDeckResult,
  DeckSyncEventHandler,
  DeckSyncOptions,
  DeckSyncRun,
  DeckTarget,
  SyncOutcome,
  SyncFlow,
} from './types'
import { buildUploadPlan, type LocalCategoriesOf } from './upload-plan'
import type { ChangeEvent } from '../changes/change-event'
import { commitCategoryChanges, type CardCategoriesRecord } from '../list/card-categories-sidecar'
import { getDecksDir, loadDefaultCategories } from '../config/ritual-config'
import { deckCardNameSet } from '../list/card-names'
import {
  loadDeckCategories,
  localCategoriesFor,
  pullCategoryChanges,
  refusedCategoriesMessage,
  remoteDeckCategories,
} from './categories'
import { resolveTargetDecks } from './targets'
import { deckChangeCounts, deckItemLines, describeDeckChangeSummary } from './describe'
import { deckSyncCardChanges } from './card-changes'

export { listSyncableDecks } from './targets'

export type {
  DeckSyncCardAdded,
  DeckSyncCardCategories,
  DeckSyncCardChange,
  DeckSyncCardMove,
  DeckSyncCardPrinting,
  DeckSyncCardQuantity,
  DeckSyncCardRemoved,
  DeckSyncPrinting,
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
    createPacedArchidektClient((wait) => emit({ kind: 'log', level: 'warn', item: null, ...wait }))

  const { targets, problems, unreadable } = await resolveTargetDecks(
    options.deckNames ?? [],
    getDecksDir(),
    emit,
    options.confirmUnreadable,
    dryRun,
  )

  if (targets.length === 0 && problems.length === 0) {
    emit({ kind: 'log', level: 'info', item: null, ...syncMessage('domain.sync.noDecks') })
  }

  const flow: SyncFlow = {
    client,
    token,
    direction,
    dryRun,
    only: options.only,
    force: options.force ?? false,
    syncPrintings: options.syncPrintings ?? false,
    syncCategories: options.syncCategories ?? false,
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
      outcome: 'cancelled',
      ...reasonFields(cancelledReason()),
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

/**
 * Report a deck as failed: the reason on the log, then the result. `fields`
 * carries what the run had already found or done for the deck, so a failure
 * after the diff still reports it.
 */
function failDeck(
  results: DeckSyncDeckResult[],
  emit: DeckSyncEventHandler,
  name: string,
  reason: SyncMessage,
  fields: ResultFields = {},
): void {
  emit({ kind: 'log', level: 'error', item: name, ...reason })
  finish(results, emit, { name, status: 'failed', ...reasonFields(reason), ...fields })
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

/** The report field board moves add to a deck's results. */
type BoardMoveResultFields = Pick<DeckSyncDeckResult, 'boardMoves'>

/** The report field the category pass adds to a deck's results. */
type CategoryResultFields = Pick<DeckSyncDeckResult, 'categoriesChanged'>

/** The report field the per-card change list adds to a deck's results. */
type CardChangeResultFields = Pick<DeckSyncDeckResult, 'changes'>

/** The report fields the diff and the category pass add to a deck's results. */
type ResultFields = PrintingResultFields &
  BoardMoveResultFields &
  CategoryResultFields &
  CardChangeResultFields

/** What this deck's results list card by card: present only when there is a change. */
function cardChangeResultFields(changes: DeckSyncCardChange[]): CardChangeResultFields {
  return changes.length > 0 ? { changes } : {}
}

/** What this deck's results say about board moves: a count, only when there is one. */
function boardMoveResultFields(diff: DeckDiff): BoardMoveResultFields {
  return diff.boardMoves.length > 0 ? { boardMoves: diff.boardMoves.length } : {}
}

/** What this deck's results say about categories: a count, only when the run synced them. */
function categoryResultFields(flow: SyncFlow, changed: number): CategoryResultFields {
  return flow.syncCategories ? { categoriesChanged: changed } : {}
}

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
      ...syncMessage('domain.sync.printingsUnaligned', { card: mismatch.name }),
    })
  }
}

/**
 * Emit a deck's change lines — its `Changes:` count, then a `detail` line per
 * card — from the very changes its result reports, once they are final. The
 * admin fallback replays the same {@link deckItemLines} from the report, so the
 * two cannot disagree. Nothing for a deck with no card changes.
 */
function emitDeckItemLines(
  flow: SyncFlow,
  deck: string,
  changes: readonly DeckSyncCardChange[],
): void {
  for (const line of deckItemLines(flow.direction, changes, flow.syncCategories)) {
    flow.emit({ kind: 'log', level: line.level, item: deck, ...syncMessageOf(line.text) })
  }
}

// ── Download flow ─────────────────────────────────────────────────────

async function downloadChanges(targets: DeckTarget[], flow: SyncFlow): Promise<SyncOutcome> {
  const { client, token, dryRun, only, emit } = flow
  const results: DeckSyncDeckResult[] = []
  const writtenFiles: string[] = []
  /** Stage a path once — a deck file can be touched by the save and the cover reconcile. */
  const stage = (paths: readonly string[]): void => {
    for (const file of paths) if (!writtenFiles.includes(file)) writtenFiles.push(file)
  }

  for (const [index, target] of targets.entries()) {
    if (flow.signal?.aborted)
      return cancelRemaining(targets.slice(index), results, writtenFiles, emit)
    const name = target.deck.name
    emit({ kind: 'item-start', item: name, index, total: targets.length })

    // Read before anything is written: a sidecar Ritual cannot parse fails the
    // deck whole rather than letting its cards sync and its categories not.
    let localCategories: CardCategoriesRecord | undefined
    if (flow.syncCategories) {
      const loaded = await loadDeckCategories(target.filePath)
      if (typeof loaded === 'string') {
        failDeck(
          results,
          emit,
          name,
          syncMessage('domain.sync.categoriesUnreadable', { error: loaded }),
        )
        continue
      }
      localCategories = loaded
    }

    // Fetched with its raw payload: the pull records the remote's `updatedAt` as
    // the divergence baseline a later push compares against, and reads the
    // categories off it.
    let remoteDeck: DeckData
    let remoteRaw: ArchidektRawDeckResponse
    try {
      const fetched = await client.fetchDeckWithRaw(target.sourceId, token)
      remoteDeck = fetched.deck
      remoteRaw = fetched.raw
    } catch (error: unknown) {
      failDeck(results, emit, name, errorMessage(error))
      continue
    }
    const remoteUpdatedAt = remoteRaw.updatedAt

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
      emit({ kind: 'log', level: 'info', item: name, ...skippedMessage })
    }
    emitPrintingMismatches(flow, name, diff.unaligned)
    const formatSync = syncDeckFormat(target.deck, target.frontMatter.format, remoteDeck)
    const cardsChanged = !isDiffEmpty(diff) || formatSync.changed

    // Apply changes to local sections. Printings move first: a quantity change
    // for re-pinned copies is keyed by the printing they end up on, so the lines
    // must already carry it. Pure, so the categories below can be diffed
    // against the deck the pull *will* write even on a dry run.
    const pulled = applyDownloadDiff(
      applyPrintingUpdates(target.deck.sections, diff.printingUpdates),
      diff,
      { listLabels: target.frontMatter.labels },
    )
    const pulledSections = pulled.sections
    for (const shortfall of pulled.shortfalls) {
      emit({
        kind: 'log',
        level: 'warn',
        item: name,
        ...syncMessage('domain.sync.moveShortfall', {
          count: shortfall.quantity,
          card: shortfall.name,
          from: shortfall.from,
          to: shortfall.to,
        }),
      })
    }

    const remoteCategories = flow.syncCategories ? remoteDeckCategories(remoteRaw) : undefined
    if (remoteCategories !== undefined && remoteCategories.refused.length > 0) {
      emit({
        kind: 'log',
        level: 'warn',
        item: name,
        ...refusedCategoriesMessage(remoteCategories.refused),
      })
    }
    const categoryChanges =
      localCategories !== undefined && remoteCategories !== undefined
        ? pullCategoryChanges(localCategories, remoteCategories, {
            ...target.deck,
            sections: pulledSections,
          })
        : []

    // Spread into every result this deck produces, so structured consumers see
    // what the printing and category passes did without reading the log.
    const cardChanges = deckSyncCardChanges(diff, categoryChanges)
    const report: ResultFields = {
      ...printingResultFields(flow, diff),
      ...boardMoveResultFields(diff),
      ...categoryResultFields(flow, categoryChanges.length),
      ...cardChangeResultFields(cardChanges),
    }

    if (!cardsChanged && categoryChanges.length === 0) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        ...syncMessage('domain.sync.noChangesDetected'),
      })
      // The sync still happened, so its stamp is still recorded. Skipping this
      // is what used to lock a deck out of `push`: a remote edit that touches no
      // card list (a rename, a category shuffle, another machine's push) moves
      // Archidekt's `updatedAt` without giving a pull anything to apply, and the
      // divergence guard's documented remedy — pull first — could never clear it.
      if (!dryRun && target.frontMatter.sourceUpdatedAt !== remoteUpdatedAt) {
        stage(await stampSyncedFrontMatter(target, remoteUpdatedAt))
      }
      finish(results, emit, {
        name,
        status: 'synced',
        outcome: 'unchanged',
        ...reasonFields(noChangesReason()),
        ...report,
      })
      continue
    }

    const changeSummary = describeDeckChangeSummary(
      'pull',
      deckChangeCounts(cardChanges, flow.syncCategories),
    )
    /**
     * The deck's change lines and its format line, from the changes its result
     * reports — said once the writes have landed (or, on a dry run, now), so
     * they describe what went through.
     */
    const announce = (changes: readonly DeckSyncCardChange[]): void => {
      emitDeckItemLines(flow, name, changes)
      if (formatSync.changed && formatSync.format) {
        const was = formatSync.localFormat
          ? syncRef(deckFormatLabelKey(formatSync.localFormat))
          : syncRef('domain.sync.formatNotSet')
        emit({
          kind: 'log',
          level: 'info',
          item: name,
          ...syncMessage('domain.sync.formatChanged', {
            from: was,
            to: syncRef(deckFormatLabelKey(formatSync.format)),
          }),
        })
      }
    }

    if (dryRun) {
      announce(cardChanges)
      emit({ kind: 'log', level: 'info', item: name, ...syncMessage('domain.sync.dryRunNotSaved') })
      finish(results, emit, {
        name,
        status: 'synced',
        outcome: 'dry-run',
        ...reasonFields(dryRunReason(changeSummary)),
        ...report,
      })
      continue
    }

    let updatedDeck: DeckData = target.deck
    const changes: ChangeEvent[] = []
    if (cardsChanged) {
      // Read before the ids are assigned: a card the pull removed frees its `&N`,
      // and the assigner hands free ids straight to the cards the same pull added,
      // so comparing against the *finished* deck would miss exactly the lines
      // whose art would otherwise resurface on a different card.
      const survivingIds = new Set(collectDeckCardIds({ sections: pulledSections }))
      const removedCardIds = collectDeckCardIds(target.deck).filter((id) => !survivingIds.has(id))

      // Newly added cards get IDs now so they are persisted with a stable `&N`
      // rather than being backfilled later.
      updatedDeck = assignMissingDeckCardIds({
        ...target.deck,
        format: formatSync.format ?? undefined,
        sections: pulledSections,
      })

      // Write updated deck with lastSynced, THEN record the changelog — the same
      // ordering `finishListSave` converged the three save routes on, for the same
      // reason: neither order is atomic, and a crash between the two leaves either
      // a phantom history entry for an edit the file never received or a correct
      // file with a gap in its audit trail. `ritual history`, the change-bundle
      // export, and the editors' undo all *act on* changelog entries, so a phantom
      // propagates while a gap does not.
      stage(await saveDeckWithSyncTimestamp(target, updatedDeck, remoteUpdatedAt))

      // The deck's custom art and its cover image are filed under its card lines'
      // `&N`, so a pull that dropped lines must drop them with those lines. Only
      // pulls need this: a push writes the local deck back unchanged apart from
      // its sync stamp.
      const refs = await reconcileListRefs(target.filePath, { removed: removedCardIds })
      stage(refs.writtenFiles)

      // Changes are stamped with their card ID, in the order they were applied.
      changes.push(
        ...pullChangeEvents({
          diff,
          applied: pulled,
          saved: updatedDeck.sections,
          before: target.deck.sections,
        }),
      )
    } else {
      // Only the categories moved: the card lines are left exactly as written,
      // and the sync is recorded in the front matter alone.
      stage(await stampSyncedFrontMatter(target, remoteUpdatedAt))
    }

    // The categories file follows the deck file, and its events are recorded
    // only once it is written. A categories sync also prunes the entries of
    // cards the pull removed, as the deck's own save would.
    let categoryError: string | undefined
    if (flow.syncCategories) {
      const committed = await commitCategoryChanges(target.filePath, categoryChanges, {
        knownCardNames: deckCardNameSet(updatedDeck),
        defaultCategories: await loadDefaultCategories(),
      })
      stage(committed.writtenFiles)
      if (committed.error === undefined) changes.push(...categoryChanges)
      else categoryError = committed.error
    }

    if (changes.length > 0) {
      stage([await appendChangelog(target.filePath, target.deck.name, changes)])
    }
    if (categoryError !== undefined) {
      // The cards were written; the categories were not, so the lines and the
      // report list the card changes alone.
      const cardsOnly = deckSyncCardChanges(diff, [])
      announce(cardsOnly)
      failDeck(
        results,
        emit,
        name,
        syncMessage('domain.sync.categoriesWriteFailed', { error: categoryError }),
        {
          ...printingResultFields(flow, diff),
          ...boardMoveResultFields(diff),
          ...categoryResultFields(flow, 0),
          ...cardChangeResultFields(cardsOnly),
        },
      )
      continue
    }
    announce(cardChanges)
    emit({ kind: 'log', level: 'info', item: name, ...syncMessage('domain.sync.saved') })
    finish(results, emit, { name, status: 'synced', outcome: 'changed', ...report })
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
    // An error the client raised, carried in its own words.
    const reason = errorMessage(error)
    emit({ kind: 'log', level: 'error', item: null, ...reason })
    // No deck could be synced without the ownership list — all failed.
    for (const target of targets) {
      finish(results, emit, { name: target.deck.name, status: 'failed', ...reasonFields(reason) })
    }
    return { decks: results, writtenFiles, cancelled: false }
  }

  for (const [index, target] of targets.entries()) {
    if (flow.signal?.aborted)
      return cancelRemaining(targets.slice(index), results, writtenFiles, emit)
    const name = target.deck.name
    emit({ kind: 'item-start', item: name, index, total: targets.length })

    if (!ownedDeckIds.has(target.sourceId)) {
      const reason = syncMessage('domain.sync.notDeckOwner', { deckId: target.sourceId })
      emit({
        kind: 'log',
        level: 'warn',
        item: name,
        ...syncMessage('domain.sync.skipping', { reason: nestSync(reason) }),
      })
      finish(results, emit, { name, status: 'skipped', ...reasonFields(reason) })
      continue
    }

    // Read before anything is sent, for the same reason the pull does. A deck
    // with no local categories at all has nothing to say about Archidekt's: its
    // categories are left alone rather than wiped by a first push.
    let localCategoriesOf: LocalCategoriesOf | undefined
    if (flow.syncCategories) {
      const loaded = await loadDeckCategories(target.filePath)
      if (typeof loaded === 'string') {
        failDeck(
          results,
          emit,
          name,
          syncMessage('domain.sync.categoriesUnreadable', { error: loaded }),
        )
        continue
      }
      if (loaded.cards.size === 0) {
        emit({
          kind: 'log',
          level: 'warn',
          item: name,
          ...syncMessage('domain.sync.noLocalCategories'),
        })
      } else {
        localCategoriesOf = localCategoriesFor(loaded, target.deck)
      }
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
      failDeck(results, emit, name, errorMessage(error))
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
          ...syncMessage('domain.sync.divergenceUnchecked', { reason: nestSync(check.reason) }),
        })
      }
    }

    // Uploads diff per board like pulls do: on Archidekt a board is just a
    // category on the relation, so a card the local file holds in another board
    // is a board move the plan sends by re-categorizing the relation.
    // `withPrintings` rides the flag so a new card's printing pin comes from the
    // summary — set only when the card's local lines agree on one printing.
    const { diff, skipped } = filterDeckDiff(
      diffDeckCards(remoteDeck.sections, target.deck.sections, {
        withPrintings: flow.syncPrintings,
      }),
      only,
    )
    const skippedMessage = describeSkippedChanges(only, skipped)
    if (skippedMessage) {
      emit({ kind: 'log', level: 'info', item: name, ...skippedMessage })
    }
    emitPrintingMismatches(flow, name, diff.unaligned)
    const printingReport: PrintingResultFields & BoardMoveResultFields = {
      ...printingResultFields(flow, diff),
      ...boardMoveResultFields(diff),
    }

    // Without categories to compare, an empty card diff is the whole answer. With
    // them, only the plan can say whether any card's categories differ.
    if (isDiffEmpty(diff) && localCategoriesOf === undefined) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        ...syncMessage('domain.sync.noChangesToUpload'),
      })
      finish(results, emit, {
        name,
        status: 'synced',
        outcome: 'unchanged',
        ...reasonFields(noChangesReason()),
        ...printingReport,
        ...categoryResultFields(flow, 0),
      })
      continue
    }

    const plan = await buildUploadPlan(
      diff,
      target.deck.sections,
      rawDeck,
      client,
      token,
      localCategoriesOf,
    )
    // Everything below reports what the plan carries out, not the whole diff:
    // an entry an error kept out of the plan, or one that sends nothing, is
    // neither counted nor listed.
    const applied = plan.applied
    const cardChanges = deckSyncCardChanges(applied, plan.categoriesChanged)
    const report: ResultFields = {
      ...printingResultFields(flow, applied),
      ...boardMoveResultFields(applied),
      ...categoryResultFields(flow, plan.categoriesChanged.length),
      ...cardChangeResultFields(cardChanges),
    }

    // Nothing to send: an empty diff whose category pass touched no relation.
    // (Keyed on the entries, not the reported categories, which leave out a
    // rewrite that changes no card's roles but is still sent.)
    if (isDiffEmpty(diff) && plan.entries.length === 0) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        ...syncMessage('domain.sync.noChangesToUpload'),
      })
      finish(results, emit, {
        name,
        status: 'synced',
        outcome: 'unchanged',
        ...reasonFields(noChangesReason()),
        ...report,
      })
      continue
    }

    // From the changes the result reports: nothing when every entry errored or
    // the only rewrite changed no card's roles.
    emitDeckItemLines(flow, name, cardChanges)

    // Plan errors are partial failures: some cards could not be turned into
    // upload entries, so the deck did not fully sync even if the rest pushes.
    // The plan's errors, when it has any: a partial failure the deck reports.
    const planErrors = isNonEmpty(plan.errors) ? plan.errors : undefined
    for (const err of plan.errors) {
      emit({ kind: 'log', level: 'warn', item: name, ...err })
    }

    // A diff the plan turned into nothing to send — every printing update
    // already what Archidekt holds — changes nothing on Archidekt, whatever the
    // diff said. Reported as unchanged, like a deck whose diff was empty, by a
    // dry run and a real run alike — and only when the result lists no change
    // either, so the deck's `Changes:` line can never contradict its outcome.
    const nothingToSend =
      planErrors === undefined && plan.entries.length === 0 && cardChanges.length === 0
    const unchangedResult = (): DeckSyncDeckResult => ({
      name,
      status: 'synced',
      outcome: 'unchanged',
      ...reasonFields(noChangesReason()),
      ...report,
    })

    if (dryRun && nothingToSend) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        ...syncMessage('domain.sync.noChangesToUpload'),
      })
      finish(results, emit, unchangedResult())
      continue
    }

    if (dryRun) {
      emit({
        kind: 'log',
        level: 'info',
        item: name,
        ...syncMessage('domain.sync.dryRunWouldPush', { count: plan.entries.length }),
      })
      finish(
        results,
        emit,
        planErrors !== undefined
          ? { name, status: 'failed', ...reasonFields(joinSyncMessages(planErrors)), ...report }
          : {
              name,
              status: 'synced',
              outcome: 'dry-run',
              ...reasonFields(
                dryRunReason(
                  syncRef('domain.sync.wouldPushCardChanges', { count: plan.entries.length }),
                ),
              ),
              ...report,
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
          ...syncMessage('domain.sync.pushedCardChanges', { count: plan.entries.length }),
        })
      } catch (error: unknown) {
        failDeck(
          results,
          emit,
          name,
          syncMessage('domain.sync.pushFailed', { error: errorParam(error) }),
          report,
        )
        continue
      }
    }

    // `lastSynced` records a sync that happened, so a deck whose plan could not
    // be fully built does not get one: it is reported as failed, and stamping it
    // would have the front matter (and every status surface reading it) claim a
    // sync the deck never completed.
    if (planErrors !== undefined) {
      finish(results, emit, {
        name,
        status: 'failed',
        ...reasonFields(joinSyncMessages(planErrors)),
        ...report,
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
    emit({
      kind: 'log',
      level: 'info',
      item: name,
      ...syncMessage('domain.sync.updatedLastSynced'),
    })

    // Nothing to send (see `nothingToSend`): unchanged, though the real run
    // still records its sync stamp above.
    finish(
      results,
      emit,
      nothingToSend ? unchangedResult() : { name, status: 'synced', outcome: 'changed', ...report },
    )
  }

  return { decks: results, writtenFiles, cancelled: false }
}
