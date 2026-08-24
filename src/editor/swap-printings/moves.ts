/**
 * From a card's plan to cross-list moves, and from moves to the summary step's
 * totals.
 */

import { displayFinish } from '../../finish-condition'
import { listRefKey, type ListRefKey, type NamedListRef } from '../../site/combined-list'
import { currentPrintingPrice } from './auto'
import { definedPrintingDetails, targetPinsPrinting } from './printing-fields'
import type {
  CardSwapPlan,
  ChosenPrinting,
  DisplacedPolicy,
  PlannedMoves,
  PriceOf,
  SwapAllocation,
  SwapCandidate,
  SwapCardDelta,
  SwapCopyLedger,
  SwapFlag,
  SwapListTotals,
  SwapMove,
  SwapSummary,
  SwapTarget,
} from './types'

/** The printing fields an allocation supplies: the candidate's own, or the chosen one for printingless. */
export type AllocatedPrinting = Pick<
  SwapMove,
  'set' | 'collectorNumber' | 'finish' | 'language' | 'condition' | 'card'
>

/**
 * The printing an allocation brings in — a printing candidate's own, or the
 * printing chosen for a printingless one — or `null` while a printingless pick
 * has no chosen printing yet (the Review step shows such a row without a
 * label; `planMoves` refuses it).
 */
export function allocationPrinting(allocation: SwapAllocation): AllocatedPrinting | null {
  const { candidate, printing } = allocation
  if (candidate.kind === 'printing' && candidate.set && candidate.collectorNumber) {
    return {
      set: candidate.set,
      collectorNumber: candidate.collectorNumber,
      ...definedPrintingDetails(candidate),
      card: candidate.card,
    }
  }
  if (!printing) return null
  return {
    set: printing.set.toLowerCase(),
    collectorNumber: printing.collectorNumber,
    ...definedPrintingDetails(printing),
    finish: printing.finish,
    card: printing.card,
  }
}

/** {@link allocationPrinting} where a printing must exist: a plan being turned into moves. */
function allocatedPrinting(allocation: SwapAllocation): AllocatedPrinting {
  const printing = allocationPrinting(allocation)
  if (printing === null) {
    throw new Error(
      `swap allocation for printingless candidate ${allocation.candidate.key} has no chosen printing`,
    )
  }
  return printing
}

/**
 * Per-copy price of a candidate under the live price source (printingless →
 * null). The one finish rule for a candidate's money — the picker rows, the
 * auto ranking's snapshot and the summary all quote a copy through it, so no
 * two of them price one copy at two finishes.
 */
export function candidatePrice(candidate: SwapCandidate, priceOf: PriceOf): number | null {
  if (candidate.kind !== 'printing') return null
  return priceOf(
    candidate.card,
    displayFinish(candidate.card, candidate.finish),
    candidate.language,
  )
}

/**
 * Hands out the target's line ids to its copies in order: a deck line has one
 * id shared by every copy (repeated), a flat list one id per copy (taken in
 * sequence, `undefined` past the end for legacy lines — never another copy's).
 */
function takeTargetIds(
  target: Pick<SwapTarget, 'cardIds' | 'sharedLine'>,
  cursor: number,
  count: number,
): Array<number | undefined> {
  if (target.sharedLine) return Array.from({ length: count }, () => target.cardIds[0])
  return Array.from({ length: count }, (_, i) => target.cardIds[cursor + i])
}

/**
 * Turn one card's plan into moves against the edited list.
 *
 * Each allocation of `k` copies yields an `in` move (source → edited list)
 * carrying the candidate's printing — or the chosen printing for a printingless
 * candidate — the next `k` unspent copies' source line ids, and the target's
 * deck section; and an `out` move of `k` displaced copies of the current
 * printing (edited list → destination). The destination is the replacement's
 * source under `swap`, or the override list; a wanted destination (real cards
 * cannot go into a wanted list) is redirected to `wantedFallback`, and with
 * none given the out move is omitted and `needs-displaced-destination` is
 * flagged. Out moves to the same destination are merged into one (counts
 * summed, ids concatenated). `in` moves come first, in allocation order.
 *
 * `ledger` tracks copies already spent per candidate key — across this plan's
 * allocations and, when shared, across every plan (see {@link planAllMoves}) —
 * so no source line is named twice. An allocation that outruns the remaining
 * supply is cut down to what is left and flagged `partial`.
 */
