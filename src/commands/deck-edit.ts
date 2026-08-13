import prompts from 'prompts'
import type { PromptState } from './prompts-types'
import type { Card, DeckData } from '../types'
import {
  consolidateSetLanguage,
  consolidateSetNote,
  consolidateSetPrinting,
  consolidateSetSection,
  createAddChange,
  createMoveFromChange,
  createRemoveChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  formatPrintingAnnotation,
  type ChangeEvent,
  type ConsolidateResult,
  type PrintingTuple,
} from '../change-event'
import {
  listRefTitle,
  moveFromOptionsFor,
  resolveMoveDestination,
  type MoveDeps,
  type MoveDestination,
} from './edit-move'
import { displayLanguage, type CardLanguage } from '../card-language'
import { t } from '../i18n/t'
import { allocateId, assignMissingDeckCardIds, collectDeckCardIds, createIdPool } from '../card-id'
import { applyChangeToDeck } from '../editor/deck-changes'
import { normalizeBoard } from '../deck-sync/diff'
import {
  deckSectionNames,
  discardDeckCopy,
  findCardById,
  promptNewSectionName,
  renderDeckCopyRecord,
  type DeckCopyRecord,
} from './deck-helpers'
import {
  promptEditAction,
  promptNoteEdit,
  type CardSessionContext,
  type EditableEntryItem,
  type SessionAddItem,
  type SessionChangeItem,
} from './card-session'
import {
  promptFinishAndCondition,
  promptLanguageChoice,
  resolveCardPrinting,
  type FinishConditionConfig,
  type PrintingFilterConfig,
} from './collection-helpers'
import {
  changelogDelta,
  foldOutCardChanges,
  listSessionChangeItems,
  retargetUndoCardId,
  swapUndoChangelog,
  targetedUndoBlocker,
  type EditUndoEntry,
} from './edit-undo'

/**
 * Edit-mode operations for the deck session: changing a line's printing,
 * adding/removing copies, moving between sections, note edits, and full-line
 * removal — all applied to the in-memory deck and undoable via a linear stack.
 * Mirrors `flat-list-edit.ts` for the flat list types; decks differ in carrying
 * quantities per line and in assigning card ids without an explicit pool.
 */

/** Session-start snapshot of a deck card touched in edit mode. */
export type DeckCardSnapshot = {
  name: string
  printing: PrintingTuple
  /** The line's `[ja]`-style language token at session start. Absent means `en`. */
  language?: CardLanguage
  note?: string
  section: string
}

/** The mutable deck-session state shared by the strategy and the edit operations. */
export type DeckSessionState = {
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
}

/**
 * Apply a change to the in-memory deck. IDs are assigned to the in-memory copy
 * too (not just on serialize) so subsequent edits resolve cards by ID.
 */
export function applyDeckChange(state: DeckSessionState, change: ChangeEvent): void {
  state.deck = assignMissingDeckCardIds(applyChangeToDeck(state.deck, change), state.pendingMoveIds)
  state.dirty = true
}

/**
 * The printing tuple of a deck card, for consolidation comparisons and
 * inverses. The language is resolved explicitly (`en` for a bare line), like
 * `entryPrinting` in flat-list-edit: a set-printing built from this tuple must
 * restore the card's language — absent would mean "leave the token alone".
 */
function cardPrinting(card: Card): PrintingTuple {
  return {
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: displayLanguage(card.language),
  }
}

/** Render a deck line for the edit-mode picker, e.g. `2 Sol Ring (C19:221) [foil] — Main &5`. */
export function renderDeckCardLine(card: Card, sectionName: string): string {
  return `${card.quantity} ${card.name}${formatPrintingAnnotation(card)} — ${sectionName} &${card.cardId}`
}

/** The deck's current lines rendered for the edit-mode picker, in file order. */
export function listDeckEntries(deck: DeckData): EditableEntryItem[] {
  const items: EditableEntryItem[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId === undefined) continue
      items.push({ label: renderDeckCardLine(card, section.name), cardId: card.cardId })
    }
  }
  return items
}

/**
 * The session-start snapshot of a deck card, captured on first touch. A
 * snapshot whose name no longer matches the live card is stale (its id was
 * freed and reused by a different card), so it is replaced rather than trusted.
 */
