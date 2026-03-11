import { useState, useCallback } from 'preact/hooks'
import {
  type ChangeEvent,
  type CardPrintingOptions,
  createChangeId,
  areOppositeChanges,
} from '../types/deck-changes'

export type UseCollectionChangesResult = {
  changes: ChangeEvent[]
  changeCount: number
  addChange: (change: Omit<ChangeEvent, 'id' | 'timestamp'>) => void
  discardAll: () => void
  incrementCard: (cardName: string) => void
  decrementCard: (cardName: string) => void
  addCard: (cardName: string, options?: CardPrintingOptions) => void
  removeCard: (cardName: string, options?: CardPrintingOptions) => void
  setFinish: (cardName: string, finish: string) => void
}

export function useCollectionChanges(): UseCollectionChangesResult {
  const [changes, setChanges] = useState<ChangeEvent[]>([])

  const addChange = useCallback((partial: Omit<ChangeEvent, 'id' | 'timestamp'>) => {
    const newEvent: ChangeEvent = {
      ...partial,
      id: createChangeId(),
      timestamp: Date.now(),
    }

    setChanges((prev) => {
      // Check if this change cancels out an existing one
      const oppositeIndex = prev.findIndex((existing) => areOppositeChanges(existing, newEvent))

      if (oppositeIndex !== -1) {
        // Remove the opposite change — they cancel out
        return prev.filter((_, i) => i !== oppositeIndex)
      }

      return [...prev, newEvent]
    })
  }, [])

  const discardAll = useCallback(() => {
    setChanges([])
  }, [])

  const incrementCard = useCallback(
    (cardName: string) => {
      addChange({ action: 'add', cardName })
    },
    [addChange],
  )

  const decrementCard = useCallback(
    (cardName: string) => {
      addChange({ action: 'remove', cardName })
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
    (cardName: string, options?: CardPrintingOptions) => {
      addChange({ action: 'remove', cardName, ...options })
    },
    [addChange],
  )

  const setFinish = useCallback(
    (cardName: string, finish: string) => {
      addChange({ action: 'set-finish', cardName, finish })
    },
    [addChange],
  )

  const changeCount = changes.length

  return {
    changes,
    changeCount,
    addChange,
    discardAll,
    incrementCard,
    decrementCard,
    addCard,
    removeCard,
    setFinish,
  }
}
