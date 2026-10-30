import type { ChangeEvent, ChangeInput } from './change-event'
import type { ListType } from '../list/list-type'
import type { CardLabel } from '../card/card-labels'
import {
  allocateId,
  claimId,
  collectDeckCardIds,
  collectExistingIds,
  createIdPool,
  releaseId,
  type CardIdPool,
  type EntryWithCardId,
} from '../card/card-id'
import type { ApplyBatchResult, ApplyChange, BatchApplyOptions } from './apply-batch'
import { applyChangeToDeck, findDeckAddMergeLine } from './deck-changes'
import { applyChangeToCollection } from './collection-changes'
import { applyChangeToWantedList } from './wanted-changes'
import type { DeckData } from '../list/deck'
import type { CollectionCardEntry, WantedListCardEntry } from '../list/site-data'

/** The two actions that can start a line: an `add`, and a copy arriving by `move-to`. */
export type LineCreatingChange = Extract<ChangeInput, { action: 'add' | 'move-to' }>

/**
 * How a list type's reducer lands a pinning `move-to` (`replacesCardId`):
 * - `split` (decks): in place when `cardId === replacesCardId` (the line keeps
 *   its `&N`); otherwise one copy comes off the pinned line and lands as an
 *   arrival — on the line `cardId` names, else the line the merge rule folds
 *   it onto. A split that would start a line must carry the id for it: the
 *   deck reducer refuses an id-less one.
 * - `in-place` (collections): the pinned entry takes the printing and keeps
 *   its `&N`, whatever `cardId` the event carries.
 * - `append` (wanted lists): the pin is not read; the copy lands like any
 *   arrival.
 */
export type PinLanding = 'split' | 'in-place' | 'append'

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
  /**
   * Whether an `add` / `move-to` whose `cardId` names a line the list holds
   * lands on that line (a deck: the copy joins it). A flat list's reducer
   * appends an entry whatever id it carries, so there such an id is a
   * collision, and the replay gives the new entry a free id instead.
   */
  targetsLiveLine: boolean
  pins: PinLanding
}

/** The part of {@link IdReplayOps} that follows from the list type alone. */
export type IdLanding = Pick<IdReplayOps<unknown>, 'targetsLiveLine' | 'pins'>

/** How each list type's reducer lands a copy — one table, so no caller restates it. */
export const ID_LANDING: Readonly<Record<ListType, IdLanding>> = {
  deck: { targetsLiveLine: true, pins: 'split' },
  collection: { targetsLiveLine: false, pins: 'in-place' },
  wanted: { targetsLiveLine: false, pins: 'append' },
}

/** A deck's {@link IdReplayOps.mergeLine}: the reducer's own merge probe. */
export const deckMergeLine: NonNullable<IdReplayOps<DeckData>['mergeLine']> = (
  deck,
  change,
  listLabels,
) => findDeckAddMergeLine(deck, change, { listLabels })?.card ?? null

/** The id rules of a deck: copies fold onto lines, and a pin may split one. */
export const DECK_ID_OPS: IdReplayOps<DeckData> = {
  // The deck reducer requires the `listLabels` key (present, possibly
  // undefined) so no caller can forget the default; the batch hands it over.
  apply: (deck, change, options) =>
    applyChangeToDeck(deck, change, { ...options, listLabels: options?.listLabels }),
  cardIds: collectDeckCardIds,
  mergeLine: deckMergeLine,
  ...ID_LANDING.deck,
}

/** The id rules of a flat list: one entry per copy, every arrival its own line. */
export function flatIdOps<TEntry extends EntryWithCardId>(
  type: Exclude<ListType, 'deck'>,
  apply: ApplyChange<TEntry[], ChangeEvent>,
): IdReplayOps<TEntry[]> {
  return { apply, cardIds: collectExistingIds, ...ID_LANDING[type] }
}

export const COLLECTION_ID_OPS: IdReplayOps<CollectionCardEntry[]> = flatIdOps(
  'collection',
  applyChangeToCollection,
)

export const WANTED_ID_OPS: IdReplayOps<WantedListCardEntry[]> = flatIdOps(
  'wanted',
  applyChangeToWantedList,
)

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

/**
 * Whether `change` lands a copy as a line of its own or onto one by the merge
 * rule, under the list's {@link PinLanding}. A pin that converts its line in
 * place lands on a line the list already has, so it is given no id.
 */
export function createsLine(change: ChangeEvent, pins: PinLanding): boolean {
  if (change.action === 'add') return true
  if (change.action !== 'move-to') return false
  if (change.replacesCardId === undefined || pins === 'append') return true
  if (pins === 'in-place') return false
  return change.cardId !== change.replacesCardId
}

/** Whether `change` is a deck pin splitting a copy off its line (see {@link PinLanding}). */
const isSplitPin = (change: ChangeEvent): boolean =>
  change.action === 'move-to' &&
  change.replacesCardId !== undefined &&
  change.cardId !== change.replacesCardId

