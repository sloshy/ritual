import { useState, useCallback } from 'preact/hooks'
import {
  type CardIdPool,
  createIdPool,
  allocateId,
  releaseId,
  claimId,
  clonePool,
} from '../../../card-id'

export type UseCardIdPoolResult = {
  pool: CardIdPool
  allocate: () => number
  release: (id: number) => void
  claim: (id: number) => void
  resetPool: (existingIds: number[]) => void
  cloneCurrentPool: () => CardIdPool
}

/**
 * Preact hook wrapping CardIdPool with reactive state.
 * Provides allocate/release/claim operations that trigger re-renders.
 */
export function useCardIdPool(): UseCardIdPoolResult {
  const [pool, setPool] = useState<CardIdPool>(() => createIdPool([]))

  const allocate = useCallback((): number => {
    let allocated = 0
    setPool((prev) => {
      const next = clonePool(prev)
      allocated = allocateId(next)
      return next
    })
    return allocated
  }, [])

  const release = useCallback((id: number): void => {
    setPool((prev) => {
      const next = clonePool(prev)
      releaseId(next, id)
      return next
    })
  }, [])

  const claim = useCallback((id: number): void => {
    setPool((prev) => {
      const next = clonePool(prev)
      claimId(next, id)
      return next
    })
  }, [])

  const resetPool = useCallback((existingIds: number[]): void => {
    setPool(createIdPool(existingIds))
  }, [])

  const cloneCurrentPool = useCallback((): CardIdPool => {
    return clonePool(pool)
  }, [pool])

  return { pool, allocate, release, claim, resetPool, cloneCurrentPool }
}
