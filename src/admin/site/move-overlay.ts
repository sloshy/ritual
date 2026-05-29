import { type ListType, LIST_TYPES, LIST_TYPE_DISPLAY } from '../../list-type'
import type { Finish, Condition, DeckData } from '../../types'
import type { CollectionCardEntry, WantedListCardEntry } from '../../site/data-types'
import type { ChangeInput } from '../../change-event'
import { isSamePrinting } from '../../change-event'
import { applyChangeToDeck } from './types/deck-changes'
import { applyChangeToCollection } from './types/collection-changes'
import { applyChangeToWantedList } from './types/wanted-changes'
import type { MoveListInfo, MovePhysicalCard } from '../api/move'

/** Opaque `${type}:${slug}` identifier for a list within a move session. */
export type ListId = string

export function listId(type: ListType, slug: string): ListId {
  return `${type}:${slug}`
}

export function listInfoId(list: MoveListInfo): ListId {
  return listId(list.type, list.slug)
}

/** Lists grouped under a single list type, with non-empty groups only. */
export type ListTypeGroup = {
  type: ListType
  label: string
  lists: MoveListInfo[]
}

/**
 * Group lists by type in canonical order, dropping empty groups. Shared by the
 * move page's selector, the destination menu, and the filters panel.
 */
export function groupListsByType(lists: MoveListInfo[]): ListTypeGroup[] {
  return LIST_TYPES.map((type) => ({
    type,
    label: LIST_TYPE_DISPLAY[type].label,
    lists: lists.filter((l) => l.type === type),
  })).filter((g) => g.lists.length > 0)
}

/** Identity of the card a pending move acts on (its printing at the source). */
export type MoveCard = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
}

/** The chosen destination printing — equals the source printing unless it was resolved. */
export type MoveDestPrinting = Pick<MoveCard, 'set' | 'collectorNumber' | 'finish' | 'condition'>

/**
 * One queued move. `from` is always the card's on-disk list; `to` is its current
 * destination (updated in place when a card is re-moved, mirroring the CLI's
 * chained-move collapse). `cardKey` is the opaque physical key the server issued.
 */
export type PendingMove = {
  id: string
  cardKey: string
  from: MoveListInfo
  to: MoveListInfo
  source: MoveCard
  dest: MoveDestPrinting
}

/** The remove change a pending move contributes to its source list's overlay. */
export function removeChangeFor(move: PendingMove): ChangeInput {
  return {
    action: 'remove',
    cardName: move.source.name,
    set: move.source.set,
    collectorNumber: move.source.collectorNumber,
    finish: move.source.finish,
    condition: move.source.condition,
    cardId: move.source.cardId,
  }
}

/**
 * The add change a pending move contributes to its destination list's overlay.
 * No `cardId` is carried: IDs are per-list, so reusing the source ID could collide
 * with a destination entry. The destination allocates its own ID on commit.
 */
export function addChangeFor(move: PendingMove): ChangeInput {
  return {
    action: 'add',
    cardName: move.source.name,
    set: move.dest.set,
    collectorNumber: move.dest.collectorNumber,
    finish: move.dest.finish,
    condition: move.dest.condition,
  }
}

/** Pending moves leaving a given list (its overlay removes them). */
export function movesFrom(pending: PendingMove[], id: ListId): PendingMove[] {
  return pending.filter((m) => listInfoId(m.from) === id)
}

/** Pending moves arriving at a given list (its overlay adds them). */
export function movesTo(pending: PendingMove[], id: ListId): PendingMove[] {
  return pending.filter((m) => listInfoId(m.to) === id)
}

/**
 * Apply a list's pending moves onto freshly-loaded data: first the removes for
 * cards leaving the list, then the adds for cards arriving. Generic over the list
 * shape and its `applyChange` function so deck/collection/wanted share one pass.
 */
function applyOverlay<T>(
  base: T,
  pending: PendingMove[],
  id: ListId,
  applyChange: (data: T, change: ChangeInput) => T,
): T {
  let data = base
  for (const m of movesFrom(pending, id)) data = applyChange(data, removeChangeFor(m))
  for (const m of movesTo(pending, id)) data = applyChange(data, addChangeFor(m))
  return data
}

export function overlayDeck(base: DeckData, pending: PendingMove[], id: ListId): DeckData {
  return applyOverlay(base, pending, id, applyChangeToDeck)
}

export function overlayCollection(
  base: CollectionCardEntry[],
  pending: PendingMove[],
  id: ListId,
): CollectionCardEntry[] {
  return applyOverlay(base, pending, id, applyChangeToCollection)
}

export function overlayWanted(
  base: WantedListCardEntry[],
  pending: PendingMove[],
  id: ListId,
): WantedListCardEntry[] {
  return applyOverlay(base, pending, id, applyChangeToWantedList)
}

/** The fields used to identify the tile a context action was opened for. */
export type TileTarget = {
  cardName: string
  cardIds: number[]
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
}

/**
 * Whether a physical card belongs to the tile the user acted on. Prefers the
 * stable card IDs the tile represents; falls back to name + printing equality
 * (defaults-normalized) when IDs are unavailable.
 */
export function matchesTile(card: MovePhysicalCard, tile: TileTarget): boolean {
  if (card.name !== tile.cardName) return false
  if (tile.cardIds.length > 0 && card.cardId !== undefined) {
    return tile.cardIds.includes(card.cardId)
  }
  return isSamePrinting(card, tile)
}

