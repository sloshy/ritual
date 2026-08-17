import { hashPath } from '../../content-hash'
import { appendChangelog } from '../../changelog-writer'
import {
  listRefLabel,
  mirrorMoveTo,
  type ChangeEvent,
  type ListRef,
  type MoveFromChange,
} from '../../change-event'
import {
  createCardArtCache,
  reconcileCardArt,
  reconciledArtPath,
  type CardArtMap,
  type CardArtReconcileFailure,
} from '../../card-art'
import { loadAllLists, type ListEntry, type PhysicalCard } from '../../commands/move-helpers'
import { t } from '../../i18n/t'
import type { SaveEffect } from '../../editor/save-effects'
import type { ApiMessage } from './result'
import {
  adoptedCardId,
  loadStagedFile,
  applyAddToStaged,
  writeStagedFile,
  type DroppedNote,
  type StagedFile,
} from '../../commands/move-io'

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
 * A move-from event paired with the source list its move-to changelog line
 * records, and that list's file — the key its custom art is read under.
 */
type SourcedMove = { move: MoveFromChange; sourceRef: ListRef; sourceFile: string }

/** A destination list and its incoming moves, in batch order, each with its own source attribution. */
type DestMoves = { listEntry: ListEntry; moves: SourcedMove[] }

/** A destination staged for writing: its moves applied onto the loaded file. */
type PreparedDest = DestMoves & { file: StagedFile }

/** Build the movable-card shape `applyAddToStaged` consumes from a move-from event. */
function physicalFromMove(mv: MoveFromChange, listEntry: ListEntry): PhysicalCard {
  // No cardId: the destination allocates a fresh id when the line is added.
  // The set code is normalized here because this is where the event stops
  // being an event and becomes in-memory card state — admin clients may send
  // uppercase codes in the request body.
  return {
    key: '',
    name: mv.cardName,
    set: mv.set?.toLowerCase(),
    collectorNumber: mv.collectorNumber,
    finish: mv.finish,
    condition: mv.condition,
    language: mv.language,
    listEntry,
  }
}

/**
 * What the destination side of an editor save's moves produced: every file written
 * (list markdown + hash sidecars + changelogs), deduplicated for git staging, plus
 * any notes the destination adds had to discard (deck quantity merges).
 */
export type OutgoingMovesResult = {
  writtenFiles: string[]
  droppedNotes: DroppedNote[]
  /**
   * Why a destination sidecar could not be re-filed, one raw reason per
   * failure. The moved cards' lines are in place; what did not happen is their
   * art following them, so this is reported to the caller rather than thrown —
   * the alternative is a move that looks clean while the art it was carrying
   * was quietly dropped.
   *
   * The reconcile's own refusal, not a rendered sentence: the admin save wraps
   * it in the response's wording (`unreconciledArtWarning`) and the CLI editor
   * prints its own (`warnUnreconciledArt`), so the phrasing belongs to whichever
   * surface is speaking.
   */
  artFailures: CardArtReconcileFailure[]
}

/** One source list's pending changes, with the ref its move-to changelog entries record. */
export type OutgoingMoveBatch = {
  sourceRef: ListRef
  /**
   * The source list's file. Custom art is read from its sidecar, keyed by path
   * rather than resolved from `sourceRef`: a list's display name is not the same
   * string on every surface — `loadAllLists` names a flat list by its `# Title`
   * H1, the CLI editor by its file slug — and a name lookup that missed would
   * silently carry no art while the source's own save dropped it, destroying the
   * reference instead of moving it.
   */
  sourceFile: string
  changes: readonly ChangeEvent[]
}

/**
 * The destination side of one or more sources' moves, validated and applied in
 * memory with nothing written yet. `commit` performs every write. Splitting the
 * phases lets a caller saving several sources at once (the editor's multi-list
 * save) stage every batch before the first byte lands, so a validation failure
 * in any batch aborts the whole save with no destination written.
 */
export type PreparedOutgoingMoves = {
  /** Notes the destination adds had to discard (deck quantity merges). */
  droppedNotes: DroppedNote[]
  /** WRITE phase: destination files, then a move-to changelog entry per moved card. */
  commit: () => Promise<OutgoingMovesResult>
}

/**
 * Stage the destination side of any `move-from` changes in an editor save: for
 * each move, add the card to its target list in memory, ready to write (and
 * append a `move-to` changelog entry there) on `commit`. The source side
 * (removal + `move-from` changelog) is handled by the normal save path.
 *
 * Mirrors {@link import('../../commands/move-helpers').commitAllMoves}'s
 * load-validate-then-write ordering: every destination is pre-loaded and the adds
 * applied in memory before anything is written, so a missing destination or an
 * invalid add (e.g. a printing-less card into a collection) throws here, before
 * any file is mutated. Destinations are grouped across every batch, so two
 * sources moving into the same list stage against one loaded copy of its file
 * rather than overwriting each other's write.
 */
