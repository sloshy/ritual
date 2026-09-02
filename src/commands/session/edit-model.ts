import { ask } from '../../cli/prompts'
import { t } from '../../i18n/t'
import {
  consolidateSetLanguage,
  consolidateSetNote,
  createSetLanguageChange,
  createSetNoteChange,
  resolvedPrintingOptionsFrom,
  type ChangeEvent,
  type ConsolidateResult,
  type PrintingTuple,
  type PrintingTupleWithId,
} from '../../changes/change-event'
import { displayLanguage, type CardLanguage } from '../../card/card-language'
import type { SessionArtChanges } from './art'
import { editCardArt } from './edit-art'
import {
  changelogDelta,
  listSessionChangeItems,
  sessionChangeCardId,
  type EditUndoEntry,
} from './edit-undo'
import { promptLanguageChoice, promptNoteEdit } from './prompts'
import type {
  CardSessionContext,
  EditableEntryItem,
  SessionAddItem,
  SessionChangeEditAction,
  SessionChangeItem,
} from './strategy'

/**
 * The seam between the edit-mode operations that read the same for every list
 * type and the two in-memory models they run over: the deck (lines with
 * quantities, located inside sections) and the flat lists (one entry per copy,
 * with an explicit id pool). `deck-edit.ts` and `flat-list-edit.ts` each build
 * an {@link EditModel} over their own state and keep only what genuinely
 * differs — copy semantics, id reclaim on undo, and the move/removal middles.
 *
 * `Located` is what a lookup by card id yields (a deck card with its section;
 * a flat entry), and `Snapshot` is the session-start record consolidation
 * compares against (a purpose-built deck snapshot; the flat entry itself).
 */

/** The fields every session-start snapshot carries, which the shared edits read. */
export type EditSnapshot = {
  name: string
  note?: string
  /** The line's `[ja]`-style language token at session start. Absent means `en`. */
  language?: CardLanguage
}

/** A list type's in-memory model as the shared edit-mode operations see it. */
export type EditModel<Located, Snapshot extends EditSnapshot> = {
  /** The list file the session writes, and whose `.art.json` sidecar it owns. */
  filePath: string
  /**
   * Linear undo stack for edit-mode operations, oldest first. Read live on
   * every use: a session reassigns the array when it resets its tracking.
   */
  editUndo: () => EditUndoEntry[]
  /**
   * Session-start snapshots of cards touched in edit mode, keyed by card id.
   * Sessions reset this map in place (`clear()`), never by reassignment.
   */
  originals: Map<number, Snapshot>
  /** Pending custom-art edits, applied by the same save that writes the list. Never reassigned. */
  art: SessionArtChanges
  /** Apply a change to the in-memory model and mark the session unsaved. */
  apply: (change: ChangeEvent) => void
  /** Mark the session unsaved without a change (an art edit touches only the sidecar). */
  markDirty: () => void
  /**
   * The cards added this session, in add order — the rows the session-changes
   * screen lists ahead of the edit-mode operations. Read live, like
   * {@link EditModel.editUndo}: a save resets the underlying list.
   */
  sessionAdds: () => SessionAddItem[]
  /** Every line of the list, in file order. */
  entries: () => Located[]
  cardId: (located: Located) => number | undefined
  find: (cardId: number) => Located | null
  /** Render a line for the edit-mode picker and the post-edit echo. */
  render: (located: Located) => string
  snapshot: (located: Located) => Snapshot
  /**
   * Called when an edit invalidated the add-mode shortcuts (the "last added"
   * card was edited or removed), for any last-add state the model keeps of its own.
   */
  onLastAddedReset?: () => void
}

/**
 * The printing tuple of a line, for consolidation comparisons and inverses.
 * The language is resolved explicitly (`en` for a bare line): a set-printing
 * built from this tuple must *restore* the line's language — an absent
 * language on a set-printing means "leave the token alone", which would let an
 * undo keep a language the forward edit had changed.
 */
export function printingTupleOf(entry: PrintingTupleWithId): PrintingTuple {
  const { cardId: _cardId, ...printing } = resolvedPrintingOptionsFrom(entry)
  return printing
}

