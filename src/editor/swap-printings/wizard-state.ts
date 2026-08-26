/**
 * Pure state helpers for the Swap Printings wizard — step routing, the default
 * source scope, per-card manual picks, the sequential auto planner, and the
 * summary's per-list grouping. The component (`SwapPrintingsWizard.tsx`) holds
 * the signals; everything that can be decided without the DOM lives here so it
 * can be unit-tested.
 */

import type { ListType } from '../../list/list-type'
import { listRefKey, type ListRefKey, type NamedListRef } from '../../list-view/combined-list'
import { filterPrintingsByQuery, type FilterablePrinting } from '../../card/collector-query'
import { applyFinishFilter } from './candidates'
import { autoAllocate } from './auto'
import { targetPinsPrinting } from './printing-fields'
import type {
  CardSwapPlan,
  ChosenPrinting,
  FinishFilter,
  PriceOf,
  SwapAllocation,
  SwapAutoOptions,
  SwapCandidate,
  SwapFlag,
  SwapMode,
  SwapMove,
  SwapTarget,
} from './types'

/**
 * The planner's verdicts about a plan's OWN allocations, and the manual
 * hand-off: what a hand-edited plan no longer carries (see
 * {@link setAllocation}). A flag not listed here — `unpriced-candidates`, or a
 * future one — is a fact about the candidates and survives the edit.
 */
const PLANNER_VERDICT_FLAGS: ReadonlySet<SwapFlag> = new Set<SwapFlag>([
  'no-candidates',
  'needs-manual',
  'partial',
])

/** The wizard's steps, in their natural order. */
export type SwapWizardStep =
  | 'cards'
  | 'sources'
  | 'mode'
  | 'pick'
  | 'review'
  | 'replacements'
  | 'summary'

/** Stable identity of a wizard target across steps. */
export function swapTargetKey(target: SwapTarget): string {
  const printing = targetPinsPrinting(target) ? `${target.set}:${target.collectorNumber}` : ''
  return `${target.cardName}|${target.cardIds.join(',')}|${printing}`
}

/** List types left out of the source scope until the user opts in. */
export const DEFAULT_OFF_SOURCE_TYPES = ['wanted'] as const satisfies readonly ListType[]

/**
 * The initial source-scope exclusion: every list of a default-off type (wanted
 * lists, which hold no physical cards). The edited list is not a concern here:
 * the swap controller's provider never lists it (it is the one owner of that
 * rule).
 */
export function defaultSourceExclusion(
  lists: readonly NamedListRef[],
  offTypes: readonly ListType[] = DEFAULT_OFF_SOURCE_TYPES,
): Set<ListRefKey> {
  const excluded = new Set<ListRefKey>()
  for (const ref of lists) {
    if (offTypes.includes(ref.type)) excluded.add(listRefKey(ref))
  }
  return excluded
}

/** A stable identity for one source scope, so a reload only happens when the scope changed. */
export function scopeKey(refs: readonly NamedListRef[]): string {
  return refs.map((ref) => listRefKey(ref)).join(',')
}

/** What shapes a run's route: the mode, the entry point, and whether a pick queue exists. */
export type StepContext = {
  mode: SwapMode
  /** Opened for one card: the Cards step is skipped. */
  singleCard: boolean
  /** The picker was opened from Review ("Change…"), so Back returns there. */
  pickFromReview: boolean
  /** There are cards to pick (manual mode with checked cards, or auto-mode hand-offs). */
  hasPickQueue: boolean
  /**
   * The Replacements step is on the route: the "replace taken copies" option
   * is on and at least one planned move pins a name-only card.
   */
  hasReplacements: boolean
}

/**
 * Which steps the indicator shows for a run: Cards is skipped for a
 * single-card entry, Pick/Review follow the mode, Replacements appears when
 * a replacement can be chosen.
 */
export function visibleSteps(ctx: StepContext): SwapWizardStep[] {
  const steps: SwapWizardStep[] = []
  if (!ctx.singleCard) steps.push('cards')
  steps.push('sources', 'mode')
  if (ctx.mode === 'manual' || ctx.hasPickQueue) steps.push('pick')
  if (ctx.mode !== 'manual') steps.push('review')
  if (ctx.hasReplacements) steps.push('replacements')
  steps.push('summary')
  return steps
}

/** The step before Summary: the planning step the mode ends on. */
function planningEnd(ctx: StepContext): SwapWizardStep {
  if (ctx.mode !== 'manual') return 'review'
  return ctx.hasPickQueue ? 'pick' : 'mode'
}

