import type { Card } from '../../card/card'
import type { DeckData } from '../../list/deck'
import {
  consolidateSetLabel,
  consolidateSetPrinting,
  consolidateSetSection,
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetLabelChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  formatPrintingAnnotation,
  type AddRemoveOptions,
  type ChangeEvent,
  type PrintingTuple,
} from '../../changes/change-event'
import {
  listRefTitle,
  moveFromOptionsFor,
  resolveMoveDestination,
  type MoveDeps,
  type MoveDestination,
} from './edit-move'
import { sameCardLabels, type CardLabel } from '../../card/card-labels'
import {
  noteArtLineRemoved,
  noteArtLineRestored,
  noteArtRepack,
  noteArtSet,
  type SessionArtChanges,
} from './art'
import { displayLanguage } from '../../card/card-language'
import { t } from '../../i18n/t'
import {
  allocateId,
  assignMissingDeckCardIds,
  collectDeckCardIds,
  createIdPool,
} from '../../card/card-id'
import { applyChangeToDeck } from '../../changes/deck-changes'
import { normalizeBoard } from '../../deck-sync/diff'
import { findCardById, type DeckCardLocation } from '../../list/deck-io'
import { discardDeckCopy, renderDeckCopyRecord, type DeckCopyRecord } from './deck-discard'
import { promptMoveSection } from './deck-prompts'
import {
  promptEditAction,
  promptCardLabelChoice,
  promptFinishAndCondition,
  resolveCardPrinting,
  type FinishConditionConfig,
  type PrintingFilterConfig,
} from './prompts'
import type {
  CardSessionContext,
  EditableEntryItem,
  SessionAddItem,
  SessionChangeEditAction,
  SessionChangeItem,
} from './strategy'
import {
  foldOutCardChanges,
  retargetUndoCardId,
  swapUndoChangelog,
  targetedUndoBlocker,
  type EditUndoEntry,
} from './edit-undo'
import {
  applyFieldEdit,
  confirmRemoval,
  discardSessionChangeAt,
  editArt,
  editLanguage,
  editLanguageById,
  editNote,
  editTags,
  lastEditLabel,
  editSessionChangeAt,
  listEditableEntries,
  listSessionChanges,
  logUpdatedLine,
  printingTupleOf,
  resetStaleLastAdded,
  type EditModel,
  type EditSnapshot,
  type FieldEdit,
} from './edit-model'
import { hasSpecificPrinting } from '../../card/card-printing'

/**
 * Edit-mode operations for the deck session: changing a line's printing,
 * adding/removing copies, moving between sections, note edits, and full-line
 * removal — all applied to the in-memory deck and undoable via a linear stack.
 * Mirrors `flat-list-edit.ts` for the flat list types; decks differ in carrying
 * quantities per line and in assigning card ids without an explicit pool.
 */

/** Session-start snapshot of a deck card touched in edit mode. */
export type DeckCardSnapshot = EditSnapshot & {
  printing: PrintingTuple
  /** The line's `[proxy]` label override at session start; absent means the deck default. */
  labels?: CardLabel[]
  section: string
}

/** The mutable deck-session state shared by the strategy and the edit operations. */
export type DeckSessionState = {
  /** The deck file the session writes, and whose sidecars belong to it. */
  filePath: string
  /** The in-memory deck — the single source of truth until persisted. */
  deck: DeckData
  /** Per-copy adds this session, in add order (drives the discard menu). */
  sessionAdds: DeckCopyRecord[]
  /** Distinct line ids first created this session, for re-pack on full removal. */
  sessionLineIds: number[]
  /**
   * Ids of lines with a pending (unsaved) move to another list. Reserved so a
   * new line cannot take an id the pending move-from events still reference;
   * cleared when the move is undone or the session's tracking resets.
   */
  pendingMoveIds: number[]
  /** Linear undo stack for edit-mode operations, oldest first. */
  editUndo: EditUndoEntry[]
  /** Session-start snapshots of cards touched in edit mode, keyed by card id. */
  originals: Map<number, DeckCardSnapshot>
  /** Whether the in-memory deck differs from what was last written to disk. */
  dirty: boolean
  /**
   * Pending `<deck>.art.json` edits, applied by the same save that writes the
   * deck — the sidecar is keyed by `&N`, and a removed line's id is handed to
   * the next line the session creates.
   */
  art: SessionArtChanges
}

