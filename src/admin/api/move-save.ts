import { hashPath } from '../../content-hash'
import { appendChangelog } from '../../changelog-writer'
import {
  createMoveToChange,
  listRefLabel,
  type ChangeEvent,
  type ListRef,
  type MoveFromChange,
} from '../../change-event'
import { loadAllLists, type ListEntry, type PhysicalCard } from '../../commands/move-helpers'
import {
  loadStagedFile,
  applyAddToStaged,
  writeStagedFile,
  type StagedFile,
} from '../../commands/move-io'

type DestGroup = {
  listEntry: ListEntry
  moves: MoveFromChange[]
}

/** Build the movable-card shape `applyAddToStaged` consumes from a move-from event. */
function physicalFromMove(mv: MoveFromChange, listEntry: ListEntry): PhysicalCard {
  // No cardId: the destination allocates a fresh id when the line is added.
  return {
    key: '',
    name: mv.cardName,
    set: mv.set,
    collectorNumber: mv.collectorNumber,
    finish: mv.finish,
    condition: mv.condition,
    listEntry,
  }
}

/**
 * Apply the destination side of any `move-from` changes in an editor save: for each
 * move, add the card to its target list and append a `move-to` changelog entry there.
 * The source side (removal + `move-from` changelog) is handled by the normal save path.
 *
 * Mirrors {@link import('../../commands/move-helpers').commitAllMoves}'s
 * load-validate-then-write ordering: every destination is pre-loaded and the adds
 * applied in memory before anything is written, so a missing destination or an
 * invalid add (e.g. a printing-less card into a collection) aborts before mutating
 * any file. Returns every file written (list markdown + hash sidecars + changelogs),
 * deduplicated, for git staging. A no-op (returns `[]`) when there are no moves.
 */
export async function applyOutgoingMoves(
  sourceRef: ListRef,
  changes: ChangeEvent[],
): Promise<string[]> {
  const moves = changes.filter((c): c is MoveFromChange => c.action === 'move-from')
  if (moves.length === 0) return []

  const allLists = await loadAllLists()

  // Group by destination file so each is loaded, written, and logged once.
  const byDest = new Map<string, DestGroup>()
  for (const mv of moves) {
    const dest = allLists.find((l) => l.ref.type === mv.to.type && l.ref.name === mv.to.name)
    if (!dest) {
      throw new Error(`Cannot move "${mv.cardName}": destination ${listRefLabel(mv.to)} not found`)
    }
    if (!byDest.has(dest.filePath)) byDest.set(dest.filePath, { listEntry: dest, moves: [] })
    byDest.get(dest.filePath)!.moves.push(mv)
  }

  // LOAD: pre-read every destination (absence aborts before any mutation).
  const staged = new Map<string, StagedFile>()
  for (const { listEntry } of byDest.values()) {
    const file = await loadStagedFile(listEntry.filePath, listEntry.ref.type)
    if (!file) throw new Error(`Destination file not found, aborting move: ${listEntry.filePath}`)
    staged.set(listEntry.filePath, file)
  }

  // APPLY: in-memory adds (a bad add — e.g. a printing-less card into a collection — throws here).
  for (const { listEntry, moves } of byDest.values()) {
    const file = staged.get(listEntry.filePath)!
    for (const mv of moves)
      applyAddToStaged(file, physicalFromMove(mv, listEntry), listEntry.ref.type)
  }

  // WRITE: files, then a move-to changelog entry per moved card.
  const written: string[] = []
  for (const [filePath, file] of staged.entries()) {
    await writeStagedFile(filePath, file)
    written.push(filePath, hashPath(filePath))
  }
  for (const { listEntry, moves } of byDest.values()) {
    const events = moves.map((mv) =>
      createMoveToChange(mv.cardName, {
        set: mv.set,
        collectorNumber: mv.collectorNumber,
        finish: mv.finish,
        condition: mv.condition,
        cardId: mv.cardId,
        from: sourceRef,
      }),
    )
    written.push(await appendChangelog(listEntry.filePath, listEntry.ref.name, events))
  }

  return [...new Set(written)]
}
