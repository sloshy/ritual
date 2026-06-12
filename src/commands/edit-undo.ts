import type { ChangeEvent, ConsolidateResult } from '../change-event'
import type { CardSessionContext } from './card-session'

/**
 * The linear undo stack for edit-mode operations, shared by the flat-list
 * (collection/wanted) and deck sessions. Each operation records the inverse
 * changes that restore the pre-operation model state plus its session-changelog
 * footprint; the sessions differ only in how they apply changes and reclaim
 * released card ids, so those steps stay in their own modules.
 */

/** One edit-mode operation, with everything needed to undo it. */
export type EditUndoEntry = {
  /** The card id the operation targeted. */
  cardId: number
  /** Short description for the Undo Last Edit menu item, e.g. `printing on Sol Ring`. */
  label: string
  /** Inverse changes that restore the pre-operation state, applied in order. */
  inverse: ChangeEvent[]
  /** Changelog events this operation added; removed again on undo. */
  addedToChangelog: ChangeEvent[]
  /** Changelog events this operation displaced; restored on undo. */
  removedFromChangelog: ChangeEvent[]
  /** For removals: the entry/line id the undo restores (reclaimed when still free). */
  reclaimId?: number
}

/** The changelog footprint of one operation, as undo-entry fields. */
export type ChangelogDelta = Pick<EditUndoEntry, 'addedToChangelog' | 'removedFromChangelog'>

/** The changelog additions/removals of a consolidation, as undo-entry fields. */
export function changelogDelta(result: ConsolidateResult): ChangelogDelta {
  return {
    addedToChangelog: result.addedChange ? [result.addedChange] : [],
    removedFromChangelog: result.cancelledChange ? [result.cancelledChange] : [],
  }
}

/** Swap an undo entry's changelog footprint back out of the session changelog. */
export function swapUndoChangelog(ctx: CardSessionContext, undo: EditUndoEntry): void {
  const addedIds = new Set(undo.addedToChangelog.map((c) => c.id))
  ctx.sessionChanges = [
    ...ctx.sessionChanges.filter((c) => !addedIds.has(c.id)),
    ...undo.removedFromChangelog,
  ]
}

/**
 * Retarget every reference to `oldId` in the given undo entries to `newId`.
 * Used when a removal is undone after its released id was already reused by a
 * newer entry — the restored card takes a fresh id, and any deeper history for
 * the old id must follow it. The live changelog is left alone: events still
 * referencing `oldId` there belong to the newer entry that legitimately owns
 * the id now. The `cardId === oldId` guard makes a second visit to an event
 * shared between undo entries a no-op.
 */
export function retargetUndoCardId(entries: EditUndoEntry[], oldId: number, newId: number): void {
  const remapEvent = (c: ChangeEvent): void => {
    if ('cardId' in c && c.cardId === oldId) c.cardId = newId
  }
  for (const entry of entries) {
    if (entry.cardId === oldId) entry.cardId = newId
    entry.inverse.forEach(remapEvent)
    entry.addedToChangelog.forEach(remapEvent)
    entry.removedFromChangelog.forEach(remapEvent)
  }
}
