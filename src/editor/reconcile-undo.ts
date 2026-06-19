import type { UndoEntry } from './useCardChanges.js'

/** Reconcile ID pool state after an undo operation. */
export function reconcileIdPoolForUndo(
  release: (id: number) => void,
  claim: (id: number) => void,
  entry: UndoEntry,
): void {
  if (entry.addedChange) {
    const change = entry.addedChange
    if (change.action === 'add' && change.cardId !== undefined) {
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

/** Rebuild data state by replaying a list of changes on top of original data. */
export function replayChanges<T, C>(
  original: T,
  changes: C[],
  applyChange: (data: T, change: C) => T,
): T {
  let rebuilt = original
  for (const change of changes) {
    rebuilt = applyChange(rebuilt, change)
  }
  return rebuilt
}