/**
 * Apply a change to the in-memory deck. IDs are assigned to the in-memory copy
 * too (not just on serialize) so subsequent edits resolve cards by ID.
 */
export function applyDeckChange(state: DeckSessionState, change: ChangeEvent): void {
  state.deck = assignMissingDeckCardIds(applyChangeToDeck(state.deck, change), state.pendingMoveIds)
  state.dirty = true
}

/** Render a deck line for the edit-mode picker, e.g. `2 Sol Ring (C19:221) [foil] — Main &5`. */
export function renderDeckCardLine(card: Card, sectionName: string): string {
  return `${card.quantity} ${card.name}${formatPrintingAnnotation(card)} — ${sectionName} &${card.cardId}`
}

/** The deck session as the shared edit-mode operations see it. */
type DeckEditModel = EditModel<DeckCardLocation, DeckCardSnapshot>

/**
 * The shared edit-mode view of a deck session. Built per operation so the
 * fields the session reassigns (`deck`, `editUndo`) are always read live.
 */
function deckModel(state: DeckSessionState): DeckEditModel {
  return {
    filePath: state.filePath,
    editUndo: () => state.editUndo,
    originals: state.originals,
    art: state.art,
    apply: (change) => applyDeckChange(state, change),
    markDirty: () => {
      state.dirty = true
    },
    sessionAdds: () => listDeckSessionAdds(state),
    entries: () =>
      state.deck.sections.flatMap((section) => section.cards.map((card) => ({ section, card }))),
    cardId: ({ card }) => card.cardId,
    find: (cardId) => findCardById(state.deck, cardId),
    render: ({ card, section }) => renderDeckCardLine(card, section.name),
    snapshot: ({ card, section }) => ({
      name: card.name,
      printing: printingTupleOf(card),
      language: card.language,
      labels: card.labels,
      tags: card.tags,
      note: card.note,
      section: section.name,
    }),
  }
}

/** The deck's current lines rendered for the edit-mode picker, in file order. */
export function listDeckEntries(state: DeckSessionState): EditableEntryItem[] {
  return listEditableEntries(deckModel(state))
}

/** The add that puts one copy of a line back into `sectionName`, or first adds it there. */
function deckAddOptions(
  printing: PrintingTuple,
  cardId: number,
  sectionName: string,
): AddRemoveOptions {
  return { ...printing, cardId, section: sectionName, board: normalizeBoard(sectionName) }
}

/** The remove that takes one copy of a line out of `sectionName`. */
function deckRemoveOptions(
  printing: PrintingTuple,
  cardId: number,
  sectionName: string,
): AddRemoveOptions {
  return { ...printing, cardId, board: normalizeBoard(sectionName) }
}

/**
 * The inverse changes that bring `quantity` removed (or moved) copies of a line
 * back: an add per copy — carrying the line's label override and tags, which
 * ride the add itself so the restored line is the line that left — plus its
 * note when it carried one.
 */
function restoreLineInverse(
  snapshot: Card,
  printing: PrintingTuple,
  sectionName: string,
  cardId: number,
  quantity: number,
): ChangeEvent[] {
  const inverse: ChangeEvent[] = []
  for (let i = 0; i < quantity; i++) {
    inverse.push(
      createAddChange(snapshot.name, {
        ...deckAddOptions(printing, cardId, sectionName),
        labels: snapshot.labels,
        tags: snapshot.tags,
      }),
    )
  }
  if (snapshot.note) {
    inverse.push(createSetNoteChange(snapshot.name, { note: snapshot.note, cardId }))
  }
  return inverse
}

/**
 * Run a session-add discard through the shared machinery and fold the outcome
 * back into the session state. Returns false when the index was out of range.
 */
