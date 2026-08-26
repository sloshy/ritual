import { hashPath } from '../../changes/content-hash'
import { appendChangelog } from '../../changes/changelog-writer'
import {
  createAddChange,
  createMoveFromChange,
  listRefLabel,
  mirrorMoveTo,
  printingOptionsFrom,
  type AddChange,
  type ChangeEvent,
  type ListRef,
  type MoveFromChange,
  type MoveToChange,
  type PrintingTuple,
} from '../../changes/change-event'
import {
  createCardArtCache,
  type CardArtMap,
  type CardArtRef,
  type CardArtReconcileFailure,
} from '../../list/card-art'
import { reconcileListRefs } from '../../list/list-refs'
import { loadAllLists, type ListEntry, type PhysicalCard } from '../../commands/move-helpers'
import { t } from '../../i18n/t'
import type { SaveEffect } from '../../editor/save-effects'
import type { ApiMessage } from './result'
import {
  adoptedCardId,
  applyAddToStaged,
  applyRemoveIncomingFromStaged,
  loadStagedFile,
  stagedCardIds,
  writeStagedFile,
  type DroppedNote,
  type RemovedCopy,
  type StagedFile,
} from '../../commands/move-io'
import { replayLineCopies, type LineQuantities } from './save-helpers'

/**
 * Success body shared by the three editor save endpoints (deck/collection/wanted).
 * `droppedNotes` reports notes discarded by the destination side of this save's
 * cross-list moves (deck quantity merges keep the existing line's note).
 */
export type ListSaveResponse = ApiMessage & {
  success: true
  contentHash: string
  droppedNotes: DroppedNote[]
  /**
   * What the save did to individual entries, with the `&N` ids it allocated.
   *
   * The response is the only place these can appear: ids are assigned at
   * serialization time, so a client that added a card learns its id here rather
   * than by re-reading the list.
   */
  effects: SaveEffect[]
  /**
   * Custom-art sidecars this save could not re-file — its own, or a move
   * destination's. The card lines were written either way, which is why this is
   * a warning channel and not a failure: the same field name the load routes
   * use, so a client reads sidecar trouble out of one place in both directions.
   * Omitted when every reconcile was clean.
   */
  artWarnings?: string[]
}

/**
 * The list a save is writing, as its cross-list moves know it, plus which of
 * its `move-to` changes landed on an empty `&N` (see {@link freshMoveToChangeIds}).
 */
type SavedList = { ref: ListRef; file: string; freshMoveTos: ReadonlySet<string> }

/**
 * A move-from event paired with the list it leaves — the ref its move-to
 * changelog line records — and that list's file, the key its custom art is
 * read under.
 */
type Outgoing = { move: MoveFromChange; source: SavedList }

/**
 * A move-to event paired with the list it arrives in — the ref its move-from
 * changelog line records on the source — and that list's file, where the
 * departed copy's art is re-filed.
 */
type Incoming = { move: MoveToChange; dest: SavedList }

/**
 * One list a save's moves touch without saving it: the copies arriving
 * (`outgoing` from the saved lists' point of view) and leaving (`incoming`).
 * One staged copy per file, whichever direction — a swap touches the same
 * other list from both sides, and two stagings would clobber each other's
 * write.
 */
type OtherList = { listEntry: ListEntry; outgoing: Outgoing[]; incoming: Incoming[] }

/** An {@link OtherList} loaded into memory, ready for its moves to be applied. */
type StagedOther = OtherList & { file: StagedFile }

/** A removal applied in memory, with the source line as it was written. */
type RemovedIncoming = Incoming & { line: RemovedCopy }

/** One source list's incoming removals, applied, plus the ids it still held afterwards. */
type IncomingStage = {
  removed: RemovedIncoming[]
  /**
   * The `&N` the file still carried once the removals were applied and
   * **before** the additions were: the adds allocate from the pool the
   * removals just fed, so an id read after them looks alive even when the
   * line that held it is gone.
   */
  surviving: Set<number>
}

