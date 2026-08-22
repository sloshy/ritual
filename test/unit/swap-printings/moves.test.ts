import { describe, expect, test } from 'bun:test'
import {
  displacedDestinationRequired,
  planAllMoves,
  planMoves,
  summarize,
  type CardSwapPlan,
  type ChosenPrinting,
  type SwapCopyLedger,
  type SwapMove,
} from '../../../src/editor/swap-printings'
import {
  BINDER,
  CUBE,
  DECK,
  WANTS,
  boltLea,
  boltM10,
  boltSta,
  makeCandidate,
  makeTarget,
  priceOf,
  printinglessCandidate,
  uncachedCandidate,
} from './fixtures'

const lea = makeCandidate(BINDER, boltLea, 2, 400, 'nonfoil', {}, 100)
const leaCube = makeCandidate(CUBE, boltLea, 3, 400, 'nonfoil', {}, 400)
const sta = makeCandidate(
  BINDER,
  boltSta,
  3,
  20,
  'nonfoil',
  { condition: 'LP', language: 'ja' },
  500,
)
const chosenSta: ChosenPrinting = {
  card: boltSta,
  set: 'STA',
  collectorNumber: '42',
  finish: 'foil',
}

function plan(overrides: Partial<CardSwapPlan>): CardSwapPlan {
  return {
    target: makeTarget({ quantity: 4, cardIds: [7], finish: 'nonfoil', condition: 'NM' }),
    candidates: [lea, sta],
    allocations: [],
    keep: 0,
    flags: [],
    ...overrides,
  }
}

function shape(move: SwapMove): Partial<SwapMove> {
  const { card: _card, ...rest } = move
  return rest
}

