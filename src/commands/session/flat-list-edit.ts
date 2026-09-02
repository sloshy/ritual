import {
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetNoteChange,
  printingOptionsFrom,
  type ChangeEvent,
} from '../../changes/change-event'
import type { Condition, Finish } from '../../card/finish-condition'
import type { CardLabel } from '../../card/card-labels'
import type { CardLanguage } from '../../card/card-language'
import { allocateId, claimId, releaseId } from '../../card/card-id'
import { t } from '../../i18n/t'
import type { EditActionChoice, PrintingFilterConfig } from './prompts'
import type {
  CardSessionContext,
  CardSessionStrategy,
  EditableEntryItem,
  SessionChangeEditAction,
  SessionChangeItem,
} from './strategy'
import {
  foldOutCardChanges,
  retargetUndoCardId,
  swapUndoChangelog,
  targetedUndoBlocker,
} from './edit-undo'
import {
  applyFieldEdit,
  confirmRemoval,
  discardSessionChangeAt,
  editArt,
  editLanguage,
  editLanguageById,
  editNote,
  lastEditLabel,
  editSessionChangeAt,
  listEditableEntries,
  listSessionChanges,
  logUpdatedLine,
  resetStaleLastAdded,
  type EditModel,
  type FieldEdit,
} from './edit-model'
import {
  addAnotherFlatListCopy,
  applyFlatListChange,
  discardFlatListAdd,
  listFlatListSessionAdds,
  persistFlatListSession,
  receiveFlatListMove,
  resetFlatListSessionTracking,
  type FlatListStrategyContext,
} from './flat-list-session'
import type { FlatListEntry } from '../../list/flat-list-read'
import {
  listRefTitle,
  moveFromOptionsFor,
  resolveMoveDestination,
  type MoveDeps,
  type MoveDestination,
  type MoveTargetsProvider,
} from './edit-move'
import { noteArtLineRemoved, noteArtLineRestored, noteArtSet } from './art'
import { hasSpecificPrinting } from '../../card/card-printing'

/**
 * Edit-mode operations shared by the collection and wanted sessions: targeting
 * an existing entry, folding field edits into the session changelog with
 * "latest wins" semantics, removal with card-id release, and the linear undo
 * stack that reverts all of it. The command strategies own the prompts that
 * differ per list type (printing/finish/condition pickers) and call into here
 * with the resolved change.
 */

/** The shared shape of collection and wanted entries that edit mode operates on. */
export type EditableFlatListEntry = FlatListEntry & {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The line's `[ja]`-style language token. Absent means `en`. */
  language?: CardLanguage
  /** Label override — collection entries only; wanted entries never carry one. */
  labels?: CardLabel[]
  note?: string
}

/** Find an entry by card id (entries always carry ids after session load). */
export function findFlatListEntry<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  cardId: number,
): E | undefined {
  return list.session.entries.find((e) => e.cardId === cardId)
}

/**
 * The shared edit-mode view of a flat-list session. Built per operation so the
 * fields a save reassigns (`editUndo`) are always read live; the snapshot is
 * the entry itself, since a flat entry is already a plain record.
 */
export function flatListModel<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
): EditModel<E, E> {
  const { session } = list
  return {
    filePath: session.filePath,
    editUndo: () => list.editUndo,
    originals: list.originals,
    art: session.art,
    apply: (change) => applyFlatListChange(session, change),
    markDirty: () => {
      session.dirty = true
    },
    sessionAdds: () => listFlatListSessionAdds(list),
    entries: () => session.entries,
    cardId: (entry) => entry.cardId,
    find: (cardId) => findFlatListEntry(list, cardId) ?? null,
    render: list.renderEntry,
    snapshot: (entry) => ({ ...entry }),
    onLastAddedReset: () => {
      list.state.snapshot = null
    },
  }
}

/** The list's current entries rendered for the edit-mode picker. */
export function listFlatListEntries<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
): EditableEntryItem[] {
  return listEditableEntries(flatListModel(list))
}

/** Apply an edit-mode field change to an existing entry (see {@link applyFieldEdit}). */
export function applyFlatListFieldEdit<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
  edit: FieldEdit<E>,
): void {
  applyFieldEdit(flatListModel(list), ctx, entry, cardId, edit)
}

/**
 * Remove an existing entry. A card added this session is discarded through the
 * session-add machinery (cancelling its add events and re-packing ids); a
 * pre-existing card releases its id and records a remove change, undoable for
 * as long as the released id has not been reused.
 */