/**
 * The movable-card shape `applyAddToStaged` consumes, from a printing tuple
 * the save carries: a move-from event (the copy leaving a saved list) or an
 * incoming move's `replacement` (the printing its source gets back). No
 * cardId: the destination allocates a fresh id when the line is added. The
 * set code is normalized here because this is where the event stops being an
 * event and becomes in-memory card state — admin clients may send uppercase
 * codes in the request body.
 */
function movedPhysicalCard(name: string, tuple: PrintingTuple, listEntry: ListEntry): PhysicalCard {
  return {
    key: '',
    name,
    set: tuple.set?.toLowerCase(),
    collectorNumber: tuple.collectorNumber,
    finish: tuple.finish,
    condition: tuple.condition,
    language: tuple.language,
    listEntry,
  }
}

/**
 * The source-side `move-from` an incoming move's removal is logged as. It
 * describes the LINE that left — its own name spelling, its printing as
 * written (a bare finish stays bare), its `&N` — exactly as `commitAllMoves`
 * logs the physical card; the event's resolved finish and full name are the
 * destination's to record.
 */
function mirrorMoveFrom(line: RemovedCopy, to: ListRef): MoveFromChange {
  return createMoveFromChange(line.name, { ...printingOptionsFrom(line), to })
}

/**
 * The ids of the `move-to` changes in a save whose destination line held no
 * copy when they landed — a brand-new `&N`, or one this same stack had drained
 * and the pool handed straight back — as opposed to a copy that merged onto a
 * line still standing. Replayed in order against the on-disk copy counts, the
 * same way `removedArtCardIds` tells a decrement from a removal. What decides
 * whether the arriving copy's custom art may take the line: a standing line
 * keeps its own art (the rule `adoptedCardId` states for the outgoing side);
 * an emptied or new one adopts the incoming reference.
 */
export function freshMoveToChangeIds(
  changes: readonly ChangeEvent[],
  baseline: LineQuantities,
): Set<string> {
  const fresh = new Set<string>()
  for (const step of replayLineCopies(changes, baseline, { unknownIdHolds: 0 })) {
    if (step.change.action === 'move-to' && step.before <= 0) fresh.add(step.change.id)
  }
  return fresh
}

/** What the other side of a save's moves reports back, beyond the files it wrote. */
export type MovesOutcome = {
  /** Notes the destination adds had to discard (deck quantity merges). */
  droppedNotes: DroppedNote[]
  /**
   * Why a sidecar could not be re-filed, one raw reason per failure. The moved
   * cards' lines are in place; what did not happen is their art following
   * them, so this is reported to the caller rather than thrown — the
   * alternative is a move that looks clean while the art it was carrying was
   * quietly dropped.
   *
   * The reconcile's own refusal, not a rendered sentence: the admin save wraps
   * it in the response's wording (`unreconciledArtWarning`) and the CLI editor
   * prints its own (`warnUnreconciledArt`), so the phrasing belongs to whichever
   * surface is speaking.
   */
  artFailures: CardArtReconcileFailure[]
}

/**
 * What the other side of an editor save's moves produced: every file written
 * (list markdown + hash sidecars + changelogs + art sidecars), deduplicated for
 * git staging, the outcome notes, and the custom art arriving on each saved
 * list.
 */
export type CrossListMovesResult = MovesOutcome & {
  writtenFiles: string[]
  /**
   * Custom art that followed an incoming copy, keyed by the saved list's file
   * and then by the destination line's `&N`. Not written here: the saved
   * list's own save tail files it (`ListSaveTail.adoptedArt`), after the ids
   * its removals freed are dropped — so a copy arriving on an id this same
   * save drained keeps the arriving art rather than losing it to the drop.
   */
  adoptedArt: Map<string, CardArtMap>
}

/** {@link CrossListMovesResult} for one saved list, its own adopted art flattened out. */
export type ListMovesResult = MovesOutcome & { writtenFiles: string[]; adoptedArt: CardArtMap }

/** The outgoing-only result: nothing arrives on the saved list, so no art is adopted there. */
export type OutgoingMovesResult = MovesOutcome & { writtenFiles: string[] }