describe('planMoves', () => {
  test('swap policy: in-moves carry the candidate printing and section; out-moves return to each source', () => {
    const { moves, flags } = planMoves(
      plan({
        allocations: [
          { candidate: lea, count: 2 },
          { candidate: sta, count: 1 },
        ],
        keep: 1,
      }),
      DECK,
      { kind: 'swap' },
    )
    expect(flags).toEqual([])
    expect(moves.map(shape)).toEqual([
      {
        direction: 'in',
        cardName: 'Lightning Bolt',
        count: 2,
        set: 'lea',
        collectorNumber: '161',
        finish: 'nonfoil',
        from: BINDER,
        to: DECK,
        sourceCardIds: [100, 101],
        section: 'Main',
      },
      {
        direction: 'in',
        cardName: 'Lightning Bolt',
        count: 1,
        set: 'sta',
        collectorNumber: '42',
        finish: 'nonfoil',
        language: 'ja',
        condition: 'LP',
        from: BINDER,
        to: DECK,
        sourceCardIds: [500],
        section: 'Main',
      },
      // Both displaced batches go to the Binder, so they merge into one move; the
      // deck line's single id repeats per copy.
      {
        direction: 'out',
        cardName: 'Lightning Bolt',
        count: 3,
        set: 'm10',
        collectorNumber: '146',
        finish: 'nonfoil',
        condition: 'NM',
        from: DECK,
        to: BINDER,
        sourceCardIds: [7, 7, 7],
      },
    ])
    expect(moves[0]!.card).toBe(boltLea)
    expect(moves[2]!.card).toBe(boltM10)
  })

  test('out-moves to different sources stay separate and a flat-list target hands out ids in sequence', () => {
    const target = makeTarget({
      quantity: 3,
      cardIds: [11, 12, 13],
      section: undefined,
      set: 'M10',
      language: 'ja',
    })
    const { moves } = planMoves(
      plan({
        target,
        allocations: [
          { candidate: lea, count: 1 },
          { candidate: leaCube, count: 2 },
        ],
      }),
      DECK,
      { kind: 'swap' },
    )
    const outs = moves.filter((m) => m.direction === 'out')
    expect(outs.map((m) => [m.to, m.count, m.sourceCardIds])).toEqual([
      [BINDER, 1, [11]],
      [CUBE, 2, [12, 13]],
    ])
    // The out-move carries the target's language and a lowercased set code.
    expect(outs[0]).toMatchObject({ set: 'm10', language: 'ja' })
    const ins = moves.filter((m) => m.direction === 'in')
    expect(ins.map((m) => m.sourceCardIds)).toEqual([[100], [400, 401]])
    expect(ins.map((m) => m.section)).toEqual([undefined, undefined])
  })

  test('a flat-list target short of ids yields undefined slots past the end', () => {
    const { moves } = planMoves(
      plan({
        target: makeTarget({ quantity: 3, cardIds: [11, 12] }),
        allocations: [{ candidate: leaCube, count: 3 }],
      }),
      DECK,
      { kind: 'swap' },
    )
    expect(moves.find((m) => m.direction === 'out')!.sourceCardIds).toEqual([11, 12, undefined])
  })

  test('override policy sends every displaced copy to the chosen list', () => {
    const { moves } = planMoves(
      plan({
        allocations: [
          { candidate: lea, count: 1 },
          { candidate: leaCube, count: 1 },
        ],
        keep: 2,
      }),
      DECK,
      { kind: 'override', to: CUBE },
    )
    const outs = moves.filter((m) => m.direction === 'out')
    expect(outs).toHaveLength(1)
    expect(outs[0]).toMatchObject({ to: CUBE, count: 2, sourceCardIds: [7, 7] })
  })

  test('a wanted override destination is redirected like a wanted source', () => {
    const planned = plan({ allocations: [{ candidate: lea, count: 1 }], keep: 3 })
    const redirected = planMoves(planned, DECK, { kind: 'override', to: WANTS }, CUBE)
    expect(redirected.moves.find((m) => m.direction === 'out')).toMatchObject({ to: CUBE })
    const unresolved = planMoves(planned, DECK, { kind: 'override', to: WANTS })
    expect(unresolved.moves.map((m) => m.direction)).toEqual(['in'])
    expect(unresolved.flags).toEqual(['needs-displaced-destination'])
  })

  test('a wanted source uses the chosen printing and redirects the displaced copy to the fallback', () => {
    const wanted = printinglessCandidate(WANTS, 2)
    const { moves, flags } = planMoves(
      plan({ allocations: [{ candidate: wanted, count: 1, printing: chosenSta }], keep: 3 }),
      DECK,
      { kind: 'swap' },
      BINDER,
    )
    expect(flags).toEqual([])
    expect(moves.map(shape)).toEqual([
      {
        direction: 'in',
        cardName: 'Lightning Bolt',
        count: 1,
        set: 'sta',
        collectorNumber: '42',
        finish: 'foil',
        from: WANTS,
        to: DECK,
        sourceCardIds: [200],
        section: 'Main',
      },
      {
        direction: 'out',
        cardName: 'Lightning Bolt',
        count: 1,
        set: 'm10',
        collectorNumber: '146',
        finish: 'nonfoil',
        condition: 'NM',
        from: DECK,
        to: BINDER,
        sourceCardIds: [7],
      },
    ])
    expect(moves[0]!.card).toBe(boltSta)
  })

  test('without a fallback a wanted destination drops the out-move and flags it once', () => {
    const wanted = printinglessCandidate(WANTS, 2)
    const chosenLea: ChosenPrinting = {
      card: boltLea,
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
    }
    const { moves, flags } = planMoves(
      plan({
        allocations: [
          { candidate: wanted, count: 1, printing: chosenSta },
          { candidate: wanted, count: 1, printing: chosenLea },
        ],
        keep: 2,
      }),
      DECK,
      { kind: 'swap' },
    )
    // Two allocations of one printingless candidate spend its copies in turn.
    expect(moves.map((m) => [m.direction, m.set, m.sourceCardIds])).toEqual([
      ['in', 'sta', [200]],
      ['in', 'lea', [201]],
    ])
    expect(flags).toEqual(['needs-displaced-destination'])
  })

  test('an explicit English chosen printing is stored as the bare default', () => {
    const { moves } = planMoves(
      plan({
        allocations: [
          {
            candidate: printinglessCandidate(WANTS, 1),
            count: 1,
            printing: { ...chosenSta, language: 'en' },
          },
        ],
        keep: 3,
      }),
      DECK,
      { kind: 'swap' },
      BINDER,
    )
    expect(moves[0]).not.toHaveProperty('language')
  })

  test('a printingless allocation without a chosen printing is a programming error', () => {
    const bad = plan({ allocations: [{ candidate: printinglessCandidate(WANTS, 1), count: 1 }] })
    expect(() => planMoves(bad, DECK, { kind: 'swap' })).toThrow(/no chosen printing/)
  })

  test('zero-count allocations produce no moves', () => {
    const { moves } = planMoves(
      plan({ allocations: [{ candidate: lea, count: 0 }], keep: 4 }),
      DECK,
      {
        kind: 'swap',
      },
    )
    expect(moves).toEqual([])
  })

  test('a legacy source copy without an id leaves an undefined slot of the right length', () => {
    const legacy = makeCandidate(CUBE, boltLea, 2, 400, 'nonfoil', { copies: [{}, { cardId: 4 }] })
    const { moves } = planMoves(
      plan({ allocations: [{ candidate: legacy, count: 2 }], keep: 2 }),
      DECK,
      { kind: 'swap' },
    )
    expect(moves[0]!.sourceCardIds).toEqual([undefined, 4])
  })

  test('a shared ledger stops two plans from naming the same source copies', () => {
    const first = plan({
      target: makeTarget({ quantity: 1, cardIds: [1] }),
      allocations: [{ candidate: lea, count: 1 }],
    })
    const second = plan({
      target: makeTarget({ quantity: 2, cardIds: [2] }),
      allocations: [{ candidate: lea, count: 2 }],
    })
    const { moves, flags } = planAllMoves([first, second], DECK, { kind: 'swap' })
    const ins = moves.filter((m) => m.direction === 'in')
    expect(ins.map((m) => [m.count, m.sourceCardIds])).toEqual([
      [1, [100]],
      [1, [101]],
    ])
    // The second plan's out-move shrinks with it, and the shortfall is flagged.
    expect(moves.filter((m) => m.direction === 'out').map((m) => m.sourceCardIds)).toEqual([
      [1],
      [2],
    ])
    expect(flags).toEqual(['partial'])

    // The same ledger object threads through planMoves directly.
    const ledger: SwapCopyLedger = new Map([[lea.key, 2]])
    expect(planMoves(first, DECK, { kind: 'swap' }, undefined, ledger)).toEqual({
      moves: [],
      flags: ['partial'],
    })
  })
})

