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
    if (change.action === 'remove' && change.cardId !== undefined) {
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
