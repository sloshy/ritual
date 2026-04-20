import { type Accessor, createSignal, createMemo } from 'solid-js'
import type { Finish } from '../../../types'
import type { ChangeInput } from '../../../change-event'
import {
  type ChangeEvent,
  type CardPrintingOptions,
  createChangeId,
  areOppositeChanges,
  consolidateSetFinish,
} from '../../../change-event'

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
  discardAll: () => void
  canUndo: Accessor<boolean>
  undo: () => UndoResult<T> | null
  undoStack: Accessor<UndoEntry<T>[]>
  incrementCard: (cardName: string, cardId?: number) => void
  decrementCard: (cardName: string, cardId?: number, removedCardData?: T) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  removeCard: (cardName: string, options?: CardPrintingOptions, removedCardData?: T) => void
  setFinish: (cardName: string, finish: Finish, originalFinish: Finish, cardId?: number) => void
}

export function useCardChanges<T = unknown>(): UseCardChangesResult<T> {
  const [changes, setChanges] = createSignal<ChangeEvent[]>([])
  const [undoStack, setUndoStack] = createSignal<UndoEntry<T>[]>([])
  let changesRef: ChangeEvent[] = []
  let undoStackRef: UndoEntry<T>[] = []

  function addChange(partial: ChangeInput, removedCardData?: T): ChangeEvent | null {
    // The spread of a discriminated-union input with id+timestamp is structurally
    // correct at runtime but TypeScript can't verify it; a type assertion is needed.
    const newEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    } as ChangeEvent

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

  const changeCount = createMemo(() => changes().length)
  const canUndo = createMemo(() => undoStack().length > 0)

  return {
    changes,
    changeCount,
    addChange,
    discardAll,
    canUndo,
    undo,
    undoStack,
    incrementCard,
    decrementCard,
    addCard,
    removeCard,
    setFinish,
  }
}
