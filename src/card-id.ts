/**
 * Persistent card ID pool for deck, collection, and wanted lists.
 *
 * Each card entry in a list gets a stable sequential numeric ID (`&N`).
 * When cards are removed, their IDs go into a reuse pool.
 * New allocations take the smallest available ID from the pool first,
 * then fall back to the next sequential number.
 */

export type CardIdPool = {
  /** IDs currently in use */
  usedIds: Set<number>
  /** Released IDs available for reuse, kept sorted ascending */
  availablePool: number[]
  /** Next sequential ID to use when pool is empty */
  nextSequential: number
}

/** Create an ID pool from a list of existing IDs (parsed from a file). */
export function createIdPool(existingIds: number[]): CardIdPool {
  const usedIds = new Set(existingIds)
  const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0

  // Find gaps in the sequence to populate the available pool
  const availablePool: number[] = []
  for (let i = 1; i <= maxId; i++) {
    if (!usedIds.has(i)) {
      availablePool.push(i)
    }
  }

  return {
    usedIds,
    availablePool,
    nextSequential: maxId + 1,
  }
}

/**
 * Initialize an ID pool by auto-assigning sequential IDs to entries that lack them.
 * Returns the pool and the assigned IDs array (parallel to the input).
 */
export function initializePoolFromEntries(
  entryCount: number,
  existingIds: (number | undefined)[],
): PoolInitResult {
  // First pass: collect all existing IDs
  const existing: number[] = []
  for (const id of existingIds) {
    if (id !== undefined) {
      existing.push(id)
    }
  }

  // Create a pool from existing IDs
  const pool = createIdPool(existing)

  // Second pass: assign IDs to entries that don't have one
  const assignedIds: number[] = []
  for (let i = 0; i < entryCount; i++) {
    const existingId = existingIds[i]
    if (existingId !== undefined) {
      assignedIds.push(existingId)
    } else {
      const newId = allocateId(pool)
      assignedIds.push(newId)
    }
  }

  return { pool, assignedIds }
}

export type PoolInitResult = {
  pool: CardIdPool
  assignedIds: number[]
}

export type AllocateFromContentResult = {
  pool: CardIdPool
  nextId: number
}

/** Allocate the next available ID. Takes smallest from pool, then sequential. */
export function allocateId(pool: CardIdPool): number {
  let id: number
  if (pool.availablePool.length > 0) {
    id = pool.availablePool.shift()!
  } else {
    id = pool.nextSequential
    pool.nextSequential++
  }
  pool.usedIds.add(id)
  return id
}

/** Release an ID back to the pool (card removed). */
export function releaseId(pool: CardIdPool, id: number): void {
  pool.usedIds.delete(id)

  // Insert into sorted position in the available pool
  const insertIdx = pool.availablePool.findIndex((v) => v > id)
  if (insertIdx === -1) {
    pool.availablePool.push(id)
  } else {
    pool.availablePool.splice(insertIdx, 0, id)
  }
}

/** Claim a specific ID (for undo of removal). Removes from pool if present. */
export function claimId(pool: CardIdPool, id: number): void {
  pool.usedIds.add(id)

  const idx = pool.availablePool.indexOf(id)
  if (idx !== -1) {
    pool.availablePool.splice(idx, 1)
  }

  // If the claimed ID equals or exceeds nextSequential, bump it
  if (id >= pool.nextSequential) {
    pool.nextSequential = id + 1
  }
}

/** Parse all &N card IDs from file content (any format). */
export function parseCardIdsFromContent(content: string): number[] {
  const ids: number[] = []
  for (const line of content.split('\n')) {
    const idMatch = line.match(/&(\d+)\s*$/)
    if (idMatch?.[1]) {
      ids.push(Number.parseInt(idMatch[1], 10))
    }
  }
  return ids
}

/** Parse IDs from content, build a pool, and allocate the next available ID. */
export function allocateNextIdFromContent(content: string): AllocateFromContentResult {
  const existingIds = parseCardIdsFromContent(content)
  const { pool } = initializePoolFromEntries(existingIds.length, existingIds)
  const nextId = allocateId(pool)
  return { pool, nextId }
}

/**
 * Initialize entries with sequential card IDs and file order indices.
 * Wraps initializePoolFromEntries for the common Collection/WantedList pattern.
 */
export function initializeEntriesWithIds<T extends { cardId?: number }>(
  rawEntries: T[],
): { entries: (T & { fileOrder: number; cardId: number })[]; pool: CardIdPool } {
  const withFileOrder = rawEntries.map((e, i) => ({ ...e, fileOrder: i }))
  const existingIds = withFileOrder.map((e) => e.cardId)
  const { pool, assignedIds } = initializePoolFromEntries(withFileOrder.length, existingIds)
  const entries = withFileOrder.map((e, i) => ({
    ...e,
    cardId: assignedIds[i]!,
  }))
  return { entries, pool }
}

/** Create a deep copy of a CardIdPool for snapshotting. */
export function clonePool(pool: CardIdPool): CardIdPool {
  return {
    usedIds: new Set(pool.usedIds),
    availablePool: [...pool.availablePool],
    nextSequential: pool.nextSequential,
  }
}