/** The step after planning: Replacements when it is on the route, else Summary. */
export function afterPlanning(ctx: StepContext): SwapWizardStep {
  return ctx.hasReplacements ? 'replacements' : 'summary'
}

/** Where Back leads from `step`. Pick returns to Review when it was opened from there ("Change…"). */
export function previousStep(step: SwapWizardStep, ctx: StepContext): SwapWizardStep | null {
  switch (step) {
    case 'cards':
      return null
    case 'sources':
      return ctx.singleCard ? null : 'cards'
    case 'mode':
      return 'sources'
    case 'pick':
      return ctx.pickFromReview ? 'review' : 'mode'
    case 'review':
      return 'mode'
    case 'replacements':
      return planningEnd(ctx)
    case 'summary':
      return ctx.hasReplacements ? 'replacements' : planningEnd(ctx)
  }
}

/** Copies already assigned in a plan (everything not kept). */
export function assignedCount(plan: Pick<CardSwapPlan, 'allocations'>): number {
  return plan.allocations.reduce((sum, allocation) => sum + allocation.count, 0)
}

/**
 * Copies of each candidate group (by key) already claimed by the plans of
 * *other* cards, so the picker shows what is genuinely still available and a
 * second card cannot promise the same physical copy. `active` limits the
 * "others" to the cards still checked — a plan left behind by an unchecked
 * card takes part in no move and must not hold supply.
 */
export function consumedByOthers(
  plans: ReadonlyMap<string, CardSwapPlan>,
  currentKey: string,
  active?: ReadonlySet<string>,
): Map<string, number> {
  const consumed = new Map<string, number>()
  for (const [key, plan] of plans) {
    if (key === currentKey) continue
    if (active && !active.has(key)) continue
    for (const allocation of plan.allocations) {
      consumed.set(
        allocation.candidate.key,
        (consumed.get(allocation.candidate.key) ?? 0) + allocation.count,
      )
    }
  }
  return consumed
}

/** A candidate's copies still on offer after other cards' plans took theirs. */
export function remainingAvailable(
  candidate: SwapCandidate,
  consumed: ReadonlyMap<string, number>,
): number {
  return Math.max(0, candidate.available - (consumed.get(candidate.key) ?? 0))
}

/** The limits a take-count control works within. */
export type TakeCountBounds = {
  /** Copies the row can supply (after other cards' claims). */
  available: number
  /** The target's quantity — the most copies a card can hand out in total. */
  quantity: number
  /** Copies the card's other rows already hold. */
  assignedElsewhere: number
}

/** The most copies a take-count control may hold: the row's supply, capped by what the card still has to give out. */
export function takeCountCeiling(opts: TakeCountBounds): number {
  const room = Math.max(0, opts.quantity - opts.assignedElsewhere)
  return Math.max(0, Math.min(opts.available, room))
}

/**
 * The count a take-count control may actually hold: clamped to `[0,
 * available]` and so that the card's allocations never exceed its quantity —
 * the rest of the copies keep the current printing. A non-finite request
 * (an emptied number input) reads as 0.
 */
export function clampTakeCount(requested: number, opts: TakeCountBounds): number {
  if (!Number.isFinite(requested)) return 0
  return Math.min(takeCountCeiling(opts), Math.max(0, Math.floor(requested)))
}

/**
 * Set the copies taken from one candidate in a plan. The count is clamped to
 * the candidate's supply and to the copies the card still has to give out
 * (`clampTakeCount`), so the plan invariant `keep + Σ count === quantity`
 * always holds. A zero count drops the allocation; a printingless candidate
 * keeps its chosen printing when the count changes, and `printing` (when
 * given) replaces it. Returns a new plan; the input is not mutated.
 */
export function setAllocation(
  plan: CardSwapPlan,
  candidate: SwapCandidate,
  count: number,
  printing?: ChosenPrinting,
): CardSwapPlan {
  const others = plan.allocations.filter((a) => a.candidate.key !== candidate.key)
  const existing = plan.allocations.find((a) => a.candidate.key === candidate.key)
  const clamped = clampTakeCount(count, {
    available: candidate.available,
    quantity: plan.target.quantity,
    assignedElsewhere: assignedCount({ allocations: others }),
  })
  const allocations: SwapAllocation[] = [...others]
  if (clamped > 0) {
    const next: SwapAllocation = { candidate, count: clamped }
    const chosen = printing ?? existing?.printing
    if (chosen) next.printing = chosen
    allocations.push(next)
  }
  return {
    ...plan,
    allocations,
    keep: plan.target.quantity - assignedCount({ allocations }),
    // A hand-edited plan says what the user chose: the planner's verdicts no
    // longer describe it (`PLANNER_VERDICT_FLAGS`); the rest still do.
    flags: plan.flags.filter((flag) => !PLANNER_VERDICT_FLAGS.has(flag)),
  }
}