export async function prepareOutgoingMoves(
  batches: OutgoingMoveBatch[],
): Promise<PreparedOutgoingMoves> {
  const sourced: SourcedMove[] = batches.flatMap(({ sourceRef, sourceFile, changes }) =>
    changes
      .filter((c): c is MoveFromChange => c.action === 'move-from')
      .map((move): SourcedMove => ({ move, sourceRef, sourceFile })),
  )
  if (sourced.length === 0) {
    return {
      droppedNotes: [],
      commit: async () => ({ writtenFiles: [], droppedNotes: [], artFailures: [] }),
    }
  }

  const allLists = await loadAllLists()

  // Group by destination file so each is loaded, written, and logged once.
  const byDest = new Map<string, DestMoves>()
  for (const entry of sourced) {
    const { move } = entry
    const dest = allLists.find((l) => l.ref.type === move.to.type && l.ref.name === move.to.name)
    if (!dest) {
      throw new Error(
        t('cli.move.destinationNotFound', { name: move.cardName, list: listRefLabel(move.to) }),
      )
    }
    let group = byDest.get(dest.filePath)
    if (!group) {
      group = { listEntry: dest, moves: [] }
      byDest.set(dest.filePath, group)
    }
    group.moves.push(entry)
  }

  // LOAD: pre-read every destination (absence aborts before any mutation).
  const prepared: PreparedDest[] = []
  for (const { listEntry, moves } of byDest.values()) {
    const loaded = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!loaded.ok) {
      throw new Error(
        loaded.reason === 'unreadable-file'
          ? t('cli.move.abortDestinationMissing', { file: listEntry.filePath })
          : t('cli.move.abortMove', { reason: loaded.message }),
      )
    }
    prepared.push({ listEntry, moves, file: loaded.file })
  }

  // APPLY: in-memory adds (a bad add — e.g. a printing-less card into a collection — throws here).
  //
  // Custom art follows the card, exactly as `ritual move` (`commitAllMoves`)
  // carries it: the destination line's freshly allocated `&N` is read off the
  // staged add, and the ref is filed under it on commit. The source entry is
  // dropped by the save tail, which reconciles the source sidecar against its
  // `removed` effects, so a freed id never hands the departed card's art to the
  // next card added.
  const droppedNotes: DroppedNote[] = []
  const artByDest = new Map<string, CardArtMap>()
  // Read here, in the staging phase: the source's own save re-files its sidecar
  // against the ids its removal freed, and by then the departed entry is gone.
  const sourceArt = createCardArtCache()
  for (const { listEntry, moves, file } of prepared) {
    for (const { move, sourceFile } of moves) {
      const added = applyAddToStaged(file, physicalFromMove(move, listEntry), listEntry.ref.type)
      if (added.droppedNote) droppedNotes.push(added.droppedNote)
      const adopted = adoptedCardId(added)
      if (adopted === undefined) continue
      const ref = await sourceArt.lookup(sourceFile, move.cardId)
      if (ref === undefined) continue
      let forDest = artByDest.get(listEntry.filePath)
      if (!forDest) {
        forDest = new Map()
        artByDest.set(listEntry.filePath, forDest)
      }
      forDest.set(adopted, ref)
    }
  }

  // appendChangelog is not idempotent, so committing the same staging twice
  // would duplicate the move-to blocks. Latched rather than trusted to callers.
  let committed = false
  const commit = async (): Promise<OutgoingMovesResult> => {
    if (committed) throw new Error('PreparedOutgoingMoves.commit() is single-use')
    committed = true
    // WRITE: files, then one changelog entry per destination. Each move-to
    // line names its own source, so attribution survives the merged entry.
    const written: string[] = []
    const artFailures: CardArtReconcileFailure[] = []
    for (const { listEntry, file } of prepared) {
      await writeStagedFile(listEntry.filePath, file)
      written.push(listEntry.filePath, hashPath(listEntry.filePath))
    }
    for (const { listEntry } of prepared) {
      const added = artByDest.get(listEntry.filePath)
      if (added === undefined) continue
      // A sidecar this could not read keeps its own art, and the arriving
      // cards' art is what is lost — reported, never swallowed.
      const art = await reconcileCardArt(listEntry.filePath, { added })
      if (!art.ok) artFailures.push(art)
      const artPath = reconciledArtPath(art)
      if (artPath !== undefined) written.push(artPath)
    }
    for (const { listEntry, moves } of prepared) {
      const events = moves.map(({ move, sourceRef }) => mirrorMoveTo(move, sourceRef))
      written.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, events))
    }
    return { writtenFiles: [...new Set(written)], droppedNotes, artFailures }
  }

  return { droppedNotes, commit }
}

/**
 * Stage and immediately commit a single source's outgoing moves — the
 * single-list admin save path, where there is no cross-source failure to
 * shield against and the two phases can collapse into one call.
 */
export async function applyOutgoingMoves(
  sourceRef: ListRef,
  sourceFile: string,
  changes: ChangeEvent[],
): Promise<OutgoingMovesResult> {
  return (await prepareOutgoingMoves([{ sourceRef, sourceFile, changes }])).commit()
}