describe('displacedDestinationRequired', () => {
  const fromWanted = plan({
    allocations: [{ candidate: printinglessCandidate(WANTS, 1), count: 1 }],
  })
  const fromBinder = plan({ allocations: [{ candidate: lea, count: 1 }] })

  test('true only for a swap policy with a wanted-sourced allocation', () => {
    expect(displacedDestinationRequired([fromBinder, fromWanted], { kind: 'swap' })).toBe(true)
    expect(displacedDestinationRequired([fromBinder], { kind: 'swap' })).toBe(false)
    expect(displacedDestinationRequired([fromWanted], { kind: 'override', to: BINDER })).toBe(false)
  })

  test('a zero-count wanted allocation does not require a destination', () => {
    const zero = plan({ allocations: [{ candidate: printinglessCandidate(WANTS, 1), count: 0 }] })
    expect(displacedDestinationRequired([zero], { kind: 'swap' })).toBe(false)
  })
})

describe('summarize', () => {
  test('totals before/after per card and per list across both ends of every move', () => {
    // Target 4x M10 ($2): 2 from LEA ($400), 1 Japanese STA ($10 x2), keep 1; displaced to the Cube.
    const swapped = plan({
      allocations: [
        { candidate: lea, count: 2 },
        { candidate: sta, count: 1 },
      ],
      keep: 1,
    })
    const { moves } = planMoves(swapped, DECK, { kind: 'override', to: CUBE })
    const summary = summarize([swapped], moves, priceOf)
    expect(summary.deltas).toEqual([
      { cardName: 'Lightning Bolt', card: boltM10, before: 8, after: 822 },
    ])
    expect(summary.before).toBe(8)
    expect(summary.after).toBe(822)
    expect(summary.lists).toEqual([
      { list: DECK, in: 3, out: 3 },
      { list: BINDER, in: 0, out: 3 },
      { list: CUBE, in: 3, out: 0 },
    ])
    expect(summary.moves).toEqual(moves)
    expect(summary.moves).not.toBe(moves)
  })

  test('allocations are priced fresh from priceOf, not from the candidate snapshot', () => {
    const stale = makeCandidate(BINDER, boltLea, 4, 1)
    const swapped = plan({ allocations: [{ candidate: stale, count: 4 }], keep: 0 })
    expect(summarize([swapped], [], priceOf).after).toBe(1600)
  })

  test('an unpriced contribution nulls that card and the list totals, but zero-copy prices never contribute', () => {
    const priced = plan({ allocations: [{ candidate: lea, count: 4 }], keep: 0 })
    const unknownIn = plan({
      allocations: [{ candidate: uncachedCandidate(BINDER, 1), count: 1 }],
      keep: 3,
    })
    const summary = summarize([priced, unknownIn], [], priceOf)
    expect(summary.deltas).toEqual([
      { cardName: 'Lightning Bolt', card: boltM10, before: 8, after: 1600 },
      { cardName: 'Lightning Bolt', card: boltM10, before: 8, after: null },
    ])
    expect(summary.before).toBe(8 + 8)
    expect(summary.after).toBeNull()
    expect(summary.lists).toEqual([])

    // An unpriced current printing swapped entirely away still prices its after.
    const unpricedCurrent = plan({
      target: makeTarget({ quantity: 1, card: null }),
      allocations: [{ candidate: lea, count: 1 }],
      keep: 0,
    })
    const away = summarize([unpricedCurrent], [], priceOf)
    expect(away.deltas).toEqual([
      { cardName: 'Lightning Bolt', card: null, before: null, after: 400 },
    ])
    expect(away.before).toBeNull()
    expect(away.after).toBe(400)
  })

  test('a chosen printing for a printingless candidate is priced at its chosen finish and language', () => {
    const wanted = printinglessCandidate(WANTS, 1)
    const swapped = plan({
      target: makeTarget({ quantity: 1 }),
      allocations: [{ candidate: wanted, count: 1, printing: { ...chosenSta, language: 'ja' } }],
      keep: 0,
    })
    expect(summarize([swapped], [], priceOf).after).toBe(50)
  })
})
