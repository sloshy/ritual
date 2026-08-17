import type { ChangeEvent, ConsolidateResult } from '../change-event'
import type { CardArtEdit } from './edit-art'
import { t } from '../i18n/t'
import type { CardSessionContext, SessionAddItem, SessionChangeItem } from './card-session'

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
  /** What the operation did — picks the icon in the session-changes list. */
  kind: 'edit' | 'removal' | 'move'
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
  /**
   * For a Set Custom Art edit: the card's art before it, re-staged on undo
   * (`ref: null` when it had none). The same {@link CardArtEdit} the prompt
   * resolves to — an undo stages a prior state exactly the way the action
   * staged the new one — and wrapped rather than a bare `CardArtRef | null`, so
   * "no art to put back" and "this operation is not an art edit" stay different
   * things.
   */
  restoreArt?: CardArtEdit
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
 * Why the edit operation at `index` cannot be undone out of order, or null when
 * a targeted undo is safe. An operation is blocked while a newer operation
 * touches the same card: its inverse would clobber the newer state, so the
 * same-card operations must be discarded newest-first. The newest operation for
 * any card is never blocked.
 */
export function targetedUndoBlocker(entries: EditUndoEntry[], index: number): string | null {
  const target = entries[index]
  if (!target) return t('cli.edit.undoBlockedGone')
  for (let later = entries.length - 1; later > index; later--) {
    if (entries[later]!.cardId === target.cardId) {
      return t('cli.edit.undoBlockedNewer', { label: entries[later]!.label })
    }
  }
  return null
}

/**
 * The unified View Session Changes list: the session's adds (each discardable
 * at any time) followed by its edit-mode operations (each discardable unless a
 * newer operation touches the same card). Indices align with the concatenation
 * of the two underlying arrays, so a chosen index maps straight back to an
 * add-discard or a targeted edit undo.
 */
export function listSessionChangeItems(
  adds: SessionAddItem[],
  editUndo: EditUndoEntry[],
): SessionChangeItem[] {
  return [
    ...adds.map(
      (add): SessionChangeItem => ({
        label: `➕ ${t('cli.edit.sessionAdd', { label: add.label })}`,
      }),
    ),
    ...editUndo.map((entry, index): SessionChangeItem => {
      // Two spaces after the icon: variation-selector emoji render double-wide.
      const icon = entry.kind === 'removal' ? '🗑️' : entry.kind === 'move' ? '📤' : '✏️'
      const label = `${icon}  ${entry.label}`
      const blocked = targetedUndoBlocker(editUndo, index)
      return blocked === null ? { label } : { label, blocked }
    }),
  ]
}

/** {@link foldOutCardChanges}' split of a session changelog. */
export type ChangelogFold = { kept: ChangeEvent[]; displaced: ChangeEvent[] }

/** Options for {@link foldOutCardChanges}. */
export type FoldOptions = {
  /**
   * Keep the card's `add` events. A move keeps them so the changelog balances
   * (add + move out); a removal folds them along with everything else.
   */
  keepAdds: boolean
}

/**
 * Split the session changelog around a line-level operation on `cardId`: the
 * card's earlier events are moot once the line is removed or moved, so they
 * fold out (`displaced`, restored again if the operation is undone) and the
 * rest stay (`kept`). The single home of this predicate — the removal and
 * move flows in both list modules consume it rather than hand-writing the
 * filter and its negation.
 */
export function foldOutCardChanges(
  changes: ChangeEvent[],
  cardId: number,
  options: FoldOptions,
): ChangelogFold {
  const kept: ChangeEvent[] = []
  const displaced: ChangeEvent[] = []
  for (const change of changes) {
    const targetsCard = 'cardId' in change && change.cardId === cardId
    if (targetsCard && !(options.keepAdds && change.action === 'add')) displaced.push(change)
    else kept.push(change)
  }
  return { kept, displaced }
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