/**
 * One saved list's pending changes, with the ref its mirrored changelog
 * entries record on the other lists.
 *
 * `file` is the list's own file. Custom art is read from its sidecar, keyed by
 * path rather than resolved from `ref`: a list's display name is not the same
 * string on every surface — `loadAllLists` names a flat list by its `# Title`
 * H1, the CLI editor by its file slug — and a name lookup that missed would
 * silently carry no art while the source's own save dropped it, destroying the
 * reference instead of moving it.
 */
export type MoveBatch = {
  ref: ListRef
  file: string
  changes: readonly ChangeEvent[]
  /**
   * The saved list as it stands on disk, copies per `&N` — what tells an
   * incoming copy that merged onto a standing line (keeps that line's art)
   * from one that took an empty id (adopts the arriving art). Omitted by
   * callers whose batches carry no `move-to` (the CLI editor's outgoing path).
   */
  baseline?: LineQuantities
}

/** A {@link MoveBatch} whose `move-from` changes alone are committed — the CLI editor's closed-destination path. */
export type OutgoingMoveBatch = {
  sourceRef: ListRef
  sourceFile: string
  changes: readonly ChangeEvent[]
}

/**
 * The other side of one or more lists' moves, validated and applied in memory
 * with nothing written yet. `commit` performs every write. Splitting the phases
 * lets a caller saving several lists at once (the editor's multi-list save)
 * stage every batch before the first byte lands, so a failure in any batch
 * aborts the whole save with no other list written.
 */
export type PreparedMoves = {
  /** Notes the destination adds had to discard (deck quantity merges). */
  droppedNotes: DroppedNote[]
  /** WRITE phase: the other lists' files, their art, then one changelog entry per list. */
  commit: () => Promise<CrossListMovesResult>
}

/** {@link PreparedMoves} for an outgoing-only staging. */
export type PreparedOutgoingMoves = {
  droppedNotes: DroppedNote[]
  commit: () => Promise<OutgoingMovesResult>
}

/** The art edits one other list's sidecar needs once the staged moves land. */
type ArtPlan = { removed: Set<number>; added: Map<number, CardArtRef> }

function artPlanFor(byFile: Map<string, ArtPlan>, filePath: string): ArtPlan {
  let plan = byFile.get(filePath)
  if (!plan) {
    plan = { removed: new Set(), added: new Map() }
    byFile.set(filePath, plan)
  }
  return plan
}

const NO_BASELINE: LineQuantities = new Map()

/**
 * Stage the other side of a save's cross-list moves, both directions at once:
 *
 * - a `move-from {to}` in a saved list adds the card to `to` (and logs a
 *   `move-to` there); the source side — removal + `move-from` changelog — is
 *   the normal save path's;
 * - a `move-to {from}` in a saved list takes the copy out of `from` (and logs a
 *   `move-from` there); the destination side — the added line + `move-to`
 *   changelog — is, again, the normal save path's.
 *
 * Mirrors {@link import('../../commands/move-helpers').commitAllMoves}'s
 * load-validate-then-write ordering: every other list is pre-loaded, removals
 * applied, then adds, all in memory, before anything is written — so a missing
 * list, a source holding no copy to take, or an invalid add (a printing-less
 * card into a collection) throws here, before any file is mutated. Other lists
 * are grouped across every batch *and both directions*, so two sources moving
 * into the same list — or a swap, which leaves and enters the same list — stage
 * against one loaded copy of its file rather than overwriting each other's
 * write. Removals go first so a swap's arriving copy can reuse the id the
 * departing one freed, exactly as `ritual move` allocates.
 *
 * Custom art follows the cards both ways. Outgoing: the destination line's
 * freshly allocated `&N` is read off the staged add and the source's reference
 * filed under it on commit (the source entry is dropped by the save tail, which
 * reconciles the source sidecar against its `removed` effects). Incoming: the
 * source line's reference is dropped from the source sidecar once no copy is
 * left on that id, and handed back (`adoptedArt`) for the saved list's tail to
 * file under the event's own `cardId` — when that copy landed on an empty id
 * (see {@link freshMoveToChangeIds}); a copy that merged onto a standing line
 * leaves that line's art alone, the rule `adoptedCardId` states for the
 * outgoing side.
 */
