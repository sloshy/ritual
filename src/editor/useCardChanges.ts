import { type Accessor, batch, createSignal, createMemo } from 'solid-js'
import type { Finish } from '../types'
import type { ChangeInput } from '../change-event'
import {
  type ChangeEvent,
  type CardPrintingOptions,
  type PrintingTuple,
  type ListRef,
  type RemoveChange,
  createChangeId,
  areOppositeChanges,
  consolidateSetFinish,
  consolidateSetLabel,
  consolidateSetLanguage,
  consolidateSetPrinting,
  consolidateSetSection,
} from '../change-event'
import type { CardLabel } from '../card-labels'
import type { CardLanguage } from '../card-language'

/**
 * What an add (or the record of what a remove took away) may carry beyond the
 * printing: the line's label override. Labels ride the `add`/`remove` event
 * itself so they land on the copy the change is about — and so a remove and a
 * re-add under different overrides are not read as opposites.
 */
export type AddCardOptions = CardPrintingOptions & {
  labels?: CardLabel[]
}

/**
 * What an {@link UseCardChangesResult.addCard} did.
 *
 * `cancelled` is not merely "no change was recorded": the pending removal it
 * annulled names, through its `cardId`, the line that therefore survives — the
 * only handle a caller has on the card the add actually landed on. Art picked
 * at add time belongs on *that* line (a re-add that specifies art is one of the
 * two ways art comes back after a removal), so the counterpart is surfaced
 * rather than folded into a bare `null`.
 */
export type AddCardResult =
  | { kind: 'added'; change: ChangeEvent }
  | { kind: 'cancelled'; cancelled: RemoveChange | null }

/**
 * Stores enough context to fully reverse a single user action.
 * - addedChange: the ChangeEvent that was pushed to the changes array (null if auto-cancelled)
 * - cancelledChange: a previously existing ChangeEvent removed by auto-cancel (null if none)
 * - removedCardData: full card data stored by the editor for removal undo restoration
 */
export type UndoEntry<T = unknown> = {
  addedChange: ChangeEvent | null
  cancelledChange: ChangeEvent | null
  removedCardData?: T
}

export type UndoResult<T = unknown> = {
  entry: UndoEntry<T>
  remainingChanges: ChangeEvent[]
}

export type UseCardChangesResult<T = unknown> = {
  changes: Accessor<ChangeEvent[]>
  changeCount: Accessor<number>
  addChange: (change: ChangeInput, removedCardData?: T) => ChangeEvent | null
  /** Replace the entire pending-change stack (e.g. when importing a change file). Clears undo history. */
  loadChanges: (changes: ChangeEvent[]) => void
  /**
   * Drop specific pending changes by id — the ones a replay could not apply.
   * Undo entries naming a dropped change go with it: the edit they would take
   * back is not in the data any more.
   */
  dropChanges: (changeIds: ReadonlySet<string>) => void
  discardAll: () => void
  canUndo: Accessor<boolean>
  undo: () => UndoResult<T> | null
  undoStack: Accessor<UndoEntry<T>[]>
  /**
   * Drop one copy. `labels` is the override the line being decremented carries,
   * recorded on the change so a re-add under a different override does not
   * cancel it (see {@link RemoveChange.labels}).
   */
  decrementCard: (
    cardName: string,
    cardId?: number,
    removedCardData?: T,
    labels?: CardLabel[],
  ) => void
  /**
   * Add a copy, optionally under a label override the new line starts with.
   *
   * Reports the recorded `add`, or the pending removal it cancelled instead
   * (see {@link areOppositeChanges}) — in which case the session leaves the line
   * exactly as the file has it, and a caller staging anything against the id it
   * allocated (custom art) must take that back and aim it at the surviving line
   * named by the cancelled removal.
   */
  addCard: (cardName: string, options?: AddCardOptions) => AddCardResult
  removeCard: (cardName: string, options?: AddCardOptions, removedCardData?: T) => void
  /** Record a move of a card out of this list into another list (`to`). */
  moveCardToList: (
    cardName: string,
    to: ListRef,
    options?: CardPrintingOptions,
    removedCardData?: T,
  ) => void
  setFinish: (cardName: string, finish: Finish, originalFinish: Finish, cardId?: number) => void
  setPrinting: (
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) => void
  setSection: (cardName: string, section: string, originalSection: string, cardId?: number) => void
  /**
   * Set a card's language with "latest wins" semantics. `originalLanguage` is the
   * on-disk value (undefined for a bare line, which means `en`); restoring it
   * cancels the pending change, so undo lands back on the prior language.
   */
  setLanguage: (
    cardName: string,
    language: CardLanguage,
    originalLanguage: CardLanguage | undefined,
    cardId?: number,
  ) => void
  /** Set (or, with `[]`, clear) a collection card's label override — latest wins. */
  setLabel: (
    cardName: string,
    labels: CardLabel[],
    originalLabels: readonly CardLabel[] | undefined,
    cardId?: number,
  ) => void
}

