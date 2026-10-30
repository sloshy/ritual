import type { ChangeEvent } from './change-event'
import type { CardLabel } from '../card/card-labels'
import {
  allocateId,
  claimId,
  createIdPool,
  type CardIdPool,
  type EntryWithCardId,
} from '../card/card-id'
import type { ApplyBatchResult, ApplyChange, BatchApplyOptions } from './apply-batch'
import { findDeckAddMergeLine } from './deck-changes'
import type { DeckData } from '../list/deck'

/** The two actions that can start a line: an `add`, and a copy arriving by `move-to`. */
export type LineCreatingChange = Extract<ChangeEvent, { action: 'add' | 'move-to' }>

/** What {@link replayAssigningIds} needs to know about one list type. */
export type IdReplayOps<TData> = {
  apply: ApplyChange<TData, ChangeEvent>
  /** Every `&N` the list carries as it stands. */
  cardIds: (data: TData) => number[]
  /**
   * The line an `add` / `move-to` folds onto under the reducer's own merge rule,
   * or `null` when it starts a line of its own. Omitted for a list that never
   * merges (a flat list holds one entry per copy).
   */
  mergeLine?: (
    data: TData,
    change: LineCreatingChange,
    listLabels: readonly CardLabel[] | undefined,
  ) => EntryWithCardId | null
}

/** A deck's {@link IdReplayOps.mergeLine}: the reducer's own merge probe. */
export const deckMergeLine: NonNullable<IdReplayOps<DeckData>['mergeLine']> = (
  deck,
  change,
  listLabels,
) => findDeckAddMergeLine(deck, change, { listLabels })?.card ?? null

/** What {@link replayAssigningIds} takes beyond the batch. */
export type IdReplayOptions<TData> = BatchApplyOptions<TData, ChangeEvent> & {
  /**
   * Ids that stand for "the line this batch creates", not for any line of the
   * list — the bundle import's placeholders. The first line-creating change
   * carrying one is given a real id as though it carried none, and every later
   * change naming the placeholder is re-aimed at that id.
   */
  isProvisional?: (id: number) => boolean
}

/** The replay's result: the list, the misses, and the batch as it was applied (ids stamped). */
export type IdReplayResult<TData> = ApplyBatchResult<TData, ChangeEvent> & {
  changes: ChangeEvent[]
  /** Each placeholder ({@link IdReplayOptions.isProvisional}) → the id its line got. */
  resolved: ReadonlyMap<number, number | undefined>
}

/** The ids live on the list right now, and the pool the next new line draws from. */
type IdState = { live: Set<number>; pool: CardIdPool }

/** Whether `change` lands a copy as a line of its own or onto one by the merge rule. */
export function createsLine(change: ChangeEvent): change is LineCreatingChange {
  if (change.action === 'add') return true
  // A pin that converts its line in place (`cardId === replacesCardId`) lands
  // on a line the list already has; a split pin lands like any arrival.
  return (
    change.action === 'move-to' &&
    (change.replacesCardId === undefined || change.cardId !== change.replacesCardId)
  )
}

/** A change that may carry an `&N`, as {@link withCardId} sees it. */
type MaybeCardId = { cardId?: number }

/** `change` with `cardId` set to `cardId`, or without one when it is `undefined`. */
function withCardId<T extends ChangeEvent>(change: T, cardId: number | undefined): T {
  if (cardId !== undefined) return { ...change, cardId }
  if (!('cardId' in change)) return change
  const { cardId: _dropped, ...rest } = change as T & MaybeCardId
  return rest as T
}

/**
 * Replay `changes` over `data` in order, giving every line a change creates the
 * `&N` the list's id rule says it gets **at that point in the batch** — and
 * writing it onto the event, so the changelog records exactly what the reducer
 * applied.
 *
 * The rule (AGENTS.md "Card IDs"): a line that leaves the list releases its id,
 * and a new line takes the smallest free one. The pool is the list's own ids as
 * they stand just before each change, so a removal earlier in the batch — a
 * `remove`, a `move-from`, the last copy of a deck line — has already released
 * its id when a later `add` asks.
 *
 * For each `add` / `move-to` that starts or joins a line:
 * - an id naming a line the list holds is kept (the reducer targets that line);
 * - otherwise, a copy the reducer folds onto an existing line (a deck merge)
 *   takes that line's id and draws nothing — a client's id that names no line
 *   would only be a phantom there;
 * - otherwise a client's own free id is kept (an editor allocated it);
 * - otherwise — no id, or a {@link IdReplayOptions.isProvisional} one — the
 *   smallest free id is drawn. Ids that other changes in the batch name for
 *   new lines are held back from the draw, so a stamped add never takes an id
 *   a later event is about to create.
 *
 * Misses are collected exactly as `applyChangesCollectingMisses` does.
 */