/** An untouched plan: every copy keeps the current printing. */
export function emptyPlan(target: SwapTarget, candidates: readonly SwapCandidate[]): CardSwapPlan {
  return { target, candidates: [...candidates], allocations: [], keep: target.quantity, flags: [] }
}

/**
 * Which candidate rows the picker shows: the finish quick-filter first, then
 * the collector-grammar query over `set`/`collector_number`. Printingless rows
 * have no printing to match and survive only a blank query.
 */
export function filterPickerRows(
  candidates: readonly SwapCandidate[],
  finish: FinishFilter,
  query: string,
): SwapCandidate[] {
  const byFinish = applyFinishFilter(candidates, finish)
  if (query.trim() === '') return byFinish
  type Row = FilterablePrinting & { candidate: SwapCandidate }
  const rows: Row[] = []
  for (const candidate of byFinish) {
    if (candidate.kind !== 'printing' || !candidate.set || !candidate.collectorNumber) continue
    rows.push({ candidate, set: candidate.set, collector_number: candidate.collectorNumber })
  }
  return filterPrintingsByQuery(query, rows).map((row) => row.candidate)
}

/**
 * Run an auto mode over every target in order with cross-card correctness:
 * copies a card takes are withheld from the cards planned after it, so two
 * cards never compete for the same physical copy. Each card's allocations are
 * re-pointed at the *original* candidate objects (the ones `candidatesByKey`
 * holds) so `planAllMoves`'s shared ledger slices their copies correctly.
 */
export function autoPlanAll(
  targets: readonly SwapTarget[],
  candidatesByTarget: (target: SwapTarget) => readonly SwapCandidate[],
  targetKey: (target: SwapTarget) => string,
  opts: SwapAutoOptions,
  priceOf: PriceOf,
): Map<string, CardSwapPlan> {
  const consumed = new Map<string, number>()
  const plans = new Map<string, CardSwapPlan>()
  for (const target of targets) {
    const originals = candidatesByTarget(target)
    const byKey = new Map(originals.map((candidate) => [candidate.key, candidate]))
    const adjusted: SwapCandidate[] = []
    for (const candidate of originals) {
      const taken = consumed.get(candidate.key) ?? 0
      if (taken === 0) {
        adjusted.push(candidate)
        continue
      }
      const copies = candidate.copies.slice(taken)
      if (copies.length === 0) continue
      adjusted.push({ ...candidate, copies, available: copies.length })
    }
    const planned = autoAllocate(target, adjusted, opts, priceOf)
    const allocations: SwapAllocation[] = planned.allocations.map((allocation) => ({
      ...allocation,
      candidate: byKey.get(allocation.candidate.key) ?? allocation.candidate,
    }))
    for (const allocation of allocations) {
      consumed.set(
        allocation.candidate.key,
        (consumed.get(allocation.candidate.key) ?? 0) + allocation.count,
      )
    }
    plans.set(targetKey(target), { ...planned, candidates: [...originals], allocations })
  }
  return plans
}

/** Target keys whose plan the auto mode handed to the manual picker, in order. */
export function needsManualKeys(plans: ReadonlyMap<string, CardSwapPlan>): string[] {
  const keys: string[] = []
  for (const [key, plan] of plans) if (plan.flags.includes('needs-manual')) keys.push(key)
  return keys
}

/** One other list's traffic with the edited list: replacement copies it supplies, displaced copies it receives. */
export type SwapListGroup = {
  list: NamedListRef
  /** `in` moves from this list into the edited list. */
  incoming: SwapMove[]
  /** `out` moves from the edited list into this list. */
  outgoing: SwapMove[]
}

/** Group the planned moves by the *other* list they touch, in first-seen order. */
export function groupMovesByList(moves: readonly SwapMove[]): SwapListGroup[] {
  const groups = new Map<ListRefKey, SwapListGroup>()
  const groupFor = (list: NamedListRef): SwapListGroup => {
    const key = listRefKey(list)
    let group = groups.get(key)
    if (!group) {
      group = { list, incoming: [], outgoing: [] }
      groups.set(key, group)
    }
    return group
  }
  for (const move of moves) {
    if (move.direction === 'in') groupFor(move.from).incoming.push(move)
    else groupFor(move.to).outgoing.push(move)
  }
  return [...groups.values()]
}