export function planMoves(
  plan: CardSwapPlan,
  editedRef: NamedListRef,
  displaced: DisplacedPolicy,
  wantedFallback?: NamedListRef,
  ledger: SwapCopyLedger = new Map(),
): PlannedMoves {
  const { target } = plan
  const inMoves: SwapMove[] = []
  const outMoves = new Map<ListRefKey, SwapMove>()
  const flags: SwapFlag[] = []
  const flag = (value: SwapFlag): void => {
    if (!flags.includes(value)) flags.push(value)
  }
  let idCursor = 0

  for (const allocation of plan.allocations) {
    if (allocation.count <= 0) continue
    const { candidate } = allocation
    const spent = ledger.get(candidate.key) ?? 0
    const copies = candidate.copies.slice(spent, spent + allocation.count)
    const count = copies.length
    ledger.set(candidate.key, spent + count)
    if (count < allocation.count) flag('partial')
    if (count === 0) continue

    const printing = allocatedPrinting(allocation)
    const inMove: SwapMove = {
      direction: 'in',
      cardName: target.cardName,
      count,
      ...printing,
      from: candidate.source,
      to: editedRef,
      sourceCardIds: copies.map((copy) => copy.cardId),
    }
    if (target.section !== undefined) inMove.section = target.section
    inMoves.push(inMove)

    const targetIds = takeTargetIds(target, idCursor, count)
    idCursor += count
    // A name-only target's copies are pinned where they stand: nothing leaves.
    if (!targetPinsPrinting(target)) {
      inMove.pinsCardIds = targetIds
      continue
    }
    const sourceCardIds = targetIds
    let destination = displaced.kind === 'override' ? displaced.to : candidate.source
    if (destination.type === 'wanted') {
      if (!wantedFallback) {
        flag('needs-displaced-destination')
        continue
      }
      destination = wantedFallback
    }
    const key = listRefKey(destination)
    const existing = outMoves.get(key)
    if (existing) {
      existing.count += count
      existing.sourceCardIds.push(...sourceCardIds)
      continue
    }
    outMoves.set(key, {
      direction: 'out',
      cardName: target.cardName,
      count,
      set: target.set.toLowerCase(),
      collectorNumber: target.collectorNumber,
      ...definedPrintingDetails(target),
      from: editedRef,
      to: destination,
      sourceCardIds,
      card: target.card,
    })
  }

  return { moves: [...inMoves, ...outMoves.values()], flags }
}

/**
 * The identity of a replacement pick: the source list and the printing taken
 * from it. One pick covers every pinning `in` move that takes that printing
 * from that list, whichever target cards they fill.
 */
export function replacementKey(
  move: Pick<SwapMove, 'from' | 'set' | 'collectorNumber' | 'finish' | 'language' | 'condition'>,
): string {
  return [
    listRefKey(move.from),
    move.set.toLowerCase(),
    move.collectorNumber,
    move.finish ?? '',
    move.language ?? '',
    move.condition ?? '',
  ].join('|')
}

/** The `in` moves that pin a name-only target's copies — the ones a replacement can be chosen for. */
export function pinningMoves(moves: readonly SwapMove[]): SwapMove[] {
  return moves.filter((move) => move.direction === 'in' && move.pinsCardIds !== undefined)
}

/**
 * The moves with each pinning `in` move's replacement attached from `picks`
 * (keyed by {@link replacementKey}); a move with no pick gets none, and every
 * other move passes through as is. Returns new move objects.
 */
export function attachReplacements(
  moves: readonly SwapMove[],
  picks: ReadonlyMap<string, ChosenPrinting>,
): SwapMove[] {
  return moves.map((move) => {
    if (move.direction !== 'in' || move.pinsCardIds === undefined) return move
    const pick = picks.get(replacementKey(move))
    if (!pick) {
      if (move.replacement === undefined) return move
      const { replacement: _dropped, ...rest } = move
      return rest
    }
    return { ...move, replacement: pick }
  })
}

