import { describe, expect, test } from 'bun:test'
import { listRefKey } from '../../../src/list-view/combined-list'
import type { CardSwapPlan, SwapMove } from '../../../src/editor/swap-printings'
import {
  afterPlanning,
  assignedCount,
  autoPlanAll,
  clampTakeCount,
  consumedByOthers,
  defaultSourceExclusion,
  emptyPlan,
  filterPickerRows,
  groupMovesByList,
  needsManualKeys,
  previousStep,
  remainingAvailable,
  setAllocation,
  swapTargetKey,
  takeCountCeiling,
  visibleSteps,
} from '../../../src/editor/swap-printings/wizard-state'
import {
  BINDER,
  CUBE,
  DECK,
  WANTS,
  boltLea,
  boltSta,
  makeCandidate,
  makeTarget,
  priceOf,
  printinglessCandidate,
} from './fixtures'

describe('defaultSourceExclusion', () => {
  test('wanted lists start excluded; decks and collections are in scope', () => {
    // The edited list is not the wizard's concern: the swap controller's
    // provider never lists it.
    const excluded = defaultSourceExclusion([BINDER, CUBE, WANTS])
    expect(excluded).toEqual(new Set([listRefKey(WANTS)]))
  })
})

describe('swapTargetKey', () => {
  test('names the card, its line ids and its printing, so two lines of one card stay distinct', () => {
    expect(swapTargetKey(makeTarget({ cardIds: [3, 4] }))).toBe('Lightning Bolt|3,4|m10:146')
    expect(swapTargetKey(makeTarget({ set: 'lea', collectorNumber: '161' }))).not.toBe(
      swapTargetKey(makeTarget()),
    )
  })
})

describe('step routing', () => {
  const manual = {
    mode: 'manual',
    singleCard: false,
    pickFromReview: false,
    hasPickQueue: true,
    hasReplacements: false,
  } as const

  test('visibleSteps follows the mode and the single-card entry', () => {
    expect(visibleSteps(manual)).toEqual(['cards', 'sources', 'mode', 'pick', 'summary'])
    expect(visibleSteps({ ...manual, hasReplacements: true })).toEqual([
      'cards',
      'sources',
      'mode',
      'pick',
      'replacements',
      'summary',
    ])
    expect(visibleSteps({ ...manual, mode: 'most-expensive', hasPickQueue: false })).toEqual([
      'cards',
      'sources',
      'mode',
      'review',
      'summary',
    ])
    expect(visibleSteps({ ...manual, mode: 'least-expensive', singleCard: true })).toEqual([
      'sources',
      'mode',
      'pick',
      'review',
      'summary',
    ])
  })

  test('previousStep: pick returns to review when opened from there, summary to pick in manual mode', () => {
    expect(previousStep('cards', manual)).toBeNull()
    expect(previousStep('sources', manual)).toBe('cards')
    expect(previousStep('sources', { ...manual, singleCard: true })).toBeNull()
    expect(previousStep('pick', manual)).toBe('mode')
    expect(previousStep('pick', { ...manual, pickFromReview: true })).toBe('review')
    expect(previousStep('summary', manual)).toBe('pick')
    // Nothing to pick (no checked card pins a candidate): skip the empty picker.
    expect(previousStep('summary', { ...manual, hasPickQueue: false })).toBe('mode')
    expect(previousStep('summary', { ...manual, mode: 'most-expensive' })).toBe('review')
    expect(previousStep('review', { ...manual, mode: 'most-expensive' })).toBe('mode')
  })

  test('the Replacements step sits between planning and the summary when on the route', () => {
    const withReplacements = { ...manual, hasReplacements: true } as const
    expect(afterPlanning(manual)).toBe('summary')
    expect(afterPlanning(withReplacements)).toBe('replacements')
    expect(previousStep('summary', withReplacements)).toBe('replacements')
    expect(previousStep('replacements', withReplacements)).toBe('pick')
    expect(previousStep('replacements', { ...withReplacements, hasPickQueue: false })).toBe('mode')
    expect(previousStep('replacements', { ...withReplacements, mode: 'least-expensive' })).toBe(
      'review',
    )
  })
})