export function replayAssigningIds<TData>(
  data: TData,
  changes: readonly ChangeEvent[],
  ops: IdReplayOps<TData>,
  options: IdReplayOptions<TData> = {},
): IdReplayResult<TData> {
  const isProvisional = options.isProvisional ?? (() => false)
  const baselineIds = new Set(ops.cardIds(data))
  const reserved: number[] = []
  for (const change of changes) {
    if (!createsLine(change) || change.cardId === undefined) continue
    if (!isProvisional(change.cardId) && !baselineIds.has(change.cardId)) {
      reserved.push(change.cardId)
    }
  }

  /** Placeholder → the id its line got (`undefined`: a merge onto an id-less line). */
  const resolved = new Map<number, number | undefined>()

  let current = data
  // The list's live ids and the pool, kept in step across changes that only
  // add a line or join one, and re-read from the list after anything else.
  let state: IdState | null = null

  const unmatched: IdReplayResult<TData>['unmatched'] = []
  const applied: ChangeEvent[] = []
  for (const original of changes) {
    let change = original
    // Re-aim references to a placeholder this batch already resolved.
    if (
      change.action === 'move-to' &&
      change.replacesCardId !== undefined &&
      isProvisional(change.replacesCardId)
    ) {
      const pinned = resolved.get(change.replacesCardId)
      if (pinned !== undefined) change = { ...change, replacesCardId: pinned }
    }
    const placeholder =
      'cardId' in change && change.cardId !== undefined && isProvisional(change.cardId)
        ? change.cardId
        : undefined
    if (placeholder !== undefined && resolved.has(placeholder)) {
      change = withCardId(change, resolved.get(placeholder))
    }

    /** The id this change adds to the live set, when that is all it does to the ids. */
    let landed: number | undefined
    let idsSettled = false
    if (createsLine(change)) {
      if (state === null) {
        const live = new Set(ops.cardIds(current))
        state = { live, pool: createIdPool([...live, ...reserved]) }
      }
      const { live, pool } = state
      const id = change.cardId
      const fresh = id === undefined || isProvisional(id)
      if (!fresh && live.has(id)) {
        // Names a line the list holds: the reducer targets it.
        idsSettled = true
      } else {
        const merge = ops.mergeLine?.(current, change, options.listLabels)
        let cardId: number | undefined
        if (merge) {
          cardId = merge.cardId
          idsSettled = true
        } else if (!fresh) {
          cardId = id
          claimId(pool, id)
          landed = id
        } else {
          cardId = allocateId(pool)
          landed = cardId
        }
        if (placeholder !== undefined && !resolved.has(placeholder)) {
          resolved.set(placeholder, cardId)
        }
        change = withCardId(change, cardId)
      }
    } else if (placeholder !== undefined && !resolved.has(placeholder)) {
      // A reference to a line this batch never created: no id to aim at, so
      // the reducer falls back to the card's name.
      change = withCardId(change, undefined)
    }

    options.before?.(current, change)
    let missed = false
    const target = change
    current = ops.apply(current, change, {
      listLabels: options.listLabels,
      onMiss: (reason) => {
        missed = true
        unmatched.push({ change: target, reason })
      },
    })
    applied.push(change)
    // A creating change that missed made no line, so its placeholder names
    // nothing: later references fall back to the card's name.
    if (missed && placeholder !== undefined && resolved.get(placeholder) === landed) {
      resolved.delete(placeholder)
    }
    if (!missed && landed !== undefined) state?.live.add(landed)
    else if (missed || !idsSettled) state = null
  }
  return { data: current, unmatched, changes: applied, resolved }
}
