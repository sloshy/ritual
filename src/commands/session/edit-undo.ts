import type {
  ChangeEvent,
  ConsolidateManyResult,
  ConsolidateResult,
} from '../../changes/change-event'
import { isSetCategoriesFor } from '../../changes/change-event'
import type { CardArtEdit } from './art'
import type { CategoryEdit } from './categories'
import { foldCategoryCardName } from '../../card/card-categories'
import { t } from '../../i18n/t'
import type { CardSessionContext, SessionAddItem, SessionChangeItem } from './strategy'

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
  /**
   * The card the operation targeted, by name. Kept alongside the id because the
   * id alone is not an identity: a removal releases its `&N` to the pool and a
   * later add takes it, so "is this row's card still here" has to compare the
   * name too — see {@link listSessionChangeItems}.
   */
  cardName: string
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
  /**
   * For an Edit Categories action: the categories the card had before it,
   * re-staged on undo as its own `set-categories` event. Wrapped like
   * {@link restoreArt}, so "restore an empty list" and "this is not a category
   * edit" stay different things. The model's `apply` cannot carry it — the
   * three apply engines treat category actions as no-ops — which is why it
   * travels outside {@link inverse}.
   */
  restoreCategories?: CategoryEdit
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

/** The changelog footprint of a many-event consolidation, as undo-entry fields. */
export function changelogDeltaMany(result: ConsolidateManyResult): ChangelogDelta {
  return {
    addedToChangelog: result.addedChanges,
    removedFromChangelog: result.cancelledChanges,
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
 *
 * "The same card" is the `&N` for every line edit — but a **category** edit is
 * the one operation keyed by card NAME: it restores a whole-list
 * `set-categories` for that name, which covers every line carrying it. Two
 * lines of one name (two printings in a collection, two sections in a deck) have
 * different ids and would otherwise both look unblocked, so undoing the older
 * one would silently overwrite the newer assignment in the sidecar.
 */
export function targetedUndoBlocker(entries: EditUndoEntry[], index: number): string | null {
  const target = entries[index]
  if (!target) return t('cli.edit.undoBlockedGone')
  const targetName = foldCategoryCardName(target.cardName)
  for (let later = entries.length - 1; later > index; later--) {
    const newer = entries[later]!
    const sameCategorySubject =
      target.restoreCategories !== undefined &&
      newer.restoreCategories !== undefined &&
      foldCategoryCardName(newer.cardName) === targetName
    if (newer.cardId === target.cardId || sameCategorySubject) {
      return t('cli.edit.undoBlockedNewer', { label: newer.label })
    }
  }
  return null
}

/**
 * Whether `cardId` still names the card called `name` in the live list. An id is
 * not an identity on its own: removals release their `&N` and later adds take it
 * back, so every "can this row's card be edited" question compares both.
 */
export type SameCardCheck = (cardId: number, name: string) => boolean

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
  isSameCard: SameCardCheck,
): SessionChangeItem[] {
  return [
    ...adds.map(
      (add): SessionChangeItem => ({
        label: `➕ ${t('cli.edit.sessionAdd', { label: add.label })}`,
        editable: add.cardId !== undefined && isSameCard(add.cardId, add.name),
      }),
    ),
    ...editUndo.map((entry, index): SessionChangeItem => {
      // Two spaces after the icon: variation-selector emoji render double-wide.
      const icon = entry.kind === 'removal' ? '🗑️' : entry.kind === 'move' ? '📤' : '✏️'
      const label = `${icon}  ${entry.label}`
      const blocked = targetedUndoBlocker(editUndo, index)
      // Only a field edit leaves a line behind — a removal or a move took the
      // card away — and even then the id must still name the same card, since a
      // removal elsewhere in the session may have handed it to a later add.
      const item: SessionChangeItem = {
        label,
        editable: entry.kind === 'edit' && isSameCard(entry.cardId, entry.cardName),
      }
      return blocked === null ? item : { ...item, blocked }
    }),
  ]
}

/**
 * The card id the session change at `index` targets, over the same
 * adds-then-edits concatenation {@link listSessionChangeItems} renders. Only
 * meaningful for a row that screen marked `editable`: a removal's id may since
 * have been reissued to a different card, and a discarded add's names nothing.
 */
export function sessionChangeCardId(
  adds: SessionAddItem[],
  editUndo: EditUndoEntry[],
  index: number,
): number | undefined {
  return index < adds.length ? adds[index]?.cardId : editUndo[index - adds.length]?.cardId
}

/** {@link foldOutCardChanges}' split of a session changelog. */
export type ChangelogFold = { kept: ChangeEvent[]; displaced: ChangeEvent[] }

/**
 * The `goneCardName` half of a {@link FoldOptions}, as a spreadable partial: an
 * absent key means another line of the name survives, so its name-keyed
 * category events must stay in the changelog.
 */
export type GoneCardName = Pick<FoldOptions, 'goneCardName'>

/** Options for {@link foldOutCardChanges}. */
export type FoldOptions = {
  /**
   * Keep the card's `add` events. A move keeps them so the changelog balances
   * (add + move out); a removal folds them along with everything else.
   */
  keepAdds: boolean
  /**
   * The card's name, given ONLY when the list holds no other line of that name
   * after the operation. A `set-categories` event carries no `cardId` — it is
   * keyed by name and covers every line of it — so an id-only fold would leave
   * `Set categories of "X" to …` in the changelog for a card the list no longer
   * holds. Passing the name folds those events out too; they come back with the
   * rest of `displaced` if the operation is undone.
   *
   * Left out while another line of the name survives: the assignment still
   * applies to it.
   */
  goneCardName?: string
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
  const goneName =
    options.goneCardName === undefined ? undefined : foldCategoryCardName(options.goneCardName)
  for (const change of changes) {
    const targetsCard = 'cardId' in change && change.cardId === cardId
    const targetsGoneName = goneName !== undefined && isSetCategoriesFor(change, goneName)
    if (targetsGoneName) displaced.push(change)
    else if (targetsCard && !(options.keepAdds && change.action === 'add')) displaced.push(change)
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
