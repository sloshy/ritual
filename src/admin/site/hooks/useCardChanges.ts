import { useState, useCallback } from 'preact/hooks'
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

  const addChange = useCallback((partial: ChangeInput, removedCardData?: T): ChangeEvent | null => {
    // The spread of a discriminated-union input with id+timestamp is structurally
    // correct at runtime but TypeScript can't verify it; a type assertion is needed.
    const newEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    } as ChangeEvent

    const ref = {
      addedChange: newEvent as ChangeEvent | null,
      cancelledChange: null as ChangeEvent | null,
    }

    setChanges((prev) => {
      const oppositeIndex = prev.findIndex((existing) => areOppositeChanges(existing, newEvent))

      if (oppositeIndex !== -1) {
        ref.cancelledChange = prev[oppositeIndex] ?? null
        ref.addedChange = null
        return prev.filter((_, i) => i !== oppositeIndex)
      }

      return [...prev, newEvent]
    })

    setUndoStack((prev) => [
      ...prev,
      { addedChange: ref.addedChange, cancelledChange: ref.cancelledChange, removedCardData },
    ])

    return ref.addedChange
  }, [])

  const discardAll = useCallback(() => {
    setChanges([])
    setUndoStack([])
  }, [])

  const undo = useCallback((): UndoResult<T> | null => {
    // Use a mutable container because setState callback modifies the value,
    // but TypeScript's narrowing doesn't track mutations inside closures.
    const ref: { entry: UndoEntry<T> | null } = { entry: null }

    setUndoStack((prev) => {
      if (prev.length === 0) return prev
      ref.entry = prev[prev.length - 1] ?? null
      return prev.slice(0, -1)
    })

    if (!ref.entry) return null

    const undoEntry = ref.entry
    let remainingChanges: ChangeEvent[] = []
    setChanges((prev) => {
      let next = prev
      if (undoEntry.addedChange) {
        next = next.filter((c) => c.id !== undoEntry.addedChange!.id)
      }
      if (undoEntry.cancelledChange) {
        next = [...next, undoEntry.cancelledChange]
      }
      remainingChanges = next
      return next
    })

    return { entry: undoEntry, remainingChanges }
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
