import { type Accessor, createSignal, createMemo } from 'solid-js'
import type { Finish } from '../types'
import type { ChangeInput } from '../change-event'
import {
  type ChangeEvent,
  type CardPrintingOptions,
  type PrintingTuple,
  type ListRef,
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
  discardAll: () => void
  canUndo: Accessor<boolean>
  undo: () => UndoResult<T> | null
  undoStack: Accessor<UndoEntry<T>[]>
  incrementCard: (cardName: string, cardId?: number) => void
  decrementCard: (cardName: string, cardId?: number, removedCardData?: T) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  removeCard: (cardName: string, options?: CardPrintingOptions, removedCardData?: T) => void
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

  function addChange(partial: ChangeInput, removedCardData?: T): ChangeEvent | null {
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

    undoStackRef = [...undoStackRef, { addedChange, cancelledChange, removedCardData }]

    setChanges([...changesRef])
    setUndoStack([...undoStackRef])

    return addedChange
  }

  function loadChanges(loaded: ChangeEvent[]) {
    // Imported changes arrive as a curated event log; replace the stack wholesale
    // (no auto-cancel) and reset undo history, since the prior pending edits are gone.
    changesRef = [...loaded]
    undoStackRef = []
    setChanges([...changesRef])
    setUndoStack([])
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

  function incrementCard(cardName: string, cardId?: number) {
    addChange({ action: 'add', cardName, cardId })
  }

  function decrementCard(cardName: string, cardId?: number, removedCardData?: T) {
    addChange({ action: 'remove', cardName, cardId }, removedCardData)
  }

  function addCard(cardName: string, options?: CardPrintingOptions) {
    addChange({ action: 'add', cardName, ...options })
  }

  function removeCard(cardName: string, options?: CardPrintingOptions, removedCardData?: T) {
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
    discardAll,
    canUndo,
    undo,
    undoStack,
    incrementCard,
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