export function discardDeckSessionAdd(
  state: DeckSessionState,
  ctx: CardSessionContext,
  index: number,
): boolean {
  const outcome = discardDeckCopy(
    {
      deck: state.deck,
      sessionChanges: ctx.sessionChanges,
      sessionAdds: state.sessionAdds,
      sessionLineIds: state.sessionLineIds,
    },
    index,
  )
  if (!outcome) return false
  state.deck = outcome.deck
  ctx.sessionChanges = outcome.sessionChanges
  state.sessionAdds = outcome.sessionAdds
  state.sessionLineIds = outcome.sessionLineIds
  state.dirty = true
  // Pending custom art is keyed by the same line ids: a discarded line's art
  // goes with it, and the survivors' art follows the re-pack rather than
  // staying on a number another line now carries. A discard that only took a
  // copy off a line leaves both alone — the line, its id, and its art remain.
  if (outcome.lineRemoved) noteArtRepack(state.art, outcome.remap, outcome.discarded.cardId)

  // The re-pack may have renumbered ids that pending edit-undo entries reference,
  // so the edit history can no longer be replayed safely. Dropping it is the
  // conservative move; the discarded line's own events were filtered already.
  if (state.editUndo.length > 0) {
    state.editUndo = []
    console.log(t('cli.edit.undoHistoryCleared'))
  }

  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
  console.log(t('cli.edit.discardedCard', { name: outcome.discarded.name }))
  return true
}

/** One deck edit-mode field change: the model change, its inverse, and its consolidation. */
export type DeckFieldEdit = FieldEdit<DeckCardSnapshot>

/** Apply a field edit to an existing deck card and record it for changelog + undo. */
export function applyDeckFieldEdit(
  state: DeckSessionState,
  ctx: CardSessionContext,
  located: DeckCardLocation,
  cardId: number,
  edit: DeckFieldEdit,
): void {
  applyFieldEdit(deckModel(state), ctx, located, cardId, edit)
}

/** The per-card prompt context the deck edit flow needs from the session. */
export type DeckEditDeps = {
  sessionConfig: PrintingFilterConfig & FinishConditionConfig
  excludeDigitalOnly: boolean
  /** Present when the session can move cards to other lists (the unified editor). */
  move?: MoveDeps
}