export async function prepareCrossListMoves(batches: readonly MoveBatch[]): Promise<PreparedMoves> {
  const outgoing: Outgoing[] = []
  const incoming: Incoming[] = []
  for (const { ref, file, changes, baseline } of batches) {
    const saved: SavedList = {
      ref,
      file,
      freshMoveTos: freshMoveToChangeIds(changes, baseline ?? NO_BASELINE),
    }
    for (const change of changes) {
      if (change.action === 'move-from') outgoing.push({ move: change, source: saved })
      else if (change.action === 'move-to') incoming.push({ move: change, dest: saved })
    }
  }
  if (outgoing.length === 0 && incoming.length === 0) {
    return {
      droppedNotes: [],
      commit: async () => ({
        writtenFiles: [],
        droppedNotes: [],
        artFailures: [],
        adoptedArt: new Map(),
      }),
    }
  }

  const allLists = await loadAllLists()
  const findList = (ref: ListRef): ListEntry | undefined =>
    allLists.find((l) => l.ref.type === ref.type && l.ref.name === ref.name)

  // Group by the other list's file so each is loaded, written, and logged once.
  const byFile = new Map<string, OtherList>()
  const otherFor = (listEntry: ListEntry): OtherList => {
    let group = byFile.get(listEntry.filePath)
    if (!group) {
      group = { listEntry, outgoing: [], incoming: [] }
      byFile.set(listEntry.filePath, group)
    }
    return group
  }
  for (const entry of outgoing) {
    const dest = findList(entry.move.to)
    if (!dest) {
      throw new Error(
        t('cli.move.destinationNotFound', {
          name: entry.move.cardName,
          list: listRefLabel(entry.move.to),
        }),
      )
    }
    otherFor(dest).outgoing.push(entry)
  }
  for (const entry of incoming) {
    const source = findList(entry.move.from)
    if (!source) {
      throw new Error(
        t('cli.move.sourceNotFound', {
          name: entry.move.cardName,
          list: listRefLabel(entry.move.from),
        }),
      )
    }
    otherFor(source).incoming.push(entry)
  }

  // LOAD: pre-read every other list (absence aborts before any mutation).
  const prepared: StagedOther[] = []
  for (const other of byFile.values()) {
    const { listEntry } = other
    const loaded = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!loaded.ok) {
      const missingKey =
        other.incoming.length > 0
          ? 'cli.move.abortSourceUnreadable'
          : 'cli.move.abortDestinationMissing'
      throw new Error(
        loaded.reason === 'unreadable-file'
          ? t(missingKey, { file: listEntry.filePath })
          : t('cli.move.abortMove', { reason: loaded.message }),
      )
    }
    prepared.push({ ...other, file: loaded.file })
  }

  // APPLY: in-memory removals (a source holding no copy to take throws here).
  const incomingByFile = new Map<string, IncomingStage>()
  for (const { listEntry, incoming: arrivals, file } of prepared) {
    if (arrivals.length === 0) continue
    const removed: RemovedIncoming[] = []
    for (const entry of arrivals) {
      const { move } = entry
      // The whole printing tuple rides along (two lines sharing a printing but
      // differing in finish or language are different physical copies) — and
      // the id is the SOURCE line's hint, never the event's own destination id.
      const line = applyRemoveIncomingFromStaged(file, {
        ...printingOptionsFrom(move),
        name: move.cardName,
        cardId: move.sourceCardId,
      })
      if (line === null) {
        throw new Error(
          t('cli.move.sourceCopyNotFound', {
            name: move.cardName,
            list: listRefLabel(move.from),
          }),
        )
      }
      removed.push({ ...entry, line })
    }
    incomingByFile.set(listEntry.filePath, { removed, surviving: stagedCardIds(file) })
  }

  // APPLY: replacements — the printing a source gets back for each copy an
  // incoming move took with `replacement` set (the swap wizard's "replace
  // taken copies"). A plain add on the source, logged there as one; it lands
  // in the section the departed line left, so the deck reads as before.
  const replacementAdds = new Map<string, AddChange[]>()
  for (const { listEntry, file } of prepared) {
    const stage = incomingByFile.get(listEntry.filePath)
    if (stage === undefined) continue
    for (const { move, line } of stage.removed) {
      if (!move.replacement) continue
      const added = applyAddToStaged(
        file,
        movedPhysicalCard(move.cardName, move.replacement, listEntry),
        listEntry.ref.type,
        line.section,
      )
      const adds = replacementAdds.get(listEntry.filePath) ?? []
      adds.push(
        createAddChange(move.cardName, {
          ...move.replacement,
          cardId: added.cardId,
          section: line.section,
        }),
      )
      replacementAdds.set(listEntry.filePath, adds)
    }
  }

  // APPLY: in-memory adds (a bad add — e.g. a printing-less card into a collection — throws here).
  const droppedNotes: DroppedNote[] = []
  const artByFile = new Map<string, ArtPlan>()
  // Read here, in the staging phase: a saved list's own save re-files its
  // sidecar against the ids its removal freed, and by then the departed entry
  // is gone. Other lists' sidecars are read before their own write below.
  const art = createCardArtCache()
  // The destination line each departing copy landed on, by event id: the
  // `&N` its mirrored `move-to` changelog line carries (the line's own id,
  // merged-onto or fresh — `adoptedCardId` is the stricter art rule).
  const landedOn = new Map<string, number>()
  for (const { listEntry, outgoing: departures, file } of prepared) {
    for (const { move, source } of departures) {
      const added = applyAddToStaged(
        file,
        movedPhysicalCard(move.cardName, move, listEntry),
        listEntry.ref.type,
      )
      if (added.droppedNote) droppedNotes.push(added.droppedNote)
      if (added.cardId !== undefined) landedOn.set(move.id, added.cardId)
      const adopted = adoptedCardId(added)
      if (adopted === undefined) continue
      const ref = await art.lookup(source.file, move.cardId)
      if (ref === undefined) continue
      artPlanFor(artByFile, listEntry.filePath).added.set(adopted, ref)
    }
  }

  // ART (incoming): the departed copy's reference leaves the source sidecar
  // once its line is gone — left there, the next card to take that `&N` would
  // wear it — and is handed to the saved destination's tail to file on the
  // arriving line. When it cannot land (no destination id on the event) the
  // loss is reported, never swallowed: `unfiled` joins the commit's
  // `artFailures` so the save says so.
  const unfiled: CardArtReconcileFailure[] = []
  const adoptedArt = new Map<string, CardArtMap>()
  for (const { listEntry } of prepared) {
    const stage = incomingByFile.get(listEntry.filePath)
    if (stage === undefined) continue
    for (const { move, dest, line } of stage.removed) {
      if (line.cardId === undefined) continue
      // A line that still has copies left keeps its id — and its art. Recorded
      // before the art lookup because the freed id is also what re-points the
      // list's cover image, and that is filed whether or not the line wore art.
      if (!stage.surviving.has(line.cardId)) {
        artPlanFor(artByFile, listEntry.filePath).removed.add(line.cardId)
      }
      const ref = await art.lookup(listEntry.filePath, line.cardId)
      if (ref === undefined) continue
      if (move.cardId === undefined) {
        unfiled.push({
          ok: false,
          message: t('cli.move.artUnfiled', {
            name: move.cardName,
            list: listRefLabel(move.from),
          }),
        })
        continue
      }
      // A copy that merged onto a standing destination line leaves that
      // line's own art alone.
      if (!dest.freshMoveTos.has(move.id)) continue
      let forDest = adoptedArt.get(dest.file)
      if (!forDest) {
        forDest = new Map()
        adoptedArt.set(dest.file, forDest)
      }
      forDest.set(move.cardId, ref)
    }
  }

  // appendChangelog is not idempotent, so committing the same staging twice
  // would duplicate the mirrored blocks. Latched rather than trusted to callers.
  let committed = false
  const commit = async (): Promise<CrossListMovesResult> => {
    if (committed) throw new Error('PreparedMoves.commit() is single-use')
    committed = true
    // WRITE: files, then one changelog entry per other list. Each mirrored
    // line names its own counterpart, so attribution survives the merged entry.
    const written: string[] = []
    const artFailures: CardArtReconcileFailure[] = [...unfiled]
    for (const { listEntry, file } of prepared) {
      await writeStagedFile(listEntry.filePath, file)
      written.push(listEntry.filePath, hashPath(listEntry.filePath))
    }
    for (const [filePath, plan] of artByFile) {
      // A sidecar this could not read keeps its own art, and the moving
      // cards' art is what is lost — reported, never swallowed. The list's
      // cover follows the same ids and is re-pointed in the same step.
      const reconciled = await reconcileListRefs(filePath, plan)
      if (!reconciled.art.ok) artFailures.push(reconciled.art)
      written.push(...reconciled.writtenFiles)
    }
    for (const { listEntry, outgoing: departures } of prepared) {
      const arrivals = incomingByFile.get(listEntry.filePath)?.removed ?? []
      // One entry per list, the lines in the order the user made the moves.
      const events: ChangeEvent[] = [
        ...departures.map(({ move, source }) =>
          mirrorMoveTo(move, source.ref, landedOn.get(move.id)),
        ),
        ...arrivals.map(({ dest, line }) => mirrorMoveFrom(line, dest.ref)),
        ...(replacementAdds.get(listEntry.filePath) ?? []),
      ].sort((a, b) => a.timestamp - b.timestamp)
      written.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, events))
    }
    return { writtenFiles: [...new Set(written)], droppedNotes, artFailures, adoptedArt }
  }

  return { droppedNotes, commit }
}