/** The list's current lines rendered for the edit-mode picker, in file order. */
export function listEditableEntries<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
): EditableEntryItem[] {
  const items: EditableEntryItem[] = []
  for (const located of model.entries()) {
    const cardId = model.cardId(located)
    if (cardId === undefined) continue
    items.push({ label: model.render(located), cardId })
  }
  return items
}

/**
 * The session-start snapshot of a line, captured on first touch. A snapshot
 * whose name no longer matches the live line is stale (its id was freed and
 * reused by a different card), so it is replaced rather than trusted.
 */
function originalSnapshot<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  located: L,
  cardId: number,
): S {
  const current = model.snapshot(located)
  const existing = model.originals.get(cardId)
  if (existing && existing.name === current.name) return existing
  model.originals.set(cardId, current)
  return current
}

/**
 * Editing or removing the "last added" card invalidates the add-mode shortcuts
 * (Add Exact Copy would resurrect the pre-edit line), so they reset until the
 * next add.
 */
export function resetStaleLastAdded<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  cardId: number,
): void {
  if (ctx.lastAdded?.cardId !== cardId) return
  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
  model.onLastAddedReset?.()
}

/** One edit-mode field change: the model change, its inverse, and its changelog consolidation. */
export type FieldEdit<Snapshot> = {
  /** Short description for messages and the Undo menu item, e.g. `printing on Sol Ring`. */
  label: string
  /** The change applied to the in-memory model now. */
  change: ChangeEvent
  /** The change that restores the line's pre-edit state. */
  inverse: ChangeEvent
  /** Consolidate the session changelog against the session-start snapshot. */
  consolidate: (changes: ChangeEvent[], original: Snapshot) => ConsolidateResult
}

/**
 * Apply an edit-mode field change to an existing line: mutate the model, fold
 * the event into the session changelog with "latest wins" semantics (a line
 * restored to its session-start state drops out of the changelog entirely), and
 * push an undo entry.
 */
export function applyFieldEdit<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  located: L,
  cardId: number,
  edit: FieldEdit<S>,
): void {
  const original = originalSnapshot(model, located, cardId)
  model.apply(edit.change)
  const result = edit.consolidate(ctx.sessionChanges, original)
  ctx.sessionChanges = result.changes
  model.editUndo().push({
    cardId,
    cardName: original.name,
    kind: 'edit',
    label: edit.label,
    inverse: [edit.inverse],
    ...changelogDelta(result),
  })
  resetStaleLastAdded(model, ctx, cardId)
}

/** Re-render a line after an edit (apply replaces the line objects). */
export function logUpdatedLine<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  cardId: number,
  fallbackName: string,
): void {
  const updated = model.find(cardId)
  console.log(t('cli.edit.changedLine', { line: updated ? model.render(updated) : fallbackName }))
}

/** Prompt for and apply a note edit on an existing line (empty input clears the note). */
export async function editNote<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  located: L,
  cardId: number,
): Promise<void> {
  const { name, note } = model.snapshot(located)
  const edit = await promptNoteEdit(note)
  if (!edit) return
  applyFieldEdit(model, ctx, located, cardId, {
    label: t('cli.editLabel.note', { name }),
    change: createSetNoteChange(name, { note: edit.note, cardId }),
    inverse: createSetNoteChange(name, { note: edit.before, cardId }),
    consolidate: (changes, original) =>
      consolidateSetNote(changes, name, edit.note, original.note ?? '', cardId),
  })
  console.log(edit.note ? t('cli.edit.noteSet', { name }) : t('cli.edit.noteCleared', { name }))
}

/** Prompt for and apply a language change on an existing line. */
export async function editLanguage<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  located: L,
  cardId: number,
): Promise<void> {
  const { name, language: current } = model.snapshot(located)
  const language = await promptLanguageChoice(current)
  if (language === null || language === displayLanguage(current)) return
  applyFieldEdit(model, ctx, located, cardId, {
    label: t('cli.editLabel.language', { name }),
    change: createSetLanguageChange(name, { language, cardId }),
    inverse: createSetLanguageChange(name, { language: displayLanguage(current), cardId }),
    consolidate: (changes, original) =>
      consolidateSetLanguage(changes, name, language, original.language, cardId),
  })
  logUpdatedLine(model, cardId, name)
}

