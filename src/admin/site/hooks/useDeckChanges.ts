import { useCardChanges, type UseCardChangesResult } from './useCardChanges'

export type UseDeckChangesResult<T = unknown> = UseCardChangesResult<T> & {
  setCommander: (cardName: string, cardId?: number) => void
  unsetCommander: (cardName: string, cardId?: number) => void
}

export function useDeckChanges<T = unknown>(): UseDeckChangesResult<T> {
  const core = useCardChanges<T>()

  function setCommander(cardName: string, cardId?: number) {
    core.addChange({ action: 'set-commander', cardName, cardId })
  }

  function unsetCommander(cardName: string, cardId?: number) {
    core.addChange({ action: 'unset-commander', cardName, cardId })
  }

  return {
    ...core,
    setCommander,
    unsetCommander,
  }
}
