/**
 * The auto modes of the swap planner: fill a target's copies from its
 * candidates by price, with the current printing competing as a "keep" option.
 */

import { displayFinish } from '../../finish-condition'
import { applyFinishFilter } from './candidates'
import { targetPinsPrinting } from './printing-fields'
import type {
  CardSwapPlan,
  PriceOf,
  SwapAllocation,
  SwapAutoOptions,
  SwapAutoMode,
  SwapCandidate,
  SwapFlag,
  SwapRankedOption,
  SwapTarget,
} from './types'

/** A ranking row: a priced option with its position in the input. */
type PricedOption = { option: SwapRankedOption; order: number; price: number }

/** The market value of the target's current printing at its displayed finish; null for a name-only line. */
export function currentPrintingPrice(target: SwapTarget, priceOf: PriceOf): number | null {
  if (!targetPinsPrinting(target)) return null
  return priceOf(target.card, displayFinish(target.card, target.finish), target.language)
}

/**
 * Order priced options by price — descending for `most-expensive`, ascending
 * for `least-expensive`. Ties prefer the keep option (no move), then the input
 * order. Unpriced options (`price === null`) are left out: the unpriced policy
 * decides what happens to them before ranking, and only `ignore` reaches here
 * with any present.
 */
export function rankOptions(
  options: readonly SwapRankedOption[],
  mode: SwapAutoMode,
): SwapRankedOption[] {
  const direction = mode === 'most-expensive' ? -1 : 1
  const priced: PricedOption[] = []
  options.forEach((option, order) => {
    if (option.price !== null) priced.push({ option, order, price: option.price })
  })
  priced.sort((a, b) => {
    const byPrice = (a.price - b.price) * direction
    if (byPrice !== 0) return byPrice
    if (a.option.candidate === null) return -1
    if (b.option.candidate === null) return 1
    return a.order - b.order
  })
  return priced.map(({ option }) => option)
}

/**
 * Plan one card under an auto mode.
 *
 * The finish filter narrows the candidates first; an empty pool means
 * `no-candidates` and every copy keeps its printing. The current printing takes
 * part as a keep option priced at its displayed finish. If any option in the
 * pool — the current one included — is unpriced, the unpriced policy applies:
 * `skip` leaves the card alone, `force` hands it to the manual picker, and
 * `ignore` ranks the priced options only; all three flag `unpriced-candidates`.
 * The priced options are then ranked by price and the target's quantity is
 * filled greedily from the best down; copies taken from the keep option stay.
 *
 * `partial` means the card could not be filled to the user's intent: some
 * copies were swapped, and the copies that stayed did so only because every
 * ranked candidate copy was already used (not because keeping beat the
 * remaining candidates). `plan.candidates` holds the unfiltered input so a
 * later manual pick can widen the finish filter again.
 */
export function autoAllocate(
  target: SwapTarget,
  candidates: readonly SwapCandidate[],
  opts: SwapAutoOptions,
  priceOf: PriceOf,
): CardSwapPlan {
  // Printing-less entries (a wanted line, a name-only deck line) are never
  // auto-selectable: a printing has to be chosen for them by hand, and they are
  // not "unpriced printings" in the owner's sense (no market value for a real
  // printing) — so they neither rank nor trip the unpriced policy. The picker
  // still offers them.
  const pool = applyFinishFilter(candidates, opts.finish).filter((c) => c.kind === 'printing')
  const unchanged = (flags: SwapFlag[]): CardSwapPlan => ({
    target,
    candidates: [...candidates],
    allocations: [],
    keep: target.quantity,
    flags,
  })
  if (pool.length === 0) return unchanged(['no-candidates'])

  const options: SwapRankedOption[] = [
    { candidate: null, price: currentPrintingPrice(target, priceOf), available: target.quantity },
    ...pool.map(
      (candidate): SwapRankedOption => ({
        candidate,
        price: candidate.price,
        available: candidate.available,
      }),
    ),
  ]
  const flags: SwapFlag[] = []
  // A name-only target's keep option is "no printing", not an unpriced
  // printing: it never trips the unpriced policy (it is unranked either way,
  // so copies the candidates cannot fill simply stay name-only).
  const unpricedOptions = options.filter(
    (option) => option.price === null && (option.candidate !== null || targetPinsPrinting(target)),
  )
  if (unpricedOptions.length > 0) {
    if (opts.unpriced === 'skip') return unchanged(['unpriced-candidates'])
    if (opts.unpriced === 'force') return unchanged(['needs-manual', 'unpriced-candidates'])
    flags.push('unpriced-candidates')
  }

  const ranked = rankOptions(options, opts.mode)
  const allocations: SwapAllocation[] = []
  let keep = 0
  let remaining = target.quantity
  for (const option of ranked) {
    if (remaining === 0) break
    const count = Math.min(remaining, option.available)
    if (count === 0) continue
    if (option.candidate === null) keep += count
    else allocations.push({ candidate: option.candidate, count })
    remaining -= count
  }
  // Only an unpriced (dropped) keep option leaves copies unfilled; they stay.
  keep += remaining

  const supply = ranked.reduce((sum, o) => (o.candidate === null ? sum : sum + o.available), 0)
  const allocated = allocations.reduce((sum, a) => sum + a.count, 0)
  if (allocations.length > 0 && keep > 0 && allocated === supply) flags.push('partial')

  return { target, candidates: [...candidates], allocations, keep, flags }
}