/**
 * Stage and immediately commit both directions of a single list's moves — the
 * admin save path, where there is no cross-list failure to shield against and
 * the two phases can collapse into one call. `baseline` is the list as it
 * stands on disk (see {@link MoveBatch.baseline}).
 */
export async function applyCrossListMoves(
  ref: ListRef,
  file: string,
  changes: readonly ChangeEvent[],
  baseline: LineQuantities,
): Promise<ListMovesResult> {
  const prepared = await prepareCrossListMoves([{ ref, file, changes, baseline }])
  const { adoptedArt, ...result } = await prepared.commit()
  return { ...result, adoptedArt: adoptedArt.get(file) ?? new Map() }
}

/**
 * Stage the destination side of any `move-from` changes in an editor save:
 * {@link prepareCrossListMoves} restricted to the outgoing direction. The CLI
 * editor's multi-list save uses this for its closed destinations; its own
 * sessions never hold a `move-to` that a file has not already absorbed.
 */
export async function prepareOutgoingMoves(
  batches: readonly OutgoingMoveBatch[],
): Promise<PreparedOutgoingMoves> {
  const prepared = await prepareCrossListMoves(
    batches.map(
      ({ sourceRef, sourceFile, changes }): MoveBatch => ({
        ref: sourceRef,
        file: sourceFile,
        changes: changes.filter((c) => c.action === 'move-from'),
      }),
    ),
  )
  return {
    droppedNotes: prepared.droppedNotes,
    commit: async (): Promise<OutgoingMovesResult> => {
      const { writtenFiles, droppedNotes, artFailures } = await prepared.commit()
      return { writtenFiles, droppedNotes, artFailures }
    },
  }
}

/** Stage and immediately commit a single source's outgoing moves. */
export async function applyOutgoingMoves(
  sourceRef: ListRef,
  sourceFile: string,
  changes: readonly ChangeEvent[],
): Promise<OutgoingMovesResult> {
  return (await prepareOutgoingMoves([{ sourceRef, sourceFile, changes }])).commit()
}
