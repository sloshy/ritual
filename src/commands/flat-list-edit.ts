import prompts from 'prompts'
import {
  consolidateSetNote,
  createAddChange,
  createRemoveChange,
  createSetNoteChange,
  type ChangeEvent,
  type ConsolidateResult,
  type PrintingTuple,
} from '../change-event'
import type { Condition, Finish } from '../types'
import type { CardLabel } from '../card-labels'
import { displayLanguage, type CardLanguage } from '../card-language'
import { allocateId, claimId, releaseId } from '../card-id'
import { t } from '../i18n/t'
import {
  promptNoteEdit,
  type CardSessionContext,
  type EditableEntryItem,
  type SessionChangeItem,
} from './card-session'
import {
  changelogDelta,
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
  const removeEvent = createRemoveChange(entry.name, {
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition: entry.condition,
    language: entry.language,
    cardId,
  })
  applyFlatListChange(list.session, removeEvent)
  releaseId(list.session.pool, cardId)

  // The removed entry's earlier edit events are moot, so they fold out of the
  // changelog (and come back if the removal is undone).
  const displaced = ctx.sessionChanges.filter((c) => 'cardId' in c && c.cardId === cardId)
  ctx.sessionChanges = [
    ...ctx.sessionChanges.filter((c) => !('cardId' in c) || c.cardId !== cardId),
    removeEvent,
  ]

  const inverse: ChangeEvent[] = [
    createAddChange(removed.name, {
      set: removed.set,
      collectorNumber: removed.collectorNumber,
      finish: removed.finish,
      condition: removed.condition,
      // The language and label override ride the add itself, so undoing a
      // removal restores them.
      language: removed.language,
      labels: removed.labels,
      cardId,
      section: removed.section,
    }),
  ]
  if (removed.note) {
    inverse.push(createSetNoteChange(removed.name, { note: removed.note, cardId }))
  }
  list.editUndo.push({
    cardId,
    kind: 'removal',
    label: t('cli.editLabel.removal', { name: removed.name }),
    inverse,
    addedToChangelog: [removeEvent],
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(list, ctx, cardId)
  console.log(t('cli.edit.removedLine', { line: list.renderEntry(removed) }))
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
    if (!list.session.pool.usedIds.has(undo.reclaimId)) {
      claimId(list.session.pool, undo.reclaimId)
    } else {
      retargetUndoCardId([undo, ...list.editUndo], undo.reclaimId, allocateId(list.session.pool))
    }
  }

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