/** Run the edit action menu and the chosen flow for the deck line with `cardId`. */
export async function editDeckCard(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
  deps: DeckEditDeps,
): Promise<void> {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const { card } = located
  const sectionName = located.section.name
  const model = deckModel(state)

  const action = await promptEditAction(renderDeckCardLine(card, sectionName), [
    {
      title: `🖼️  ${t(hasSpecificPrinting(card) ? 'cli.editAction.changePrinting' : 'cli.editAction.setPrinting')}`,
      value: 'printing',
    },
    { title: `➕ ${t('cli.editAction.addCopy')}`, value: 'add-copy' },
    ...(card.quantity > 1
      ? [{ title: `➖ ${t('cli.editAction.removeCopy')}`, value: 'remove-copy' }]
      : []),
    { title: `🌐 ${t('cli.editAction.changeLanguage')}`, value: 'language' },
    { title: `🏷️  ${t('cli.editAction.changeLabel')}`, value: 'label' },
    { title: `🔖 ${t('cli.editAction.editTags')}`, value: 'tags' },
    { title: `🎨 ${t('cli.editAction.setArt')}`, value: 'art' },
    { title: `🗂️  ${t('cli.editAction.moveToSection')}`, value: 'move' },
    ...(deps.move ? [{ title: `📤 ${t('cli.editAction.moveToList')}`, value: 'move-list' }] : []),
    { title: `📝 ${t('cli.editAction.editNote')}`, value: 'note' },
    {
      title:
        card.quantity > 1
          ? `🗑️  ${t('cli.editAction.removeAllCopies', { count: card.quantity })}`
          : `🗑️  ${t('cli.editAction.removeCard')}`,
      value: 'remove-line',
    },
  ])
  if (!action) return

  if (action === 'printing') {
    const result = await resolveCardPrinting(card.name, deps.sessionConfig, deps.excludeDigitalOnly)
    if (result.kind === 'cancelled') return
    if (result.kind === 'none') {
      console.error(t('cli.edit.noPrintings'))
      return
    }
    const finishAndCondition = await promptFinishAndCondition(
      result.printing,
      deps.sessionConfig,
      true,
    )
    if (!finishAndCondition) return
    const target: PrintingTuple = {
      set: result.printing.set.toLowerCase(),
      collectorNumber: result.printing.collector_number,
      finish: finishAndCondition.finish,
      condition: finishAndCondition.condition,
      // The line keeps its language across a printing change unless the
      // picker's availability confirm resolved a different one.
      language: result.language ?? displayLanguage(card.language),
    }
    const before = printingTupleOf(card)
    applyDeckFieldEdit(state, ctx, located, cardId, {
      label: t('cli.editLabel.printing', { name: card.name }),
      change: createSetPrintingChange(card.name, { ...target, cardId }),
      inverse: createSetPrintingChange(card.name, { ...before, cardId }),
      consolidate: (changes, original) =>
        consolidateSetPrinting(changes, card.name, target, original.printing, cardId),
    })
    logUpdatedLine(model, cardId, card.name)
    return
  }

  if (action === 'add-copy') {
    const printing = printingTupleOf(card)
    // The copy carries the line's labels and tags: they are part of the merge
    // identity, so a replay of this event lands on this line and not beside it.
    const addEvent = createAddChange(card.name, {
      ...deckAddOptions(printing, cardId, sectionName),
      labels: card.labels,
      tags: card.tags,
    })
    applyDeckChange(state, addEvent)
    ctx.sessionChanges.push(addEvent)
    // The new copy joins the session adds, so the regular Undo Last Add /
    // Discard menu owns reverting it (no edit-undo entry).
    state.sessionAdds.push({ cardId, name: card.name, printing, section: sectionName })
    console.log(
      t('cli.deck.addedAnother', {
        name: card.name,
        section: sectionName,
        count: card.quantity + 1,
      }),
    )
    return
  }

  if (action === 'remove-copy') {
    performDeckCopyRemoval(state, ctx, cardId)
    return
  }

  if (action === 'language') {
    await editLanguage(model, ctx, located, cardId)
    return
  }

  if (action === 'label') {
    const labels = await promptCardLabelChoice('deck', card.labels)
    if (labels === null || sameCardLabels(labels, card.labels)) return
    applyDeckFieldEdit(state, ctx, located, cardId, {
      label: t('cli.editLabel.labels', { name: card.name }),
      change: createSetLabelChange(card.name, { labels, cardId }),
      inverse: createSetLabelChange(card.name, { labels: [...(card.labels ?? [])], cardId }),
      consolidate: (changes, original) =>
        consolidateSetLabel(changes, card.name, labels, original.labels, cardId),
    })
    logUpdatedLine(model, cardId, card.name)
    return
  }

  if (action === 'tags') {
    await editTags(model, ctx, located, cardId)
    return
  }

  if (action === 'art') {
    await editArt(model, located, cardId)
    return
  }

  if (action === 'move') {
    const target = await promptMoveSection(state.deck, sectionName)
    if (!target || target === sectionName) return
    applyDeckFieldEdit(state, ctx, located, cardId, {
      label: t('cli.editLabel.section', { name: card.name }),
      change: createSetSectionChange(card.name, target, cardId),
      inverse: createSetSectionChange(card.name, sectionName, cardId),
      consolidate: (changes, original) =>
        consolidateSetSection(changes, card.name, target, original.section, cardId),
    })
    logUpdatedLine(model, cardId, card.name)
    return
  }

  if (action === 'move-list' && deps.move) {
    await moveDeckLine(state, ctx, cardId, deps.move)
    return
  }

  if (action === 'note') {
    await editNote(model, ctx, located, cardId)
    return
  }

  if (action === 'remove-line' && (await confirmRemoval(model, located))) {
    performDeckLineRemoval(state, ctx, cardId)
  }
}