export function performFlatListRemoval<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
): void {
  const sessionIdx = list.sessionAdds.indexOf(cardId)
  if (sessionIdx !== -1) {
    discardFlatListAdd(list, ctx, sessionIdx)
    return
  }

  const removed = { ...entry }
  const removeEvent = createRemoveChange(entry.name, { ...printingOptionsFrom(entry), cardId })
  applyFlatListChange(list.session, removeEvent)
  releaseId(list.session.pool, cardId)
  // The id is back in the pool, so the line's custom art has to leave with it —
  // written by the save, undone by the undo below.
  noteArtLineRemoved(list.session.art, cardId)

  // The removed entry's earlier edit events are moot, so they fold out of the
  // changelog (and come back if the removal is undone).
  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: false })
  ctx.sessionChanges = [...kept, removeEvent]

  list.editUndo.push({
    cardId,
    cardName: removed.name,
    kind: 'removal',
    label: t('cli.editLabel.removal', { name: removed.name }),
    inverse: restoreEntryInverse(removed, cardId),
    addedToChangelog: [removeEvent],
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(flatListModel(list), ctx, cardId)
  console.log(t('cli.edit.removedLine', { line: list.renderEntry(removed) }))
}

/**
 * The inverse changes that bring a removed or moved entry back: an add of the
 * full line — the language and label override ride the add itself, so undoing
 * restores them — plus its note, when it carried one.
 */
function restoreEntryInverse<E extends EditableFlatListEntry>(
  removed: E,
  cardId: number,
): ChangeEvent[] {
  const inverse: ChangeEvent[] = [
    createAddChange(removed.name, {
      ...printingOptionsFrom(removed),
      labels: removed.labels,
      cardId,
      section: removed.section,
    }),
  ]
  if (removed.note) {
    inverse.push(createSetNoteChange(removed.name, { note: removed.note, cardId }))
  }
  return inverse
}

/**
 * The interactive Move to Another List flow for a flat-list entry: pick the
 * destination (resolving a printing when a name-only card heads into a
 * collection), then record the move.
 */
export async function moveFlatListEntry<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
  deps: MoveDeps,
): Promise<void> {
  const dest = await resolveMoveDestination({
    deps,
    cardName: entry.name,
    hasPrinting: hasSpecificPrinting(entry),
  })
  if (!dest) return
  performFlatListMove(list, ctx, entry, cardId, dest)
}

/**
 * Move an existing entry to another list. The source side is recorded now — a
 * `move-from` change in the session changelog and a removal from the in-memory
 * model — and the destination side is derived from it when the list is saved
 * (`saveOpenList` in `edit-lists.ts`), exactly as an admin-editor save does.
 * Undoing the move before then restores the entry and no move ever happens.
 *
 * Like a removal, the entry's earlier field edits fold out of the changelog
 * (the move-from event carries the entry's final printing). Its add event, if
 * the card was added this session, deliberately stays: the changelog must
 * still balance (add + move out), and the destination really does receive a
 * card the session added. Such an entry just stops being individually
 * discardable as an add — the move's undo entry owns the line now.
 */
export function performFlatListMove<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
  dest: MoveDestination,
): void {
  const removed = { ...entry }
  const moveEvent = createMoveFromChange(
    removed.name,
    moveFromOptionsFor({ ...printingOptionsFrom(removed), cardId }, dest),
  )

  // The model removal targets the entry's own fields, not the move-from's —
  // a printing resolved for the destination must not stop the source line
  // (which never carried it) from matching.
  applyFlatListChange(
    list.session,
    createRemoveChange(removed.name, { ...printingOptionsFrom(removed), cardId }),
  )
  // The id is NOT released: the pending move-from still references it, and a
  // new add reusing it would tangle the two cards in every id-keyed session
  // filter (discards, re-packs). The pool forgets the reservation on the next
  // load; undo restores the entry under the still-reserved id.
  const sessionIdx = list.sessionAdds.indexOf(cardId)
  if (sessionIdx !== -1) list.sessionAdds.splice(sessionIdx, 1)
  // The card is leaving this list, so its art leaves too. The destination side
  // adopts it at save time, where the id it lands on is known.
  noteArtLineRemoved(list.session.art, cardId)

  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: true })
  ctx.sessionChanges = [...kept, moveEvent]

  list.editUndo.push({
    cardId,
    cardName: removed.name,
    kind: 'move',
    label: t('cli.editLabel.moveToList', {
      name: removed.name,
      list: listRefTitle(dest.target),
    }),
    inverse: restoreEntryInverse(removed, cardId),
    addedToChangelog: [moveEvent],
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(flatListModel(list), ctx, cardId)
  if (removed.note) console.log(t('cli.edit.moveNoteDropped', { name: removed.name }))
  console.log(
    t('cli.edit.movedToList', {
      line: list.renderEntry(removed),
      list: listRefTitle(dest.target),
    }),
  )
}

/** Label of the operation Undo Last Edit would revert, or null when the stack is empty. */
export function lastFlatListEditLabel<E extends FlatListEntry>(
  list: FlatListStrategyContext<E>,
): string | null {
  return lastEditLabel(list.editUndo)
}

/**
 * Undo the most recent edit-mode operation: apply its inverse changes to the
 * model and swap its changelog events back out. A removal's id is reclaimed when
 * still free; if a later add reused it, the restored entry gets a fresh id
 * instead (and the deeper history for the old id is retargeted to the new one).
 */
export function undoFlatListEdit<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
): void {
  undoFlatListEditAt(list, ctx, list.editUndo.length - 1)
}