/** Run the list type's own per-entry action menu for `cardId` — its rows differ per type. */
export type SessionChangeEditEntry = (cardId: number) => Promise<void>

/**
 * Whether `cardId` still names the card called `name`. An id is not an identity
 * on its own: a removal releases its `&N` and a later add takes it back, so the
 * session-changes screen compares the name too before offering to edit a row.
 */
function sameCardIn<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  cardId: number,
  name: string,
): boolean {
  const located = model.find(cardId)
  return located !== null && model.snapshot(located).name === name
}

/**
 * Every change made this session — adds, field edits, removals and moves — for
 * the View Session Changes screen. Indices feed {@link discardSessionChangeAt}
 * and {@link editSessionChangeAt}, which walk the same concatenation.
 */
export function listSessionChanges<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
): SessionChangeItem[] {
  return listSessionChangeItems(model.sessionAdds(), model.editUndo(), (cardId, name) =>
    sameCardIn(model, cardId, name),
  )
}

/**
 * Run one {@link SessionChangeEditAction} against the card the session change at
 * `index` targets: the language picker directly, or the list type's own
 * per-entry action menu. The id is re-resolved rather than trusted, so a row
 * whose line went away between the listing and the choice does nothing.
 */
export async function editSessionChangeAt<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  index: number,
  action: SessionChangeEditAction,
  editEntry: SessionChangeEditEntry,
): Promise<void> {
  const cardId = sessionChangeCardId(model.sessionAdds(), model.editUndo(), index)
  if (cardId === undefined || model.find(cardId) === null) return
  switch (action) {
    case 'details':
      await editEntry(cardId)
      return
    case 'language':
      await editLanguageById(model, ctx, cardId)
      return
    default: {
      const unhandled: never = action
      throw new Error(`Unhandled session change action: ${String(unhandled)}`)
    }
  }
}

/**
 * Prompt for and apply a language change on the line with `cardId`, skipping the
 * per-entry action menu. Drives the `🌐 Change Language` add-mode shortcut and
 * the session-changes review screen; a stale id is a no-op.
 */
export async function editLanguageById<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  ctx: CardSessionContext,
  cardId: number,
): Promise<void> {
  const located = model.find(cardId)
  if (!located) return
  await editLanguage(model, ctx, located, cardId)
}

/**
 * Run the Set Custom Art action on an existing line. Deferred like every other
 * session edit: the `.art.json` sidecar is written by the save that writes the
 * list, so the session is only marked dirty here.
 */
export function editArt<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  located: L,
  cardId: number,
): Promise<void> {
  return editCardArt({
    filePath: model.filePath,
    cardId,
    cardName: model.snapshot(located).name,
    art: model.art,
    editUndo: model.editUndo(),
    markDirty: model.markDirty,
  })
}

/** The confirmation gate in front of a full-line removal. */
export async function confirmRemoval<L, S extends EditSnapshot>(
  model: EditModel<L, S>,
  located: L,
): Promise<boolean> {
  const confirmed = await ask<boolean>({
    type: 'confirm',
    message: t('cli.edit.confirmRemove', { line: model.render(located) }),
    subjectKey: 'cli.prompt.subject.removeConfirm',
    initial: false,
  })
  return confirmed === true
}

/** Label of the operation Undo Last Edit would revert, or null when the stack is empty. */
export function lastEditLabel(editUndo: EditUndoEntry[]): string | null {
  return editUndo[editUndo.length - 1]?.label ?? null
}

/**
 * Discard the session change at `index` into the View Session Changes list,
 * whose first `addCount` rows are the session adds: an add is discarded through
 * the session-add machinery, anything else through a targeted undo of its
 * edit-mode operation. Returns whether a session add was discarded (the deck
 * strategy resets its last-added shortcuts in that case).
 */
export function discardSessionChangeAt(
  addCount: number,
  index: number,
  discardAdd: (index: number) => boolean,
  undoEditAt: (index: number) => void,
): boolean {
  if (index < addCount) return discardAdd(index)
  undoEditAt(index - addCount)
  return false
}