/**
 * The interactive Move to Another List flow for a deck line: pick the
 * destination (resolving a printing when a name-only line heads into a
 * collection), then record the move for every copy.
 */
export async function moveDeckLine(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
  move: MoveDeps,
): Promise<void> {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const dest = await resolveMoveDestination({
    deps: move,
    cardName: located.card.name,
    hasPrinting: hasSpecificPrinting(located.card),
  })
  if (!dest) return
  performDeckLineMove(state, ctx, cardId, dest)
}

/**
 * Move every copy of a deck line to another list, as one `move-from` change
 * per copy (each copy is one physical card at the destination). The source
 * side is recorded now; the destination side is derived when the deck is
 * saved (`saveOpenList` in `edit-lists.ts`), exactly as an admin-editor save
 * does. Undoing the move before then restores the line and no move happens.
 *
 * Changelog folding follows {@link performFlatListMove}: earlier field edits
 * fold out (the move-from events carry the final printing), while add events
 * of copies added this session stay so the changelog balances — those copies
 * just stop being individually discardable as adds.
 */
export function performDeckLineMove(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
  dest: MoveDestination,
): void {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const snapshot: Card = { ...located.card }
  const sectionName = located.section.name
  const printing = printingTupleOf(snapshot)

  // Copies added this session keep their add events but leave the discard
  // menus — the move's undo entry owns the whole line now. The line's id is
  // reserved while the move is pending, so a new line cannot take over an id
  // the move-from events still reference.
  state.sessionAdds = state.sessionAdds.filter((record) => record.cardId !== cardId)
  state.sessionLineIds = state.sessionLineIds.filter((id) => id !== cardId)
  state.pendingMoveIds = [...state.pendingMoveIds, cardId]
  // The line is leaving this deck, so its custom art leaves too. The destination
  // side adopts it at save time, where the id it lands on is known.
  noteArtLineRemoved(state.art, cardId)

  const moveEvents: ChangeEvent[] = []
  for (let i = 0; i < snapshot.quantity; i++) {
    applyDeckChange(
      state,
      createRemoveChange(snapshot.name, deckRemoveOptions(printing, cardId, sectionName)),
    )
    moveEvents.push(
      createMoveFromChange(
        snapshot.name,
        moveFromOptionsFor({ ...printing, tags: snapshot.tags, cardId }, dest),
      ),
    )
  }

  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: true })
  ctx.sessionChanges = [...kept, ...moveEvents]

  state.editUndo.push({
    cardId,
    cardName: snapshot.name,
    kind: 'move',
    label: t('cli.editLabel.moveToList', {
      name: snapshot.name,
      list: listRefTitle(dest.target),
    }),
    inverse: restoreLineInverse(snapshot, printing, sectionName, cardId, snapshot.quantity),
    addedToChangelog: moveEvents,
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(deckModel(state), ctx, cardId)
  if (snapshot.note) console.log(t('cli.edit.moveNoteDropped', { name: snapshot.name }))
  console.log(
    t('cli.edit.movedToList', {
      line: renderDeckCardLine(snapshot, sectionName),
      list: listRefTitle(dest.target),
    }),
  )
}

/**
 * Remove one copy of a multi-copy line. A copy added this session is cancelled
 * through the discard machinery (its add event vanishes); otherwise the line is
 * decremented with a remove event, undoable via the edit stack. The line keeps
 * its `&N` id either way — only full removal releases it.
 */
export function performDeckCopyRemoval(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
): void {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const { card } = located
  const sectionName = located.section.name

  // Prefer cancelling a copy added this session — its add event vanishes
  // instead of pairing with a remove event in the changelog.
  const sessionIdx = state.sessionAdds.findLastIndex((r) => r.cardId === cardId)
  if (sessionIdx !== -1) {
    discardDeckSessionAdd(state, ctx, sessionIdx)
    return
  }
  const printing = printingTupleOf(card)
  const removeEvent = createRemoveChange(
    card.name,
    deckRemoveOptions(printing, cardId, sectionName),
  )
  applyDeckChange(state, removeEvent)
  ctx.sessionChanges.push(removeEvent)
  // Whether the `&N` survived is read off the deck rather than assumed from the
  // caller: the edit menu only offers this action above one copy, but the
  // function is exported, and a last copy taken out here really does delete the
  // line — freeing its id, and with it the claim on its custom art.
  const survived = findCardById(state.deck, cardId) !== null
  if (!survived) noteArtLineRemoved(state.art, cardId)
  state.editUndo.push({
    cardId,
    cardName: card.name,
    kind: 'removal',
    label: t('cli.editLabel.removeCopy', { name: card.name }),
    // The same restore a full removal uses: when this took the last copy, the
    // line comes back with its labels, tags and note, not as a bare printing.
    inverse: restoreLineInverse(card, printing, sectionName, cardId, 1),
    addedToChangelog: [removeEvent],
    removedFromChangelog: [],
    ...(survived ? {} : { reclaimId: cardId }),
  })
  const model = deckModel(state)
  resetStaleLastAdded(model, ctx, cardId)
  logUpdatedLine(model, cardId, card.name)
}

/**
 * Remove every copy of a deck line. Copies added this session are cancelled
 * through the discard machinery (their add events vanish); any remaining
 * pre-existing copies record remove events and become a single undoable
 * operation that restores the line.
 */
export function performDeckLineRemoval(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
): void {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const snapshot: Card = { ...located.card }
  const sectionName = located.section.name

  // First cancel the copies added this session, newest first.
  let sessionIdx = state.sessionAdds.findLastIndex((r) => r.cardId === cardId)
  while (sessionIdx !== -1) {
    if (!discardDeckSessionAdd(state, ctx, sessionIdx)) break
    sessionIdx = state.sessionAdds.findLastIndex((r) => r.cardId === cardId)
  }

  // Whatever survives pre-existed the session; remove copy by copy so the
  // changelog mirrors how the admin editor records full removals.
  const remaining = findCardById(state.deck, cardId)
  if (!remaining) return
  const printing = printingTupleOf(remaining.card)
  const quantity = remaining.card.quantity
  const removeEvents: ChangeEvent[] = []
  for (let i = 0; i < quantity; i++) {
    const removeEvent = createRemoveChange(
      snapshot.name,
      deckRemoveOptions(printing, cardId, sectionName),
    )
    applyDeckChange(state, removeEvent)
    removeEvents.push(removeEvent)
  }

  // The last copy went, so the line — and its `&N` — is gone; its custom art
  // goes with it, or the next line to take the id would inherit it.
  noteArtLineRemoved(state.art, cardId)

  // The removed line's earlier edit events are moot, so they fold out of the
  // changelog (and come back if the removal is undone).
  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: false })
  ctx.sessionChanges = [...kept, ...removeEvents]

  state.editUndo.push({
    cardId,
    cardName: snapshot.name,
    kind: 'removal',
    label: t('cli.editLabel.removal', { name: snapshot.name }),
    inverse: restoreLineInverse(snapshot, printing, sectionName, cardId, quantity),
    addedToChangelog: removeEvents,
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(deckModel(state), ctx, cardId)
  console.log(t('cli.deck.removedFromSection', { name: snapshot.name, section: sectionName }))
}

/** Label of the operation Undo Last Edit would revert, or null when the stack is empty. */
export function lastDeckEditLabel(state: DeckSessionState): string | null {
  return lastEditLabel(state.editUndo)
}

/**
 * Undo the most recent edit-mode operation: apply its inverse changes to the
 * deck and swap its changelog events back out. A removed line's id is restored
 * when still free; if a later add reused it, the restored line gets a fresh id
 * instead (and the deeper history for the old id is retargeted to the new one).
 */
export function undoDeckEdit(state: DeckSessionState, ctx: CardSessionContext): void {
  undoDeckEditAt(state, ctx, state.editUndo.length - 1)
}

/**
 * Undo the edit-mode operation at `index` into the undo stack, out of order.
 * Safe only while no newer operation touches the same card (the
 * {@link targetedUndoBlocker} guard) — inverses are absolute field restores and
 * changelog footprints only overlap between same-card operations, so removing a
 * conflict-free entry from the middle of the stack leaves the rest replayable.
 */
export function undoDeckEditAt(
  state: DeckSessionState,
  ctx: CardSessionContext,
  index: number,
): void {
  const undo = state.editUndo[index]
  if (!undo) return
  const blocked = targetedUndoBlocker(state.editUndo, index)
  if (blocked) {
    console.log(t('cli.edit.cannotDiscardYet', { label: undo.label, reason: blocked }))
    return
  }
  state.editUndo.splice(index, 1)

  // Undoing a move lifts its id reservation — the inverse adds below put the
  // line (and with it the id) back into the deck.
  if (undo.kind === 'move') {
    state.pendingMoveIds = state.pendingMoveIds.filter((id) => id !== undo.cardId)
  }

  // Decks have no explicit pool: an id is free exactly when no line carries it,
  // and a free id needs no claim step — applying the inverse adds below restores
  // the line with its original id. Only the reused-id case needs intervention
  // (the flat-list counterpart instead claims/allocates from its persistent pool).
  if (undo.reclaimId !== undefined) {
    if (findCardById(state.deck, undo.reclaimId) !== null) {
      // The id was reused, so the restored line takes a fresh one — and the
      // custom art stays dropped, because its old id is another card's now.
      const pool = createIdPool(collectDeckCardIds(state.deck))
      retargetUndoCardId([undo, ...state.editUndo], undo.reclaimId, allocateId(pool))
    } else {
      // The line comes back under its own id, so its custom art comes with it.
      noteArtLineRestored(state.art, undo.reclaimId)
    }
  }

  // An art edit's only effect is on the sidecar, so its undo is a re-stage.
  if (undo.restoreArt) noteArtSet(state.art, undo.cardId, undo.restoreArt.ref)

  for (const change of undo.inverse) {
    applyDeckChange(state, change)
  }

  swapUndoChangelog(ctx, undo)
  resetStaleLastAdded(deckModel(state), ctx, undo.cardId)
  console.log(t('cli.edit.undid', { label: undo.label }))
}

/** The copies added this session rendered for the Undo Last Add picker. */
export function listDeckSessionAdds(state: DeckSessionState): SessionAddItem[] {
  return state.sessionAdds.map(renderDeckCopyRecord)
}

/**
 * Every change made this session — copy adds, field edits, and removals — for
 * the View Session Changes picker. Indices feed {@link discardDeckSessionChange}.
 */
export function listDeckSessionChanges(state: DeckSessionState): SessionChangeItem[] {
  return listSessionChanges(deckModel(state))
}

/**
 * Run an edit action from the View Session Changes screen against the deck line
 * the change at `index` targets — this deck's own action menu, or the language
 * picker (see {@link editSessionChangeAt}).
 */
export function editDeckSessionChange(
  state: DeckSessionState,
  ctx: CardSessionContext,
  index: number,
  action: SessionChangeEditAction,
  deps: DeckEditDeps,
): Promise<void> {
  return editSessionChangeAt(deckModel(state), ctx, index, action, (cardId) =>
    editDeckCard(state, ctx, cardId, deps),
  )
}

/** Prompt for and apply a language change on the deck line with `cardId`. */
export function editDeckCardLanguage(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
): Promise<void> {
  return editLanguageById(deckModel(state), ctx, cardId)
}

/**
 * Discard the session change at `index` (into {@link listDeckSessionChanges}):
 * a copy add is discarded through the session-add machinery, anything else
 * through a targeted undo of its edit-mode operation. Returns whether a session
 * add was discarded (the caller resets its last-added shortcuts in that case).
 */
export function discardDeckSessionChange(
  state: DeckSessionState,
  ctx: CardSessionContext,
  index: number,
): boolean {
  return discardSessionChangeAt(
    state.sessionAdds.length,
    index,
    (i) => discardDeckSessionAdd(state, ctx, i),
    (i) => undoDeckEditAt(state, ctx, i),
  )
}