/**
 * Undo the edit-mode operation at `index` into the undo stack, out of order.
 * Safe only while no newer operation touches the same card (the
 * {@link targetedUndoBlocker} guard) — inverses are absolute field restores and
 * changelog footprints only overlap between same-card operations, so removing a
 * conflict-free entry from the middle of the stack leaves the rest replayable.
 */
export function undoFlatListEditAt<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  index: number,
): void {
  const undo = list.editUndo[index]
  if (!undo) return
  const blocked = targetedUndoBlocker(list.editUndo, index)
  if (blocked) {
    console.log(t('cli.edit.cannotDiscardYet', { label: undo.label, reason: blocked }))
    return
  }
  list.editUndo.splice(index, 1)

  if (undo.reclaimId !== undefined) {
    if (findFlatListEntry(list, undo.reclaimId) !== undefined) {
      // Another entry owns the id now (a removal's released id was reused), so
      // the restored entry takes a fresh one and its deeper history follows.
      // The art stays dropped: its old id belongs to a different card.
      retargetUndoCardId([undo, ...list.editUndo], undo.reclaimId, allocateId(list.session.pool))
    } else {
      // A free id is claimed back; an id that is merely still reserved — a
      // pending move keeps its id in the pool — needs nothing, the inverse add
      // below restores the entry under it. Either way the entry returns under
      // its own id, so its custom art returns with it.
      if (!list.session.pool.usedIds.has(undo.reclaimId)) {
        claimId(list.session.pool, undo.reclaimId)
      }
      noteArtLineRestored(list.session.art, undo.reclaimId)
    }
  }

  // An art edit's only effect is on the sidecar, so its undo is a re-stage.
  if (undo.restoreArt) noteArtSet(list.session.art, undo.cardId, undo.restoreArt.ref)

  for (const change of undo.inverse) {
    applyFlatListChange(list.session, change)
  }

  swapUndoChangelog(ctx, undo)
  resetStaleLastAdded(flatListModel(list), ctx, undo.cardId)
  console.log(t('cli.edit.undid', { label: undo.label }))
}

/**
 * Every change made this session — adds, field edits, and removals — for the
 * View Session Changes picker. Indices feed {@link discardFlatListSessionChange}.
 */
export function listFlatListSessionChanges<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
): SessionChangeItem[] {
  return listSessionChanges(flatListModel(list))
}

/**
 * Discard the session change at `index` (into {@link listFlatListSessionChanges}):
 * an add is discarded through the session-add machinery, anything else through a
 * targeted undo of its edit-mode operation.
 */
export function discardFlatListSessionChange<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  index: number,
): void {
  discardSessionChangeAt(
    list.sessionAdds.length,
    index,
    (i) => discardFlatListAdd(list, ctx, i),
    (i) => undoFlatListEditAt(list, ctx, i),
  )
}

/** Re-render an entry after an edit (apply replaces entry objects). */
export function logFlatListUpdated<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  cardId: number,
  fallbackName: string,
): void {
  logUpdatedLine(flatListModel(list), cardId, fallbackName)
}

/** The strategy members the collection and wanted strategies delegate here unchanged. */
export type FlatListDelegates = Pick<
  CardSessionStrategy,
  | 'applyChange'
  | 'receiveMove'
  | 'persist'
  | 'hasUnsavedChanges'
  | 'sessionSaved'
  | 'noteAdded'
  | 'addAnotherCopy'
  | 'listSessionAdds'
  | 'discardSessionAdd'
  | 'listSessionChanges'
  | 'discardSessionChange'
  | 'editSessionChange'
  | 'editEntryLanguage'
  | 'listEntries'
  | 'lastEditUndoLabel'
  | 'undoLastEdit'