describe('clampTakeCount / takeCountCeiling', () => {
  test('clamps to the row supply and to the copies the card still has to give out', () => {
    expect(takeCountCeiling({ available: 3, quantity: 4, assignedElsewhere: 0 })).toBe(3)
    expect(takeCountCeiling({ available: 9, quantity: 4, assignedElsewhere: 5 })).toBe(0)
    expect(clampTakeCount(5, { available: 3, quantity: 4, assignedElsewhere: 0 })).toBe(3)
    expect(clampTakeCount(5, { available: 9, quantity: 4, assignedElsewhere: 3 })).toBe(1)
    expect(clampTakeCount(-2, { available: 9, quantity: 4, assignedElsewhere: 0 })).toBe(0)
    expect(clampTakeCount(Number.NaN, { available: 9, quantity: 4, assignedElsewhere: 0 })).toBe(0)
    expect(clampTakeCount(2.7, { available: 9, quantity: 4, assignedElsewhere: 0 })).toBe(2)
  })
})

describe('setAllocation', () => {
  test('drops the planner verdicts about its own allocations but keeps the unpriced fact', () => {
    const flagged: CardSwapPlan = {
      ...emptyPlan(target, [lea, sta]),
      flags: ['partial', 'needs-manual', 'unpriced-candidates', 'no-candidates'],
    }
    expect(setAllocation(flagged, lea, 1).flags).toEqual(['unpriced-candidates'])
  })

  const target = makeTarget({ quantity: 3 })
  const lea = makeCandidate(BINDER, boltLea, 2, 400)
  const sta = makeCandidate(CUBE, boltSta, 1, 10, 'nonfoil', {}, 200)

  test('adds, replaces and drops allocations, keeping the keep count in step', () => {
    let plan = emptyPlan(target, [lea, sta])
    plan = setAllocation(plan, lea, 2)
    expect(plan.allocations).toEqual([{ candidate: lea, count: 2 }])
    expect(plan.keep).toBe(1)
    plan = setAllocation(plan, sta, 1)
    expect(plan.keep).toBe(0)
    plan = setAllocation(plan, lea, 1)
    expect(plan.allocations.map((a) => [a.candidate.key, a.count])).toEqual([
      [sta.key, 1],
      [lea.key, 1],
    ])
    expect(plan.keep).toBe(1)
    plan = setAllocation(plan, sta, 0)
    expect(plan.allocations).toEqual([{ candidate: lea, count: 1 }])
    expect(plan.keep).toBe(2)
  })

  test('an over-asked count is clamped so keep + Σ count === quantity always holds', () => {
    let plan = setAllocation(emptyPlan(target, [lea, sta]), lea, 99)
    expect(plan.allocations).toEqual([{ candidate: lea, count: 2 }])
    expect(plan.keep).toBe(1)
    plan = setAllocation(plan, sta, 99)
    expect(assignedCount(plan) + plan.keep).toBe(target.quantity)
    expect(plan.keep).toBe(0)
  })

  test('a manual pick clears the needs-manual flag and keeps a printingless choice across count changes', () => {
    const printingless = printinglessCandidate(WANTS, 2)
    const chosen = { card: boltLea, set: 'lea', collectorNumber: '161', finish: 'nonfoil' } as const
    let plan: CardSwapPlan = { ...emptyPlan(target, [printingless]), flags: ['needs-manual'] }
    plan = setAllocation(plan, printingless, 1, chosen)
    expect(plan.flags).toEqual([])
    expect(plan.allocations[0]?.printing).toBe(chosen)
    plan = setAllocation(plan, printingless, 2)
    expect(plan.allocations[0]?.printing).toBe(chosen)
    expect(plan.allocations[0]?.count).toBe(2)
  })
})

describe('consumedByOthers / remainingAvailable', () => {
  const lea = makeCandidate(BINDER, boltLea, 3, 400)
  const a = setAllocation(emptyPlan(makeTarget({ cardIds: [1] }), [lea]), lea, 1)
  const b = setAllocation(emptyPlan(makeTarget({ cardIds: [2], quantity: 2 }), [lea]), lea, 2)
  const plans = new Map([
    ['a', a],
    ['b', b],
  ])

  test('other cards’ allocations reduce what a row can still supply', () => {
    expect(remainingAvailable(lea, consumedByOthers(plans, 'a'))).toBe(1)
    expect(remainingAvailable(lea, consumedByOthers(plans, 'b'))).toBe(2)
    expect(remainingAvailable(lea, consumedByOthers(plans, 'c'))).toBe(0)
  })

  test('a plan left behind by an unchecked card holds no supply', () => {
    expect(remainingAvailable(lea, consumedByOthers(plans, 'a', new Set(['a'])))).toBe(3)
    expect(remainingAvailable(lea, consumedByOthers(plans, 'a', new Set(['a', 'b'])))).toBe(1)
  })
})

