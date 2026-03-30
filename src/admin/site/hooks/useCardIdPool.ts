import { type Accessor, createSignal } from 'solid-js'
import {
  type CardIdPool,
  createIdPool,
  allocateId,
  releaseId,
  claimId,
  clonePool,
} from '../../../card-id'

export type UseCardIdPoolResult = {
  pool: Accessor<CardIdPool>
  allocate: () => number
  release: (id: number) => void
  claim: (id: number) => void
  resetPool: (existingIds: number[]) => void
  cloneCurrentPool: () => CardIdPool
}

/**
 * SolidJS hook wrapping CardIdPool with reactive state.
 * Provides allocate/release/claim operations that trigger re-renders.
 */
export function useCardIdPool(): UseCardIdPoolResult {
  let poolRef: CardIdPool = createIdPool([])
  const [pool, setPool] = createSignal<CardIdPool>(poolRef)

  function allocate(): number {
    const next = clonePool(poolRef)
    const id = allocateId(next)
    poolRef = next
    setPool(poolRef)
    return id
  }

  function release(id: number): void {
    const next = clonePool(poolRef)
    releaseId(next, id)
    poolRef = next
    setPool(poolRef)
  }

  function claim(id: number): void {
    const next = clonePool(poolRef)
    claimId(next, id)
    poolRef = next
    setPool(poolRef)
  }

  function resetPool(existingIds: number[]): void {
    poolRef = createIdPool(existingIds)
    setPool(poolRef)
  }

  function cloneCurrentPool(): CardIdPool {
    return clonePool(poolRef)
  }

  return { pool, allocate, release, claim, resetPool, cloneCurrentPool }
}