>

/**
 * The strategy members that are pure delegation to the shared flat-list
 * session and edit engines, spread into each flat-list strategy literal.
 */
export function flatListDelegates<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  editEntry: CardSessionStrategy['editEntry'],
): FlatListDelegates {
  const { session, state } = list
  return {
    applyChange: (change: ChangeEvent) => applyFlatListChange(session, change),
    receiveMove: (change, art) => receiveFlatListMove(session, change, art),
    persist: () => persistFlatListSession(session),
    hasUnsavedChanges: () => session.dirty,
    sessionSaved: () => resetFlatListSessionTracking(list),
    noteAdded: (note: string): void => {
      if (state.snapshot) state.snapshot.note = note
    },
    addAnotherCopy: (ctx: CardSessionContext) => addAnotherFlatListCopy(list, ctx),
    listSessionAdds: () => listFlatListSessionAdds(list),
    discardSessionAdd: async (ctx: CardSessionContext, index: number) => {
      discardFlatListAdd(list, ctx, index)
    },
    listSessionChanges: () => listFlatListSessionChanges(list),
    discardSessionChange: async (ctx: CardSessionContext, index: number) =>
      discardFlatListSessionChange(list, ctx, index),
    editSessionChange: (ctx: CardSessionContext, index: number, action: SessionChangeEditAction) =>
      editSessionChangeAt(flatListModel(list), ctx, index, action, (cardId) =>
        editEntry(ctx, cardId),
      ),
    editEntryLanguage: (ctx: CardSessionContext, cardId: number) =>
      editLanguageById(flatListModel(list), ctx, cardId),
    listEntries: () => listFlatListEntries(list),
    lastEditUndoLabel: () => lastFlatListEditLabel(list),
    undoLastEdit: async (ctx: CardSessionContext) => undoFlatListEdit(list, ctx),
  }
}

/** What the shared edit actions need from the strategy that owns the list. */
export type FlatListEditEnv = {
  sessionConfig: PrintingFilterConfig
  excludeDigitalOnly: boolean
  moveTargets?: MoveTargetsProvider
}

/**
 * The edit-action menu rows every flat list offers, in menu order — the rows
 * whose values {@link editSharedFlatListAction} handles. `afterLanguage` slots a
 * strategy's own rows between the language and art rows (the collection's label
 * row lives there). The double-space icon on Remove is deliberate: that emoji
 * carries a variation selector and renders narrower, so the extra space keeps
 * the labels aligned.
 */
export function sharedFlatListEditActions(
  env: Pick<FlatListEditEnv, 'moveTargets'>,
  afterLanguage: EditActionChoice[] = [],
): EditActionChoice[] {
  return [
    { title: `🌐 ${t('cli.editAction.changeLanguage')}`, value: 'language' },
    ...afterLanguage,
    { title: `🎨 ${t('cli.editAction.setArt')}`, value: 'art' },
    ...(env.moveTargets
      ? [{ title: `📤 ${t('cli.editAction.moveToList')}`, value: 'move-list' }]
      : []),
    { title: `📝 ${t('cli.editAction.editNote')}`, value: 'note' },
    { title: `🗑️  ${t('cli.editAction.remove')}`, value: 'remove' },
  ]
}

/**
 * Run one of the edit actions whose flow is identical for collection and
 * wanted entries (language, custom art, move to another list, note, remove).
 * Returns false when `action` is not one of them, so the strategy's own
 * branches (printing/finish/condition/label) run first and hand the rest here.
 */
export async function editSharedFlatListAction<E extends EditableFlatListEntry>(
  action: string,
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
  env: FlatListEditEnv,
): Promise<boolean> {
  const model = flatListModel(list)
  if (action === 'language') {
    await editLanguage(model, ctx, entry, cardId)
    return true
  }

  if (action === 'art') {
    await editArt(model, entry, cardId)
    return true
  }

  if (action === 'move-list' && env.moveTargets) {
    await moveFlatListEntry(list, ctx, entry, cardId, {
      targets: env.moveTargets,
      selfFile: list.session.filePath,
      sessionConfig: env.sessionConfig,
      excludeDigitalOnly: env.excludeDigitalOnly,
    })
    return true
  }

  if (action === 'note') {
    await editNote(model, ctx, entry, cardId)
    return true
  }

  if (action === 'remove') {
    if (await confirmRemoval(model, entry)) performFlatListRemoval(list, ctx, entry, cardId)
    return true
  }

  return false
}
