import { useCallback } from 'preact/hooks'
import { useCardChanges, type UseCardChangesResult } from './useCardChanges'

export type UseDeckChangesResult = UseCardChangesResult & {
  setCommander: (cardName: string) => void
  unsetCommander: (cardName: string) => void
}

export function useDeckChanges(): UseDeckChangesResult {
  const core = useCardChanges()

  const setCommander = useCallback(
    (cardName: string) => {
      core.addChange({ action: 'set-commander', cardName })
    },
    [core.addChange],
  )

  const unsetCommander = useCallback(
    (cardName: string) => {
      core.addChange({ action: 'unset-commander', cardName })
    },
    [core.addChange],
  )

  return {
    ...core,
    setCommander,
    unsetCommander,
  }
}
