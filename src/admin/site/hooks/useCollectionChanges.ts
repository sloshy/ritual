import { useCardChanges, type UseCardChangesResult } from './useCardChanges'

export type UseCollectionChangesResult<T = unknown> = UseCardChangesResult<T>

export function useCollectionChanges<T = unknown>(): UseCollectionChangesResult<T> {
  return useCardChanges<T>()
}