/**
 * {@link planMoves} over every plan with one shared ledger, so two cards
 * drawing on the same physical copies never both claim them. Moves are
 * concatenated in plan order; flags are the union.
 */
export function planAllMoves(
  plans: readonly CardSwapPlan[],
  editedRef: NamedListRef,
  displaced: DisplacedPolicy,
  wantedFallback?: NamedListRef,
): PlannedMoves {
  const ledger: SwapCopyLedger = new Map()
  const moves: SwapMove[] = []
  const flags: SwapFlag[] = []
  for (const plan of plans) {
    const planned = planMoves(plan, editedRef, displaced, wantedFallback, ledger)
    moves.push(...planned.moves)
    for (const value of planned.flags) if (!flags.includes(value)) flags.push(value)
  }
  return { moves, flags }
}

/** Whether a `swap` policy would send a displaced copy into a wanted list, so a destination must be picked. */
export function displacedDestinationRequired(
  plans: readonly CardSwapPlan[],
  displaced: DisplacedPolicy,
): boolean {
  if (displaced.kind !== 'swap') return false
  return plans.some((plan) =>
    plan.allocations.some(
      (allocation) => allocation.count > 0 && allocation.candidate.source.type === 'wanted',
    ),
  )
}

/** Sum that collapses to null as soon as one term is unknown. */
function sumOrNull(terms: readonly (number | null)[]): number | null {
  let total = 0
  for (const term of terms) {
    if (term === null) return null
    total += term
  }
  return total
}

/** Value per copy of what an allocation brings in, priced fresh so a later price source applies. */
export function allocationPrice(allocation: SwapAllocation, priceOf: PriceOf): number | null {
  const { candidate, printing } = allocation
  if (candidate.kind === 'printing') return candidatePrice(candidate, priceOf)
  return printing ? priceOf(printing.card, printing.finish, printing.language) : null
}

/**
 * The summary step's totals over `plans` and the `moves` planned from them.
 *
 * A card's `before` is its current price × quantity and its `after` is kept
 * copies × current price plus each allocation's count × its printing's price;
 * either is null when any contributing price is unknown (a price only
 * contributes when its copies are non-zero, so a card swapped entirely away
 * from an unpriced printing still prices). The list-wide `before`/`after` are
 * null as soon as one card's is. `lists` counts, per list touched, the copies
 * arriving (`in`) and leaving (`out`) across both ends of every move.
 */
export function summarize(
  plans: readonly CardSwapPlan[],
  moves: readonly SwapMove[],
  priceOf: PriceOf,
): SwapSummary {
  const deltas: SwapCardDelta[] = plans.map((plan) => {
    const current = currentPrintingPrice(plan.target, priceOf)
    const perCopy = (price: number | null, count: number): number | null =>
      count === 0 ? 0 : price === null ? null : price * count
    const before = perCopy(current, plan.target.quantity)
    const after = sumOrNull([
      perCopy(current, plan.keep),
      ...plan.allocations.map((allocation) =>
        perCopy(allocationPrice(allocation, priceOf), allocation.count),
      ),
    ])
    return { cardName: plan.target.cardName, card: plan.target.card, before, after }
  })

  const totals = new Map<ListRefKey, SwapListTotals>()
  const totalsFor = (list: NamedListRef): SwapListTotals => {
    const key = listRefKey(list)
    let entry = totals.get(key)
    if (!entry) {
      entry = { list, in: 0, out: 0 }
      totals.set(key, entry)
    }
    return entry
  }
  for (const move of moves) {
    totalsFor(move.to).in += move.count
    totalsFor(move.from).out += move.count
  }

  return {
    moves: [...moves],
    lists: [...totals.values()],
    before: sumOrNull(deltas.map((d) => d.before)),
    after: sumOrNull(deltas.map((d) => d.after)),
    deltas,
  }
}
