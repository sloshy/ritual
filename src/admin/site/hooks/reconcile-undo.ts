import type { UndoEntry } from './useCardChanges.js'
import type { UseCardIdPoolResult } from './useCardIdPool.js'

/** Reconcile ID pool state after an undo operation. */
export function reconcileIdPoolForUndo(idPool: UseCardIdPoolResult, entry: UndoEntry): void {
  if (entry.addedChange) {
    const change = entry.addedChange
    if (change.action === 'add' && change.cardId !== undefined) {
      idPool.release(change.cardId)
    }
    if (change.action === 'remove' && change.cardId !== undefined) {
      idPool.claim(change.cardId)
    }
  }
  if (entry.cancelledChange) {
    const change = entry.cancelledChange
    if (change.action === 'remove' && change.cardId !== undefined) {
      idPool.release(change.cardId)
    }
    if (change.action === 'add' && change.cardId !== undefined) {
      idPool.claim(change.cardId)
    }
  }
}
