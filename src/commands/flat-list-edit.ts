import prompts from 'prompts'
import {
  consolidateSetNote,
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetNoteChange,
  printingOptionsFrom,
  type ChangeEvent,
  type ConsolidateResult,
  type PrintingTuple,
} from '../changes/change-event'
import type { Condition, Finish } from '../card/finish-condition'
import type { CardLabel } from '../card/card-labels'
import { displayLanguage, type CardLanguage } from '../card/card-language'
import { allocateId, claimId, releaseId } from '../card/card-id'
import { t } from '../i18n/t'
import {
  promptNoteEdit,
  type CardSessionContext,
  type EditableEntryItem,
  type SessionChangeItem,
} from './card-session'
import {
  changelogDelta,
  foldOutCardChanges,
  listSessionChangeItems,
  retargetUndoCardId,
  swapUndoChangelog,
  targetedUndoBlocker,
} from './edit-undo'
import {
  applyFlatListChange,
  discardFlatListAdd,
  listFlatListSessionAdds,
  type FlatListEntry,
  type FlatListStrategyContext,
} from './flat-list-session'
import {
  listRefTitle,
  moveFromOptionsFor,
  resolveMoveDestination,
  type MoveDeps,
  type MoveDestination,
} from './edit-move'
import { noteArtLineRemoved, noteArtLineRestored, noteArtSet } from './session-art'
import { editCardArt } from './edit-art'
import { hasSpecificPrinting } from '../card/card-printing'

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

/**
 * The printing tuple of an entry, for consolidation comparisons and inverses.
 * The language is always resolved explicitly (`en` for a bare line): a
 * set-printing built from this tuple must *restore* the entry's language —
 * an absent language on a set-printing means "leave the token alone", which
 * would let an undo keep a language the forward edit had changed.
 */
export function entryPrinting(entry: EditableFlatListEntry): PrintingTuple {
  return {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition: entry.condition,
    language: displayLanguage(entry.language),
  }
}

/** The list's current entries rendered for the edit-mode picker. */
export function listFlatListEntries<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
): EditableEntryItem[] {
  const items: EditableEntryItem[] = []
  for (const entry of list.session.entries) {
    if (entry.cardId === undefined) continue
    items.push({ label: list.renderEntry(entry), cardId: entry.cardId })
  }
  return items
}

/** Find an entry by card id (entries always carry ids after session load). */
export function findFlatListEntry<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  cardId: number,
): E | undefined {
  return list.session.entries.find((e) => e.cardId === cardId)
}

/**
 * The session-start snapshot of an entry, captured on first touch. A snapshot
 * whose name no longer matches the live entry is stale (its id was released and
 * reused by a different card), so it is replaced rather than trusted.
 */
function originalSnapshot<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  entry: E,
  cardId: number,
): E {
  const existing = list.originals.get(cardId)
  if (existing && existing.name === entry.name) return existing
  const snapshot = { ...entry }
  list.originals.set(cardId, snapshot)
  return snapshot
}

/**
 * Editing or removing the "last added" card invalidates the add-mode shortcuts
 * (Add Exact Copy would resurrect the pre-edit line), so they reset until the
 * next add.
 */
function resetStaleLastAdded<E extends FlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  cardId: number,
): void {
  if (ctx.lastAdded?.cardId !== cardId) return
  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
  list.state.snapshot = null
}

/** One edit-mode field change: the model change, its inverse, and its changelog consolidation. */
export type FlatListFieldEdit<E extends EditableFlatListEntry> = {
  /** Short description for messages and the Undo menu item, e.g. `printing on Sol Ring`. */
  label: string
  /** The change applied to the in-memory entries now. */
  change: ChangeEvent
  /** The change that restores the entry's pre-edit state. */
  inverse: ChangeEvent
  /** Consolidate the session changelog against the session-start snapshot. */
  consolidate: (changes: ChangeEvent[], original: E) => ConsolidateResult
}

