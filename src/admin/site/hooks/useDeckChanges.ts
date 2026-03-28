import { useCallback } from 'preact/hooks'
import { useCardChanges, type UseCardChangesResult } from './useCardChanges'

export type UseDeckChangesResult<T = unknown> = UseCardChangesResult<T> & {
  setCommander: (cardName: string, cardId?: number) => void
  unsetCommander: (cardName: string, cardId?: number) => void
}

export function useDeckChanges<T = unknown>(): UseDeckChangesResult<T> {
  const core = useCardChanges<T>()

  const setCommander = useCallback(
    (cardName: string, cardId?: number) => {
      core.addChange({ action: 'set-commander', cardName, cardId })
    },
    [core.addChange],
  )

  const unsetCommander = useCallback(
    (cardName: string, cardId?: number) => {
      core.addChange({ action: 'unset-commander', cardName, cardId })
    },
    [core.addChange],
  )

  return {
    ...core,
    setCommander,
    unsetCommander,
  }
}