/** `change` with `cardId` set to `cardId`, or without one when it is `undefined`. */
function stampCardId<T extends ChangeEvent>(change: T, cardId: number | undefined): T {
  if (cardId !== undefined) return { ...change, cardId }
  if (!('cardId' in change)) return change
  const { cardId: _dropped, ...rest } = change
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
 * `remove`, a `move-from`, the last copy of a deck line, a split pin that took
 * a line's last copy — has already released its id when a later `add` asks.
 *
 * For each `add` / `move-to` that starts or joins a line ({@link createsLine}):
 * - an id naming a line the list holds is kept where the reducer lands the copy
 *   on that line ({@link IdReplayOps.targetsLiveLine}); on a flat list it is a
 *   collision, and the copy gets a free id like an id-less one;
 * - otherwise, a copy the reducer folds onto an existing line (a deck merge)
 *   takes that line's id and draws nothing — a client's id that names no line
 *   would only be a phantom there;
 * - otherwise a client's own free id is kept (an editor allocated it);
 * - otherwise — no id, or a {@link IdReplayOptions.isProvisional} one — the
 *   smallest free id is drawn. An id a later change in the batch names for a
 *   new line is held back from the draw until that change has applied, so a
 *   stamped add never takes an id a later event is about to create.
 *
 * A collection pin converts its entry in place, so its event is given the
 * pinned entry's id. Misses are collected exactly as
 * `applyChangesCollectingMisses` does.
 */
export function replayAssigningIds<TData>(
  data: TData,
  changes: readonly ChangeEvent[],
  ops: IdReplayOps<TData>,
  options: IdReplayOptions<TData> = {},
): IdReplayResult<TData> {
  const isProvisional = options.isProvisional ?? (() => false)

  // The explicit id each line-creating change names, and how many changes
  // still to come name each one: those ids are held back from the draw.
  const namedIds = changes.map((change) =>
    (change.action === 'add' || change.action === 'move-to') &&
    createsLine(change, ops.pins) &&
    change.cardId !== undefined &&
    !isProvisional(change.cardId)
      ? change.cardId
      : undefined,
  )
  const heldBack = new Map<number, number>()
  for (const id of namedIds) {
    if (id !== undefined) heldBack.set(id, (heldBack.get(id) ?? 0) + 1)
  }

  /** Placeholder → the id its line got (`undefined`: a merge onto an id-less line). */
  const resolved = new Map<number, number | undefined>()

  let current = data
  // The list's live ids and the pool, kept in step across changes that only
  // add a line or join one, and re-read from the list after anything else.
  let state: IdState | null = null

  const unmatched: IdReplayResult<TData>['unmatched'] = []
  const applied: ChangeEvent[] = []
  for (const [index, original] of changes.entries()) {
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
      change = stampCardId(change, resolved.get(placeholder))
    }

    /** The id this change adds to the live set, when that is all it does to the ids. */
    let landed: number | undefined
    let idsSettled = false
    /** Whether this change is the one that resolved its placeholder. */
    let resolvedHere = false
    if ((change.action === 'add' || change.action === 'move-to') && createsLine(change, ops.pins)) {
      if (state === null) {
        const ids = new Set(ops.cardIds(current))
        state = { live: ids, pool: createIdPool([...ids, ...heldBack.keys()]) }
      }
      const { live, pool } = state
      const id = change.cardId
      const fresh = id === undefined || isProvisional(id)
      if (!fresh && live.has(id) && ops.targetsLiveLine) {
        // Names a line the list holds: the reducer lands the copy on it.
        idsSettled = true
      } else {
        const merge = ops.mergeLine?.(current, change, options.listLabels)
        let cardId: number | undefined
        if (merge) {
          cardId = merge.cardId
          idsSettled = true
        } else if (!fresh && !live.has(id)) {
          cardId = id
          claimId(pool, id)
          landed = id
        } else if (id === undefined && ops.pins === 'split' && isSplitPin(change)) {
          // A client's id-less split that would start a line: left as sent,
          // for the reducer to refuse (an id is what the line would need).
          cardId = undefined
        } else {
          cardId = allocateId(pool)
          landed = cardId
        }
        if (placeholder !== undefined && !resolved.has(placeholder)) {
          resolved.set(placeholder, cardId)
          resolvedHere = true
        }
        change = stampCardId(change, cardId)
      }
    } else if (
      ops.pins === 'in-place' &&
      change.action === 'move-to' &&
      change.replacesCardId !== undefined &&
      !isProvisional(change.replacesCardId)
    ) {
      // The pinned entry keeps its `&N`: that is the line this event names.
      if (placeholder !== undefined && !resolved.has(placeholder)) {
        resolved.set(placeholder, change.replacesCardId)
        resolvedHere = true
      }
      change = stampCardId(change, change.replacesCardId)
    } else if (placeholder !== undefined && !resolved.has(placeholder)) {
      // A reference to a line this batch never created: no id to aim at, so
      // the reducer falls back to the card's name.
      change = stampCardId(change, undefined)
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
    // A change that missed landed nowhere, so the placeholder it resolved
    // names nothing: later references fall back to the card's name.
    if (missed && resolvedHere && placeholder !== undefined) resolved.delete(placeholder)
    // A pin may take a line's last copy (a split leaves it at zero), so it is
    // never "only an addition" to the ids.
    const pins = change.action === 'move-to' && change.replacesCardId !== undefined
    if (missed || pins) state = null
    else if (landed !== undefined) state?.live.add(landed)
    else if (!idsSettled) state = null

    // This change no longer holds its id back; free it when nothing else does.
    const named = namedIds[index]
    if (named !== undefined) {
      const left = (heldBack.get(named) ?? 1) - 1
      if (left > 0) heldBack.set(named, left)
      else {
        heldBack.delete(named)
        if (state !== null && !state.live.has(named)) releaseId(state.pool, named)
      }
    }
  }
  return { data: current, unmatched, changes: applied, resolved }
}
