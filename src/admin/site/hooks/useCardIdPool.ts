import { useState, useCallback, useRef } from 'preact/hooks'
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
  const poolRef = useRef<CardIdPool>(createIdPool([]))
  const [pool, setPool] = useState<CardIdPool>(() => createIdPool([]))

  const allocate = useCallback((): number => {
    const next = clonePool(poolRef.current)
    const id = allocateId(next)
    poolRef.current = next
    setPool(poolRef.current)
    return id
  }, [])

  const release = useCallback((id: number): void => {
    const next = clonePool(poolRef.current)
    releaseId(next, id)
    poolRef.current = next
    setPool(poolRef.current)
  }, [])

  const claim = useCallback((id: number): void => {
    const next = clonePool(poolRef.current)
    claimId(next, id)
    poolRef.current = next
    setPool(poolRef.current)
  }, [])

  const resetPool = useCallback((existingIds: number[]): void => {
    poolRef.current = createIdPool(existingIds)
    setPool(poolRef.current)
  }, [])

  const cloneCurrentPool = useCallback((): CardIdPool => {
    return clonePool(poolRef.current)
  }, [])

  return { pool, allocate, release, claim, resetPool, cloneCurrentPool }
}