/**
 * Whether a pending move's currently-landed card matches the tile the user acted
 * on. Moved-in cards render with the move's destination printing and carry no
 * stable id, so they are matched by name + destination printing.
 */
export function pendingMatchesTile(move: PendingMove, tile: TileTarget): boolean {
  return move.source.name === tile.cardName && isSamePrinting(move.dest, tile)
}

/** Inputs to {@link reconcilePendingMoves}. */
export type ReconcileMoveParams = {
  pending: PendingMove[]
  /** The full physical-card index (used to resolve a tile to its source copies). */
  allCards: MovePhysicalCard[]
  /** The list the moved tile currently lives in (the viewed list, or a search row's list). */
  sourceList: MoveListInfo
  target: TileTarget
  /** How many copies to move (1..available). */
  count: number
  dest: MoveListInfo
  /** Resolved destination printing (e.g. a printing chosen for a collection); defaults to the tile's. */
  override?: MoveDestPrinting
  /** Generates a unique id for a newly-queued move. */
  newId: () => string
}

/**
 * Produce the next pending-move list for a requested move. Pure so the queue/
 * retarget/cancel logic can be unit-tested without the reactive hook.
 *
 * Already-queued copies that currently land in `sourceList` are reconciled first:
 * - moving one back to its original list **cancels** the queued move (net no-op), and
 * - moving one onward **retargets** it, collapsing a chain `A → B → C` into `A → C`.
 *
 * Remaining count is then satisfied by queueing fresh moves for not-yet-touched
 * physical copies. A move to the card's own list is a no-op (returns `pending`).
 */
export function reconcilePendingMoves(params: ReconcileMoveParams): PendingMove[] {
  const { pending, allCards, sourceList, target, count, dest, override, newId } = params
  const sourceId = listInfoId(sourceList)
  const destId = listInfoId(dest)
  if (destId === sourceId) return pending

  const pendingKeys = new Set(pending.map((m) => m.cardKey))
  const nativeCards = allCards.filter(
    (c) =>
      listId(c.listType, c.listSlug) === sourceId &&
      matchesTile(c, target) &&
      !pendingKeys.has(c.key),
  )
  const chainMoves = pending.filter(
    (m) => listInfoId(m.to) === sourceId && pendingMatchesTile(m, target),
  )

  let remaining = Math.max(1, count)
  const next = [...pending]
  const destPrinting: MoveDestPrinting = override ?? {
    set: target.set,
    collectorNumber: target.collectorNumber,
    finish: target.finish,
    condition: target.condition,
  }

  // Reconcile already-queued copies first (cancel when returning to origin, else retarget).
  for (const m of chainMoves) {
    if (remaining <= 0) break
    const idx = next.findIndex((p) => p.id === m.id)
    if (idx === -1) continue
    if (destId === listInfoId(m.from)) {
      next.splice(idx, 1)
    } else {
      next[idx] = { ...m, to: dest, dest: destPrinting }
    }
    remaining--
  }

  // Then queue fresh moves for not-yet-touched physical copies.
  for (const card of nativeCards) {
    if (remaining <= 0) break
    next.push({
      id: newId(),
      cardKey: card.key,
      from: sourceList,
      to: dest,
      source: {
        name: card.name,
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        note: card.note,
        cardId: card.cardId,
      },
      dest: destPrinting,
    })
    remaining--
  }

  return next
}

/** A group of identical physical cards within one list — one row/tile in the search view. */
export type CardGroup = {
  listType: ListType
  listSlug: string
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  /** Physical keys of every copy in this group, in load order. */
  keys: string[]
  /** Distinct card IDs the group represents (used to target the exact copies on move). */
  cardIds: number[]
}

function groupKey(card: MovePhysicalCard): string {
  return [
    card.listType,
    card.listSlug,
    card.name,
    card.set ?? '',
    card.collectorNumber ?? '',
    card.finish ?? 'nonfoil',
    card.condition ?? '',
    card.note ?? '',
  ].join('|')
}

/**
 * Collapse identical physical cards (same list, name, printing, finish, condition,
 * note) into groups so a 3-of renders as one row of quantity 3 rather than three rows.
 */
export function groupCards(cards: MovePhysicalCard[]): CardGroup[] {
  const groups = new Map<string, CardGroup>()
  for (const card of cards) {
    const key = groupKey(card)
    const existing = groups.get(key)
    if (existing) {
      existing.keys.push(card.key)
      if (card.cardId !== undefined && !existing.cardIds.includes(card.cardId)) {
        existing.cardIds.push(card.cardId)
      }
    } else {
      groups.set(key, {
        listType: card.listType,
        listSlug: card.listSlug,
        name: card.name,
        set: card.set,
        collectorNumber: card.collectorNumber,
        finish: card.finish,
        condition: card.condition,
        note: card.note,
        keys: [card.key],
        cardIds: card.cardId !== undefined ? [card.cardId] : [],
      })
    }
  }
  return Array.from(groups.values())
}

/** Whether a card requires a specific printing to live in the given destination type. */
export function needsPrintingFor(destType: ListType, dest: MoveDestPrinting): boolean {
  return destType === 'collection' && (!dest.set || !dest.collectorNumber)
}
