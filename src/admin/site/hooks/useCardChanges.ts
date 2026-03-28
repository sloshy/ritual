import { useState, useCallback, useRef } from 'preact/hooks'
import type { Finish } from '../../../types'
import type { ChangeInput } from '../../../change-event'
import {
  type ChangeEvent,
  type CardPrintingOptions,
  createChangeId,
  areOppositeChanges,
} from '../types/deck-changes'

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
  changes: ChangeEvent[]
  changeCount: number
  addChange: (change: ChangeInput, removedCardData?: T) => ChangeEvent | null
  discardAll: () => void
  canUndo: boolean
  undo: () => UndoResult<T> | null
  undoStack: UndoEntry<T>[]
  incrementCard: (cardName: string, cardId?: number) => void
  decrementCard: (cardName: string, cardId?: number, removedCardData?: T) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  removeCard: (cardName: string, options?: CardPrintingOptions, removedCardData?: T) => void
  setFinish: (cardName: string, finish: Finish, cardId?: number) => void
}

export function useCardChanges<T = unknown>(): UseCardChangesResult<T> {
  const [changes, setChanges] = useState<ChangeEvent[]>([])
  const [undoStack, setUndoStack] = useState<UndoEntry<T>[]>([])
  const changesRef = useRef<ChangeEvent[]>([])
  const undoStackRef = useRef<UndoEntry<T>[]>([])

  const addChange = useCallback((partial: ChangeInput, removedCardData?: T): ChangeEvent | null => {
    // The spread of a discriminated-union input with id+timestamp is structurally
    // correct at runtime but TypeScript can't verify it; a type assertion is needed.
    const newEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    } as ChangeEvent

    let addedChange: ChangeEvent | null = newEvent
    let cancelledChange: ChangeEvent | null = null

    const oppositeIndex = changesRef.current.findIndex((existing) =>
      areOppositeChanges(existing, newEvent),
    )

    if (oppositeIndex !== -1) {
      cancelledChange = changesRef.current[oppositeIndex] ?? null
      addedChange = null
      changesRef.current = changesRef.current.filter((_, i) => i !== oppositeIndex)
    } else {
      changesRef.current = [...changesRef.current, newEvent]
    }

    undoStackRef.current = [
      ...undoStackRef.current,
      { addedChange, cancelledChange, removedCardData },
    ]

    setChanges([...changesRef.current])
    setUndoStack([...undoStackRef.current])

    return addedChange
  }, [])

  const discardAll = useCallback(() => {
    changesRef.current = []
    undoStackRef.current = []
    setChanges([])
    setUndoStack([])
  }, [])

  const undo = useCallback((): UndoResult<T> | null => {
    if (undoStackRef.current.length === 0) return null

    const entry = undoStackRef.current[undoStackRef.current.length - 1]!
    undoStackRef.current = undoStackRef.current.slice(0, -1)

    let next = changesRef.current
    if (entry.addedChange) {
      next = next.filter((c) => c.id !== entry.addedChange!.id)
    }
    if (entry.cancelledChange) {
      next = [...next, entry.cancelledChange]
    }
    changesRef.current = next

    setUndoStack([...undoStackRef.current])
    setChanges([...changesRef.current])

    return { entry, remainingChanges: changesRef.current }
  }, [])

  const incrementCard = useCallback(
    (cardName: string, cardId?: number) => {
      addChange({ action: 'add', cardName, cardId })
    },
    [addChange],
  )

  const decrementCard = useCallback(
    (cardName: string, cardId?: number, removedCardData?: T) => {
      addChange({ action: 'remove', cardName, cardId }, removedCardData)
    },
    [addChange],
  )

  const addCard = useCallback(
    (cardName: string, options?: CardPrintingOptions) => {
      addChange({ action: 'add', cardName, ...options })
    },
    [addChange],
  )

  const removeCard = useCallback(
    (cardName: string, options?: CardPrintingOptions, removedCardData?: T) => {
      addChange({ action: 'remove', cardName, ...options }, removedCardData)
    },
    [addChange],
  )

  const setFinish = useCallback(
    (cardName: string, finish: Finish, cardId?: number) => {
      addChange({ action: 'set-finish', cardName, finish, cardId })
    },
    [addChange],
  )

  const changeCount = changes.length
  const canUndo = undoStack.length > 0

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