export function useCardChanges<T = unknown>(): UseCardChangesResult<T> {
  const [changes, setChanges] = createSignal<ChangeEvent[]>([])
  const [undoStack, setUndoStack] = createSignal<UndoEntry<T>[]>([])
  let changesRef: ChangeEvent[] = []
  let undoStackRef: UndoEntry<T>[] = []

  /**
   * Record one change, cancelling a pending opposite instead when there is one,
   * and report both halves. `addChange` is the public half of this and keeps
   * returning only what was added; {@link addCard} needs the cancelled event
   * too, because its `cardId` is the line that survived.
   */
  function recordChange(partial: ChangeInput, removedCardData?: T): UndoEntry<T> {
    const newEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    }

    let addedChange: ChangeEvent | null = newEvent
    let cancelledChange: ChangeEvent | null = null

    const oppositeIndex = changesRef.findIndex((existing) => areOppositeChanges(existing, newEvent))

    if (oppositeIndex !== -1) {
      cancelledChange = changesRef[oppositeIndex] ?? null
      addedChange = null
      changesRef = changesRef.filter((_, i) => i !== oppositeIndex)
    } else {
      changesRef = [...changesRef, newEvent]
    }

    const entry: UndoEntry<T> = { addedChange, cancelledChange, removedCardData }
    undoStackRef = [...undoStackRef, entry]

    // One update cycle rather than two: the card list and the undo button both
    // repaint from this, and every caller outside the add flow's own `batch`
    // would otherwise pay for a second pass.
    batch(() => {
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    })

    return entry
  }

  function addChange(partial: ChangeInput, removedCardData?: T): ChangeEvent | null {
    return recordChange(partial, removedCardData).addedChange
  }

  function loadChanges(loaded: ChangeEvent[]) {
    // Imported changes arrive as a curated event log; replace the stack wholesale
    // (no auto-cancel) and reset undo history, since the prior pending edits are gone.
    changesRef = [...loaded]
    undoStackRef = []
    setChanges([...changesRef])
    setUndoStack([])
  }

  function dropChanges(changeIds: ReadonlySet<string>) {
    if (changeIds.size === 0) return
    changesRef = changesRef.filter((change) => !changeIds.has(change.id))
    // Both sides: undoing an entry re-adds its `cancelledChange`, so an entry
    // naming a dropped change on either side would resurrect one the engine
    // refused.
    undoStackRef = undoStackRef.filter(
      (entry) =>
        (entry.addedChange === null || !changeIds.has(entry.addedChange.id)) &&
        (entry.cancelledChange === null || !changeIds.has(entry.cancelledChange.id)),
    )
    // One update cycle, for the reason `recordChange` gives: the change list and
    // the undo button both repaint from this.
    batch(() => {
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    })
  }

  function discardAll() {
    changesRef = []
    undoStackRef = []
    setChanges([])
    setUndoStack([])
  }

  function undo(): UndoResult<T> | null {
    if (undoStackRef.length === 0) return null

    const entry = undoStackRef[undoStackRef.length - 1]!
    undoStackRef = undoStackRef.slice(0, -1)

    let next = changesRef
    if (entry.addedChange) {
      next = next.filter((c) => c.id !== entry.addedChange!.id)
    }
    if (entry.cancelledChange) {
      next = [...next, entry.cancelledChange]
    }
    changesRef = next

    setUndoStack([...undoStackRef])
    setChanges([...changesRef])

    return { entry, remainingChanges: changesRef }
  }

  function decrementCard(
    cardName: string,
    cardId?: number,
    removedCardData?: T,
    labels?: CardLabel[],
  ) {
    addChange({ action: 'remove', cardName, cardId, labels }, removedCardData)
  }

  function addCard(cardName: string, options?: AddCardOptions): AddCardResult {
    const { addedChange, cancelledChange } = recordChange({ action: 'add', cardName, ...options })
    if (addedChange !== null) return { kind: 'added', change: addedChange }
    // Only a `remove` is ever the opposite of an `add` (see areOppositeChanges),
    // so the narrowing here can never actually discard a cancellation.
    const removed = cancelledChange?.action === 'remove' ? cancelledChange : null
    return { kind: 'cancelled', cancelled: removed }
  }

  function removeCard(cardName: string, options?: AddCardOptions, removedCardData?: T) {
    addChange({ action: 'remove', cardName, ...options }, removedCardData)
  }

  function moveCardToList(
    cardName: string,
    to: ListRef,
    options?: CardPrintingOptions,
    removedCardData?: T,
  ) {
    addChange({ action: 'move-from', cardName, ...options, to }, removedCardData)
  }

  function setFinish(cardName: string, finish: Finish, originalFinish: Finish, cardId?: number) {
    const {
      changes: newChanges,
      addedChange,
      cancelledChange,
    } = consolidateSetFinish(changesRef, cardName, finish, originalFinish, cardId)
    if (addedChange !== null || cancelledChange !== null) {
      changesRef = newChanges
      undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    }
  }

  function setPrinting(
    cardName: string,
    target: PrintingTuple,
    original: PrintingTuple,
    cardId?: number,
  ) {
    const {
      changes: newChanges,
      addedChange,
      cancelledChange,
    } = consolidateSetPrinting(changesRef, cardName, target, original, cardId)
    if (addedChange !== null || cancelledChange !== null) {
      changesRef = newChanges
      undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    }
  }

  function setSection(cardName: string, section: string, originalSection: string, cardId?: number) {
    const {
      changes: newChanges,
      addedChange,
      cancelledChange,
    } = consolidateSetSection(changesRef, cardName, section, originalSection, cardId)
    if (addedChange !== null || cancelledChange !== null) {
      changesRef = newChanges
      undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    }
  }

  function setLanguage(
    cardName: string,
    language: CardLanguage,
    originalLanguage: CardLanguage | undefined,
    cardId?: number,
  ) {
    const {
      changes: newChanges,
      addedChange,
      cancelledChange,
    } = consolidateSetLanguage(changesRef, cardName, language, originalLanguage, cardId)
    if (addedChange !== null || cancelledChange !== null) {
      changesRef = newChanges
      undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    }
  }

  function setLabel(
    cardName: string,
    labels: CardLabel[],
    originalLabels: readonly CardLabel[] | undefined,
    cardId?: number,
  ) {
    const {
      changes: newChanges,
      addedChange,
      cancelledChange,
    } = consolidateSetLabel(changesRef, cardName, labels, originalLabels, cardId)
    if (addedChange !== null || cancelledChange !== null) {
      changesRef = newChanges
      undoStackRef = [...undoStackRef, { addedChange, cancelledChange }]
      setChanges([...changesRef])
      setUndoStack([...undoStackRef])
    }
  }

  const changeCount = createMemo(() => changes().length)
  const canUndo = createMemo(() => undoStack().length > 0)

  return {
    changes,
    changeCount,
    addChange,
    loadChanges,
    dropChanges,
    discardAll,
    canUndo,
    undo,
    undoStack,
    decrementCard,
    addCard,
    removeCard,
    moveCardToList,
    setFinish,
    setPrinting,
    setSection,
    setLanguage,
    setLabel,
  }
}