function originalSnapshot(
  state: DeckSessionState,
  card: Card,
  sectionName: string,
  cardId: number,
): DeckCardSnapshot {
  const existing = state.originals.get(cardId)
  if (existing && existing.name === card.name) return existing
  const snapshot: DeckCardSnapshot = {
    name: card.name,
    printing: cardPrinting(card),
    language: card.language,
    note: card.note,
    section: sectionName,
  }
  state.originals.set(cardId, snapshot)
  return snapshot
}

/**
 * Editing or removing the "last added" card invalidates the add-mode shortcuts
 * (Add Exact Copy would resurrect the pre-edit line), so they reset until the
 * next add.
 */
function resetStaleLastAdded(ctx: CardSessionContext, cardId: number): void {
  if (ctx.lastAdded?.cardId !== cardId) return
  ctx.lastAdded = null
  ctx.lastChangeIndex = null
  ctx.lastAddedCount = 0
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
export type DeckFieldEdit = {
  label: string
  change: ChangeEvent
  inverse: ChangeEvent
  consolidate: (changes: ChangeEvent[], original: DeckCardSnapshot) => ConsolidateResult
}

/** Apply a field edit to an existing deck card and record it for changelog + undo. */
export function applyDeckFieldEdit(
  state: DeckSessionState,
  ctx: CardSessionContext,
  card: Card,
  sectionName: string,
  cardId: number,
  edit: DeckFieldEdit,
): void {
  const original = originalSnapshot(state, card, sectionName, cardId)
  applyDeckChange(state, edit.change)
  const result = edit.consolidate(ctx.sessionChanges, original)
  ctx.sessionChanges = result.changes
  state.editUndo.push({
    cardId,
    kind: 'edit',
    label: edit.label,
    inverse: [edit.inverse],
    ...changelogDelta(result),
  })
  resetStaleLastAdded(ctx, cardId)
}

/** Re-render the line after an edit (apply replaces card objects). */
function logUpdatedLine(state: DeckSessionState, cardId: number, fallbackName: string): void {
  const located = findCardById(state.deck, cardId)
  console.log(
    t('cli.edit.changedLine', {
      line: located ? renderDeckCardLine(located.card, located.section.name) : fallbackName,
    }),
  )
}

type ConfirmPromptResponse = { confirm?: boolean }
type SectionPromptResponse = { section?: string }

const NEW_SECTION = '__NEW__'

/** Pick the section to move a card to (existing sections or a new one). */
async function promptMoveSection(deck: DeckData, current: string): Promise<string | null> {
  let isExited = false
  const response = (await prompts({
    type: 'select',
    name: 'section',
    message: t('cli.deck.promptMoveSection'),
    choices: [
      ...deckSectionNames(deck).map((n) => ({
        title: n === current ? t('cli.edit.current', { label: n }) : n,
        value: n,
      })),
      { title: `+ ${t('cli.deck.newSection')}`, value: NEW_SECTION },
    ],
    onState: (promptState: PromptState) => {
      if (promptState.exited) isExited = true
    },
  })) as SectionPromptResponse
  if (isExited || response.section === undefined) return null
  if (response.section !== NEW_SECTION) return response.section
  return promptNewSectionName()
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

  const action = await promptEditAction(renderDeckCardLine(card, sectionName), [
    { title: `🖼️  ${t('cli.editAction.changePrinting')}`, value: 'printing' },
    { title: `➕ ${t('cli.editAction.addCopy')}`, value: 'add-copy' },
    ...(card.quantity > 1
      ? [{ title: `➖ ${t('cli.editAction.removeCopy')}`, value: 'remove-copy' }]
      : []),
    { title: `🌐 ${t('cli.editAction.changeLanguage')}`, value: 'language' },
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
    const before = cardPrinting(card)
    applyDeckFieldEdit(state, ctx, card, sectionName, cardId, {
      label: t('cli.editLabel.printing', { name: card.name }),
      change: createSetPrintingChange(card.name, { ...target, cardId }),
      inverse: createSetPrintingChange(card.name, { ...before, cardId }),
      consolidate: (changes, original) =>
        consolidateSetPrinting(changes, card.name, target, original.printing, cardId),
    })
    logUpdatedLine(state, cardId, card.name)
    return
  }

  if (action === 'add-copy') {
    const printing = cardPrinting(card)
    const addEvent = createAddChange(card.name, {
      ...printing,
      cardId,
      section: sectionName,
      board: normalizeBoard(sectionName),
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
    const language = await promptLanguageChoice(card.language)
    if (language === null || language === displayLanguage(card.language)) return
    applyDeckFieldEdit(state, ctx, card, sectionName, cardId, {
      label: t('cli.editLabel.language', { name: card.name }),
      change: createSetLanguageChange(card.name, { language, cardId }),
      inverse: createSetLanguageChange(card.name, {
        language: displayLanguage(card.language),
        cardId,
      }),
      consolidate: (changes, original) =>
        consolidateSetLanguage(changes, card.name, language, original.language, cardId),
    })
    logUpdatedLine(state, cardId, card.name)
    return
  }

  if (action === 'move') {
    const target = await promptMoveSection(state.deck, sectionName)
    if (!target || target === sectionName) return
    applyDeckFieldEdit(state, ctx, card, sectionName, cardId, {
      label: t('cli.editLabel.section', { name: card.name }),
      change: createSetSectionChange(card.name, target, cardId),
      inverse: createSetSectionChange(card.name, sectionName, cardId),
      consolidate: (changes, original) =>
        consolidateSetSection(changes, card.name, target, original.section, cardId),
    })
    logUpdatedLine(state, cardId, card.name)
    return
  }

  if (action === 'move-list' && deps.move) {
    await moveDeckLine(state, ctx, cardId, deps.move)
    return
  }

  if (action === 'note') {
    await editDeckNote(state, ctx, card, sectionName, cardId)
    return
  }

  if (action === 'remove-line') {
    await removeDeckLine(state, ctx, cardId)
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
    hasPrinting: Boolean(located.card.set && located.card.collectorNumber),
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
  const printing = cardPrinting(snapshot)

  // Copies added this session keep their add events but leave the discard
  // menus — the move's undo entry owns the whole line now. The line's id is
  // reserved while the move is pending, so a new line cannot take over an id
  // the move-from events still reference.
  state.sessionAdds = state.sessionAdds.filter((record) => record.cardId !== cardId)
  state.sessionLineIds = state.sessionLineIds.filter((id) => id !== cardId)
  state.pendingMoveIds = [...state.pendingMoveIds, cardId]

  const moveEvents: ChangeEvent[] = []
  const inverse: ChangeEvent[] = []
  for (let i = 0; i < snapshot.quantity; i++) {
    applyDeckChange(
      state,
      createRemoveChange(snapshot.name, {
        ...printing,
        cardId,
        board: normalizeBoard(sectionName),
      }),
    )
    moveEvents.push(
      createMoveFromChange(snapshot.name, moveFromOptionsFor({ ...printing, cardId }, dest)),
    )
    inverse.push(
      createAddChange(snapshot.name, {
        ...printing,
        cardId,
        section: sectionName,
        board: normalizeBoard(sectionName),
      }),
    )
  }
  if (snapshot.note) {
    inverse.push(createSetNoteChange(snapshot.name, { note: snapshot.note, cardId }))
  }

  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: true })
  ctx.sessionChanges = [...kept, ...moveEvents]

  state.editUndo.push({
    cardId,
    kind: 'move',
    label: t('cli.editLabel.moveToList', {
      name: snapshot.name,
      list: listRefTitle(dest.target),
    }),
    inverse,
    addedToChangelog: moveEvents,
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(ctx, cardId)
  if (snapshot.note) console.log(t('cli.edit.moveNoteDropped', { name: snapshot.name }))
  console.log(
    t('cli.edit.movedToList', {
      line: renderDeckCardLine(snapshot, sectionName),
      list: listRefTitle(dest.target),
    }),
  )
}

/** Prompt for and apply a note edit on an existing deck line (empty input clears the note). */
export async function editDeckNote(
  state: DeckSessionState,
  ctx: CardSessionContext,
  card: Card,
  sectionName: string,
  cardId: number,
): Promise<void> {
  const edit = await promptNoteEdit(card.note)
  if (!edit) return
  applyDeckFieldEdit(state, ctx, card, sectionName, cardId, {
    label: t('cli.editLabel.note', { name: card.name }),
    change: createSetNoteChange(card.name, { note: edit.note, cardId }),
    inverse: createSetNoteChange(card.name, { note: edit.before, cardId }),
    consolidate: (changes, original) =>
      consolidateSetNote(changes, card.name, edit.note, original.note ?? '', cardId),
  })
  console.log(
    edit.note
      ? t('cli.edit.noteSet', { name: card.name })
      : t('cli.edit.noteCleared', { name: card.name }),
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
  const removeEvent = createRemoveChange(card.name, {
    ...cardPrinting(card),
    cardId,
    board: normalizeBoard(sectionName),
  })
  applyDeckChange(state, removeEvent)
  ctx.sessionChanges.push(removeEvent)
  state.editUndo.push({
    cardId,
    kind: 'removal',
    label: t('cli.editLabel.removeCopy', { name: card.name }),
    inverse: [
      createAddChange(card.name, {
        ...cardPrinting(card),
        cardId,
        section: sectionName,
        board: normalizeBoard(sectionName),
      }),
    ],
    addedToChangelog: [removeEvent],
    removedFromChangelog: [],
  })
  resetStaleLastAdded(ctx, cardId)
  logUpdatedLine(state, cardId, card.name)
}

/** Confirmation gate in front of {@link performDeckLineRemoval}. */
async function removeDeckLine(
  state: DeckSessionState,
  ctx: CardSessionContext,
  cardId: number,
): Promise<void> {
  const located = findCardById(state.deck, cardId)
  if (!located) return
  const confirmResponse = (await prompts({
    type: 'confirm',
    name: 'confirm',
    message: t('cli.edit.confirmRemove', {
      line: renderDeckCardLine(located.card, located.section.name),
    }),
    initial: false,
  })) as ConfirmPromptResponse
  if (!confirmResponse.confirm) return
  performDeckLineRemoval(state, ctx, cardId)
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
  const printing = cardPrinting(remaining.card)
  const quantity = remaining.card.quantity
  const removeEvents: ChangeEvent[] = []
  const inverse: ChangeEvent[] = []
  for (let i = 0; i < quantity; i++) {
    const removeEvent = createRemoveChange(snapshot.name, {
      ...printing,
      cardId,
      board: normalizeBoard(sectionName),
    })
    applyDeckChange(state, removeEvent)
    removeEvents.push(removeEvent)
    inverse.push(
      createAddChange(snapshot.name, {
        ...printing,
        cardId,
        section: sectionName,
        board: normalizeBoard(sectionName),
      }),
    )
  }
  if (snapshot.note) {
    inverse.push(createSetNoteChange(snapshot.name, { note: snapshot.note, cardId }))
  }

  // The removed line's earlier edit events are moot, so they fold out of the
  // changelog (and come back if the removal is undone).
  const { kept, displaced } = foldOutCardChanges(ctx.sessionChanges, cardId, { keepAdds: false })
  ctx.sessionChanges = [...kept, ...removeEvents]

  state.editUndo.push({
    cardId,
    kind: 'removal',
    label: t('cli.editLabel.removal', { name: snapshot.name }),
    inverse,
    addedToChangelog: removeEvents,
    removedFromChangelog: displaced,
    reclaimId: cardId,
  })
  resetStaleLastAdded(ctx, cardId)
  console.log(t('cli.deck.removedFromSection', { name: snapshot.name, section: sectionName }))
}

/** Label of the operation Undo Last Edit would revert, or null when the stack is empty. */
export function lastDeckEditLabel(state: DeckSessionState): string | null {
  return state.editUndo[state.editUndo.length - 1]?.label ?? null
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
  if (undo.reclaimId !== undefined && findCardById(state.deck, undo.reclaimId) !== null) {
    const pool = createIdPool(collectDeckCardIds(state.deck))
    retargetUndoCardId([undo, ...state.editUndo], undo.reclaimId, allocateId(pool))
  }

  for (const change of undo.inverse) {
    applyDeckChange(state, change)
  }

  swapUndoChangelog(ctx, undo)
  resetStaleLastAdded(ctx, undo.cardId)
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
  return listSessionChangeItems(listDeckSessionAdds(state), state.editUndo)
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
  const addCount = state.sessionAdds.length
  if (index < addCount) {
    return discardDeckSessionAdd(state, ctx, index)
  }
  undoDeckEditAt(state, ctx, index - addCount)
  return false
}