describe('filterPickerRows', () => {
  const lea = makeCandidate(BINDER, boltLea, 1, 400)
  const staFoil = makeCandidate(CUBE, boltSta, 1, 25, 'foil', {}, 200)
  const printingless = printinglessCandidate(WANTS, 1)
  const all = [lea, staFoil, printingless]

  test('blank query keeps every row the finish filter allows, printingless included', () => {
    expect(filterPickerRows(all, 'any', '')).toEqual(all)
    expect(filterPickerRows(all, 'foil', '')).toEqual([staFoil])
    expect(filterPickerRows(all, 'nonfoil', '  ')).toEqual([lea])
  })

  test('a collector query matches set/number and drops printingless rows', () => {
    expect(filterPickerRows(all, 'any', 'sta')).toEqual([staFoil])
    expect(filterPickerRows(all, 'any', 'lea 161')).toEqual([lea])
    expect(filterPickerRows(all, 'any', 'xyz')).toEqual([])
  })
})

describe('autoPlanAll', () => {
  test('cards planned later cannot take copies an earlier card already claimed', () => {
    const first = makeTarget({ cardIds: [1], quantity: 2 })
    const second = makeTarget({ cardIds: [2], quantity: 2 })
    // Three LEA copies (priced 400) for two cards wanting two each: the second card
    // gets the one left and keeps its other copy.
    const lea = makeCandidate(BINDER, boltLea, 3, 400)
    const plans = autoPlanAll(
      [first, second],
      () => [lea],
      swapTargetKey,
      { mode: 'most-expensive', unpriced: 'ignore', finish: 'any' },
      priceOf,
    )
    const a = plans.get(swapTargetKey(first))
    const b = plans.get(swapTargetKey(second))
    expect(a?.allocations).toEqual([{ candidate: lea, count: 2 }])
    expect(a?.keep).toBe(0)
    expect(b?.allocations).toEqual([{ candidate: lea, count: 1 }])
    expect(b?.keep).toBe(1)
    expect(b?.flags).toContain('partial')
    // Allocations point at the ORIGINAL candidate so the shared move ledger slices its copies.
    expect(b?.allocations[0]?.candidate).toBe(lea)
    expect(b?.candidates).toEqual([lea])
  })

  test('needsManualKeys lists the cards the force policy handed over, in order', () => {
    const unpriced = makeCandidate(BINDER, boltLea, 1, null)
    const priced = makeCandidate(CUBE, boltSta, 1, 10, 'nonfoil', {}, 200)
    const t1 = makeTarget({ cardIds: [1] })
    const t2 = makeTarget({ cardIds: [2] })
    const plans = autoPlanAll(
      [t1, t2],
      (target) => (target.cardIds[0] === 1 ? [unpriced] : [priced]),
      swapTargetKey,
      { mode: 'most-expensive', unpriced: 'force', finish: 'any' },
      priceOf,
    )
    expect(needsManualKeys(plans)).toEqual([swapTargetKey(t1)])
  })
})

describe('groupMovesByList', () => {
  test('groups in-moves by their source and out-moves by their destination, first-seen order', () => {
    const move = (partial: Pick<SwapMove, 'direction' | 'from' | 'to'>): SwapMove => ({
      cardName: 'Lightning Bolt',
      count: 1,
      set: 'lea',
      collectorNumber: '161',
      sourceCardIds: [1],
      card: null,
      ...partial,
    })
    const inFromBinder = move({ direction: 'in', from: BINDER, to: DECK })
    const outToCube = move({ direction: 'out', from: DECK, to: CUBE })
    const outToBinder = move({ direction: 'out', from: DECK, to: BINDER })
    const groups = groupMovesByList([inFromBinder, outToCube, outToBinder])
    expect(groups.map((g) => g.list)).toEqual([BINDER, CUBE])
    expect(groups[0]?.incoming).toEqual([inFromBinder])
    expect(groups[0]?.outgoing).toEqual([outToBinder])
    expect(groups[1]?.outgoing).toEqual([outToCube])
  })
})
