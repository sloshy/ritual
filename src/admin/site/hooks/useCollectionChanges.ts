import { useCardChanges, type UseCardChangesResult } from './useCardChanges'

export type UseCollectionChangesResult = UseCardChangesResult

export function useCollectionChanges(): UseCollectionChangesResult {
  return useCardChanges()
}