/**
 * Apply an edit-mode field change to an existing entry: mutate the model, fold
 * the event into the session changelog with "latest wins" semantics (an entry
 * restored to its session-start state drops out of the changelog entirely), and
 * push an undo entry.
 */
export function applyFlatListFieldEdit<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
  edit: FlatListFieldEdit<E>,
): void {
  const original = originalSnapshot(list, entry, cardId)
  applyFlatListChange(list.session, edit.change)
  const result = edit.consolidate(ctx.sessionChanges, original)
  ctx.sessionChanges = result.changes
  list.editUndo.push({
    cardId,
    kind: 'edit',
    label: edit.label,
    inverse: [edit.inverse],
    ...changelogDelta(result),
  })
  resetStaleLastAdded(list, ctx, cardId)
}

/** Prompt for and apply a note edit on an existing entry (empty input clears the note). */
export async function editFlatListNote<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
): Promise<void> {
  const edit = await promptNoteEdit(entry.note)
  if (!edit) return
  applyFlatListFieldEdit(list, ctx, entry, cardId, {
    label: t('cli.editLabel.note', { name: entry.name }),
    change: createSetNoteChange(entry.name, { note: edit.note, cardId }),
    inverse: createSetNoteChange(entry.name, { note: edit.before, cardId }),
    consolidate: (changes, original) =>
      consolidateSetNote(changes, entry.name, edit.note, original.note ?? '', cardId),
  })
  console.log(
    edit.note
      ? t('cli.edit.noteSet', { name: entry.name })
      : t('cli.edit.noteCleared', { name: entry.name }),
  )
}

/**
 * Run the Set Custom Art action on an existing entry. Deferred like every other
 * session edit: the `.art.json` sidecar is written by the save that writes the
 * entries, so the session is only marked dirty here.
 */
export async function editFlatListArt<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  entry: E,
  cardId: number,
): Promise<void> {
  await editCardArt({
    filePath: list.session.filePath,
    cardId,
    cardName: entry.name,
    art: list.session.art,
    editUndo: list.editUndo,
    markDirty: () => {
      list.session.dirty = true
    },
  })
}

type ConfirmPromptResponse = { confirm?: boolean }

/** Confirmation gate in front of {@link performFlatListRemoval}. */
export async function removeFlatListEntry<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
  ctx: CardSessionContext,
  entry: E,
  cardId: number,
): Promise<void> {
  const confirmResponse = (await prompts({
    type: 'confirm',
    name: 'confirm',
    message: t('cli.edit.confirmRemove', { line: list.renderEntry(entry) }),
    initial: false,
  })) as ConfirmPromptResponse
  if (!confirmResponse.confirm) return
  performFlatListRemoval(list, ctx, entry, cardId)
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
    kind: 'removal',
    label: t('cli.editLabel.removal', { name: removed.name }),
    inverse: restoreEntryInverse(removed, cardId),
    addedToChangelog: [removeEvent],
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(list, ctx, cardId)
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
  resetStaleLastAdded(list, ctx, cardId)
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
  return list.editUndo[list.editUndo.length - 1]?.label ?? null
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
  resetStaleLastAdded(list, ctx, undo.cardId)
  console.log(t('cli.edit.undid', { label: undo.label }))
}

/**
 * Every change made this session — adds, field edits, and removals — for the
 * View Session Changes picker. Indices feed {@link discardFlatListSessionChange}.
 */
export function listFlatListSessionChanges<E extends EditableFlatListEntry>(
  list: FlatListStrategyContext<E>,
): SessionChangeItem[] {
  return listSessionChangeItems(listFlatListSessionAdds(list), list.editUndo)
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
  const addCount = list.sessionAdds.length
  if (index < addCount) {
    discardFlatListAdd(list, ctx, index)
    return
  }
  undoFlatListEditAt(list, ctx, index - addCount)
}
