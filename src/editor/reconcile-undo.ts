import type { ChangeEvent } from '../change-event'
import type { UndoEntry } from './useCardChanges.js'
import { applyChangesCollectingMisses, type ApplyChange, type UnmatchedChange } from './apply-batch'

/**
 * Reconcile ID pool state after an undo operation.
 *
 * `remainingChanges` are the pending changes left after the undo. An undone
 * `add` — or `move-to`, which the reducers apply as an add under a fresh
 * destination id (the swap wizard emits them) — only frees its ID when nothing
 * left still uses it: a multi-copy add emits one event per copy under a single
 * ID (decks fold the copies into one entry), so undoing one copy must not hand
 * that ID out again while the other copies still carry it.
 */
export function reconcileIdPoolForUndo(
  release: (id: number) => void,
  claim: (id: number) => void,
  entry: UndoEntry,
  remainingChanges: ChangeEvent[] = [],
): void {
  const stillInUse = (id: number): boolean =>
    remainingChanges.some((c) => (c.action === 'add' || c.action === 'move-to') && c.cardId === id)

  if (entry.addedChange) {
    const change = entry.addedChange
    if (
      (change.action === 'add' || change.action === 'move-to') &&
      change.cardId !== undefined &&
      !stillInUse(change.cardId)
    ) {
      release(change.cardId)
    }
    // A move out of the list frees its id just like a removal, so undoing one
    // must reclaim that id to restore the card's original &N.
    if (
      (change.action === 'remove' || change.action === 'move-from') &&
      change.cardId !== undefined
    ) {
      claim(change.cardId)
    }
  }
  if (entry.cancelledChange) {
    const change = entry.cancelledChange
    if (change.action === 'remove' && change.cardId !== undefined) {
      release(change.cardId)
    }
    if (change.action === 'add' && change.cardId !== undefined) {
      claim(change.cardId)
    }
  }
}

/** What a replay produced, and which of its changes the engine would not take. */
export type ReplayResult<TData, TChange> = {
  data: TData
  /**
   * Changes the engine refused, each with the reason it gave. A replay runs a
   * change list against the *on-disk baseline*, so a change that applied when
   * it was recorded can become impossible once an earlier one is undone or
   * re-targeted — setting a card foil after the `set-printing` that pinned it
   * has been undone, say. The caller must drop these from the pending list: a
   * change event kept for an edit the data never took would be written to the
   * changelog on save, claiming an edit the file does not contain.
   */
  refused: UnmatchedChange<TChange>[]
}

/**
 * Rebuild data state by replaying a list of changes on top of original data,
 * reporting the ones the engine would not take. The reasons are carried rather
 * than collapsed into a boolean: a caller that reports them to the user (the
 * change-bundle import) has to name the right one.
 */
export function replayChanges<TData, TChange>(
  original: TData,
  changes: readonly TChange[],
  applyChange: ApplyChange<TData, TChange>,
): ReplayResult<TData, TChange> {
  const { data, unmatched } = applyChangesCollectingMisses(original, changes, applyChange)
  return { data, refused: unmatched }
}
