/**
 * Persistent card ID pool for deck, collection, and wanted lists.
 *
 * Each card entry in a list gets a stable sequential numeric ID (`&N`).
 * When cards are removed, their IDs go into a reuse pool.
 * New allocations take the smallest available ID from the pool first,
 * then fall back to the next sequential number.
 */

import type { DeckData } from './types'

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

/** Release an ID back to the pool (card removed). No-op if the ID was never allocated. */
export function releaseId(pool: CardIdPool, id: number): void {
  // Releasing an unknown ID must not pollute the pool — otherwise allocateId
  // would hand out an ID no card ever had. This also makes double-release safe
  // since the second call sees the ID is no longer in usedIds.
  if (!pool.usedIds.has(id)) return
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

/** The id remapping produced by {@link repackSessionIds}. */
export type RepackResult = {
  /** Old id → new id for every surviving session entry whose id changed. */
  remap: Map<number, number>
  /** The single id freed back to the pool (the largest of the session ids). */
  releasedId: number
}

/**
 * Re-pack the ids a session allocated after one of its entries is discarded, so the
 * survivors stay dense and in add order. `allSessionIds` is the set of ids in use
 * just before the discard (including the discarded one); `survivorIdsInAddOrder` is
 * the survivors' current ids in the order they were added. The survivors are
 * reassigned the smallest `survivorIdsInAddOrder.length` of the sorted session ids,
 * and the largest session id is released.
 *
 * Pure: the caller applies `remap` to entries / changelog events and calls
 * {@link releaseId} with `releasedId`. Only the ids passed in are touched, so
 * pre-existing (non-session) entries are unaffected. Returns `releasedId: -1` and an
 * empty remap when there is nothing to release (no session ids).
 */
export function repackSessionIds(
  allSessionIds: number[],
  survivorIdsInAddOrder: number[],
): RepackResult {
  if (allSessionIds.length === 0) return { remap: new Map(), releasedId: -1 }
  const sorted = [...allSessionIds].sort((a, b) => a - b)
  const releasedId = sorted[sorted.length - 1]!
  const keep = sorted.slice(0, survivorIdsInAddOrder.length)
  const remap = new Map<number, number>()
  survivorIdsInAddOrder.forEach((oldId, i) => {
    const newId = keep[i]!
    if (newId !== oldId) remap.set(oldId, newId)
  })
  return { remap, releasedId }
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

/** Create a deep copy of a CardIdPool for snapshotting. */
export function clonePool(pool: CardIdPool): CardIdPool {
  return {
    usedIds: new Set(pool.usedIds),
    availablePool: [...pool.availablePool],
    nextSequential: pool.nextSequential,
  }
}

export type EntryWithCardId = { cardId?: number }
type DeckWithCardIds = {
  sections: readonly { cards: readonly EntryWithCardId[] }[]
}

/** Pull `cardId` numbers off a flat list of entries, dropping anything that's missing one. */
export function collectExistingIds(items: readonly EntryWithCardId[]): number[] {
  const ids: number[] = []
  for (const item of items) {
    if (item.cardId !== undefined) ids.push(item.cardId)
  }
  return ids
}

/** Like {@link collectExistingIds} but walks a deck's nested `sections[].cards[]`. */
export function collectDeckCardIds(deck: DeckWithCardIds): number[] {
  const ids: number[] = []
  for (const section of deck.sections) {
    for (const card of section.cards) {
      if (card.cardId !== undefined) ids.push(card.cardId)
    }
  }
  return ids
}

/**
 * Resolve one entry's id: keep it when it is present and not already taken by an
 * earlier entry, otherwise draw a fresh one from `pool`. Returned by
 * {@link createIdAssigner}, which owns the "already taken" bookkeeping.
 */
export type CardIdAssigner = (existing: number | undefined) => number

/**
 * Build the id resolver both serialization backfills share.
 *
 * Two entries can reach a serializer wanting the same id — a `move-to` carrying
 * the id it had in the source list, a change bundle replayed onto a list that
 * happens to use that number. Writing both would produce two `&5` lines, and a
 * duplicated id is worse than a missing one: the second copy is unaddressable by
 * every id-keyed surface (`moveCardKey`, `remove_selected_cards`, the editors'
 * entry targeting). First occurrence keeps the id; any later claimant is treated
 * exactly like an entry that arrived without one.
 */
export function createIdAssigner(existingIds: number[]): CardIdAssigner {
  const pool = createIdPool(existingIds)
  const taken = new Set<number>()
  return (existing) => {
    if (existing !== undefined && !taken.has(existing)) {
      taken.add(existing)
      return existing
    }
    const fresh = allocateId(pool)
    taken.add(fresh)
    return fresh
  }
}

/**
 * Return a copy of `deck` in which every card has a `cardId` no other card
 * shares. Existing IDs are preserved; cards that lack one (e.g. cards freshly
 * pulled from a remote sync) — or that repeat an id an earlier card already took
 * — are assigned the smallest available ID from a pool seeded by the deck's
 * existing IDs.
 *
 * This is the in-memory complement to the file-content backfill in
 * `ensure-card-ids.ts`. Callers that build a deck in memory and serialize it
 * (notably `serializeDeckToMarkdown`) use this to guarantee no card line is ever
 * written to disk without a stable, unique ID. The result reuses card objects
 * that already have a usable ID and only allocates new objects for the rest.
 */
export function assignMissingDeckCardIds(deck: DeckData): DeckData {
  return assignDeckCardIds(deck).deck
}

/** One card line's id after assignment, and the id it carried before (if any). */
export interface DeckCardIdAssignment {
  sectionIndex: number
  cardIndex: number
  cardId: number
  /** The id the line arrived with, when that differed from the one it got. */
  previousCardId?: number
}

/** {@link assignDeckCardIds}' output: the healed deck plus what it assigned. */
export interface DeckIdAssignmentResult {
  deck: DeckData
  assignments: DeckCardIdAssignment[]
}

/**
 * {@link assignMissingDeckCardIds}, reporting the id every card line ended up
 * with. Callers that must tell the world which `&N` a save allocated — the deck
 * save route, so its response can carry the new entry's id — need the mapping,
 * not just the healed deck.
 */
export function assignDeckCardIds(deck: DeckData): DeckIdAssignmentResult {
  const assign = createIdAssigner(collectDeckCardIds(deck))
  const assignments: DeckCardIdAssignment[] = []
  const sections = deck.sections.map((section, sectionIndex) => ({
    ...section,
    cards: section.cards.map((card, cardIndex) => {
      const cardId = assign(card.cardId)
      const assignment: DeckCardIdAssignment = { sectionIndex, cardIndex, cardId }
      if (card.cardId !== undefined && card.cardId !== cardId) {
        assignment.previousCardId = card.cardId
      }
      assignments.push(assignment)
      return cardId === card.cardId ? card : { ...card, cardId }
    }),
  }))
  return { deck: { ...deck, sections }, assignments }
}

/**
 * The flat-list (collection / wanted) counterpart of
 * {@link assignMissingDeckCardIds}: every entry comes back with a unique
 * `cardId`, seeded from the ids the list already uses.
 *
 * Flat lists store one entry per physical copy, so an id-less entry is not
 * merely untidy — two copies of the same card would collapse to the same
 * `moveCardKey` and only one of them could ever be moved or removed. The
 * flat serializers call this for the same reason `serializeDeckToMarkdown`
 * calls the deck version: no card line is ever written without an ID.
 */
export function assignMissingEntryIds<T extends EntryWithCardId>(entries: readonly T[]): T[] {
  return assignEntryIds(entries).entries
}

/** One flat entry's id after assignment, and the id it carried before (if any). */
export interface EntryIdAssignment {
  index: number
  cardId: number
  /** The id the entry arrived with, when that differed from the one it got. */
  previousCardId?: number
}

/** {@link assignEntryIds}' output: the healed entries plus what it assigned. */
export interface EntryIdAssignmentResult<T> {
  entries: T[]
  assignments: EntryIdAssignment[]
}

/**
 * {@link assignMissingEntryIds}, reporting the id every entry ended up with —
 * the flat-list counterpart of {@link assignDeckCardIds}, and for the same
 * reason: the save routes answer with the ids they allocated.
 */
export function assignEntryIds<T extends EntryWithCardId>(
  entries: readonly T[],
): EntryIdAssignmentResult<T> {
  const assign = createIdAssigner(collectExistingIds(entries))
  const assignments: EntryIdAssignment[] = []
  const assigned = entries.map((entry, index) => {
    const cardId = assign(entry.cardId)
    const assignment: EntryIdAssignment = { index, cardId }
    if (entry.cardId !== undefined && entry.cardId !== cardId) {
      assignment.previousCardId = entry.cardId
    }
    assignments.push(assignment)
    return cardId === entry.cardId ? entry : { ...entry, cardId }
  })
  return { entries: assigned, assignments }
}
