import type { ChangeEvent } from '../change-event'
import type { UndoEntry } from './useCardChanges.js'
import type { ApplyChange } from './apply-batch'

/**
 * Reconcile ID pool state after an undo operation.
 *
 * `remainingChanges` are the pending changes left after the undo. An undone
 * `add` only frees its ID when nothing left still uses it: a multi-copy add
 * emits one event per copy under a single ID (decks fold the copies into one
 * entry), so undoing one copy must not hand that ID out again while the other
 * copies still carry it.
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
    if (change.action === 'add' && change.cardId !== undefined && !stillInUse(change.cardId)) {
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
export function replayChanges<T, C>(original: T, changes: C[], applyChange: ApplyChange<T, C>): T {
  let rebuilt = original
  for (const change of changes) {
    rebuilt = applyChange(rebuilt, change)
  }
  return rebuilt
}
