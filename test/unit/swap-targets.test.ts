import { describe, expect, test } from 'bun:test'
import type { DeckData } from '../../src/types'
import type { ChangeInput } from '../../src/change-event'
import type { CardContextInfo } from '../../src/site/card-context'
import type { SwapMove, SwapTarget } from '../../src/editor/swap-printings'
import {
  buildSwapRequest,
  deckSwapMergeTargetId,
  deckSwapTargets,
  flatSwapTargets,
  preselectedKeysFor,
  swapMovesToChanges,
  type SwapApplyContext,
  type SwapChangeOp,
  type SwapTargetCardData,
} from '../../src/editor/swap-targets'
import { swapTargetKey } from '../../src/editor/components/SwapPrintingsWizard'
import type { SwapFlatLine } from '../../src/editor/swap-sources'
import { makeScryfallCard } from '../test-utils'
import { BINDER, CUBE, DECK, boltFoilOnly, boltLea, boltM10 } from './swap-printings/fixtures'

/** A Sol Ring printing that only the `cards` map knows (not in the per-name printings). */
const solRingC21 = makeScryfallCard({
  id: 'sol-c21',
  name: 'Sol Ring',
  set: 'c21',
  collector_number: '263',
})
/** A different Sol Ring printing: the by-name representative in `cards`. */
const solRingCmr = makeScryfallCard({
  id: 'sol-cmr',
  name: 'Sol Ring',
  set: 'cmr',
  collector_number: '1',
})

const cardData: SwapTargetCardData = {
  cards: { 'Lightning Bolt': boltM10, 'Sol Ring': solRingCmr, 'c21:263': solRingC21 },
  printings: { 'Lightning Bolt': [boltLea, boltM10, boltFoilOnly] },
}

function deck(sections: DeckData['sections']): DeckData {
  return { name: 'Edited Deck', sections }
}

describe('deckSwapTargets', () => {
  test('pinned lines become targets in section order; name-only lines are listed greyed', () => {
    const { targets, nameOnly } = deckSwapTargets(
      deck([
        {
          name: 'Main',
          cards: [
            { quantity: 4, name: 'Lightning Bolt', set: 'M10', collectorNumber: '146', cardId: 1 },
            { quantity: 1, name: 'Counterspell', cardId: 2 },
          ],
        },
        {
          name: 'Sideboard',
          cards: [
            {
              quantity: 2,
              name: 'Lightning Bolt',
              set: 'lea',
              collectorNumber: '161',
              finish: 'foil',
              condition: 'LP',
              language: 'ja',
              cardId: 3,
            },
          ],
        },
      ]),
      cardData,
    )
    expect(targets).toEqual([
      {
        cardName: 'Lightning Bolt',
        cardIds: [1],
        quantity: 4,
        set: 'm10',
        collectorNumber: '146',
        section: 'Main',
        card: boltM10,
      },
      {
        cardName: 'Lightning Bolt',
        cardIds: [3],
        quantity: 2,
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        section: 'Sideboard',
        card: boltLea,
      },
    ])
    expect(nameOnly).toEqual([{ cardName: 'Counterspell', quantity: 1 }])
  })

  test('a legacy line without an id has no cardIds; an uncached printing resolves to null', () => {
    const { targets } = deckSwapTargets(
      deck([
        {
          name: 'Main',
          cards: [{ quantity: 1, name: 'Lightning Bolt', set: 'zzz', collectorNumber: '9' }],
        },
      ]),
      cardData,
    )
    expect(targets[0]?.cardIds).toEqual([])
    expect(targets[0]?.card).toBeNull()
  })

  test('falls back to the printing-keyed cards map, but never to a different printing', () => {
    const { targets } = deckSwapTargets(
      deck([
        {
          name: 'Main',
          cards: [
            { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
            { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '5', cardId: 2 },
          ],
        },
      ]),
      cardData,
    )
    expect(targets[0]?.card).toBe(solRingC21)
    // `cards['Sol Ring']` is the CMR representative — not LTC:5.
    expect(targets[1]?.card).toBeNull()
  })
})

describe('flatSwapTargets', () => {
  const entries: SwapFlatLine[] = [
    {
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'nonfoil',
      condition: 'NM',
      section: 'Main',
      cardId: 1,
    },
    {
      name: 'Lightning Bolt',
      set: 'M10',
      collectorNumber: '146',
      finish: 'nonfoil',
      condition: 'NM',
      section: 'Main',
      cardId: 2,
    },
    {
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'foil',
      condition: 'NM',
      section: 'Main',
      cardId: 3,
    },
    {
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'nonfoil',
      condition: 'NM',
      section: 'Binder B',
      cardId: 4,
    },
    {
      name: 'Lightning Bolt',
      set: 'm10',
      collectorNumber: '146',
      finish: 'nonfoil',
      condition: 'NM',
      section: 'Main',
      cardId: 5,
    },
    { name: 'Counterspell', cardId: 6 },
    { name: 'Counterspell', cardId: 7 },
  ]

  test('identical copies fold into one target carrying every id; finish/section split them', () => {
    const { targets, nameOnly } = flatSwapTargets(entries, cardData)
    expect(targets.map((t) => [t.cardIds, t.quantity, t.finish, t.section])).toEqual([
      [[1, 2, 5], 3, 'nonfoil', 'Main'],
      [[3], 1, 'foil', 'Main'],
      [[4], 1, 'nonfoil', 'Binder B'],
    ])
    expect(targets[0]?.set).toBe('m10')
    expect(targets[0]?.card).toBe(boltM10)
    expect(nameOnly).toEqual([{ cardName: 'Counterspell', quantity: 2 }])
  })

  test('a bare line pinning a foil-only printing and its explicit [foil] twin are one card', () => {
    // The grouping key resolves the display finish, as the candidate collector
    // does on the other side: the bare line IS the foil copy.
    const { targets } = flatSwapTargets(
      [
        { name: 'Lightning Bolt', set: 'plst', collectorNumber: 'M10-146', cardId: 1 },
        {
          name: 'Lightning Bolt',
          set: 'plst',
          collectorNumber: 'M10-146',
          finish: 'foil',
          cardId: 2,
        },
      ],
      cardData,
    )
    expect(targets.map((t) => [t.cardIds, t.card])).toEqual([[[1, 2], boltFoilOnly]])
  })

  test('a bare line and its explicit nonfoil/NM twin are one card', () => {
    const { targets } = flatSwapTargets(
      [
        { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', cardId: 1 },
        {
          name: 'Lightning Bolt',
          set: 'm10',
          collectorNumber: '146',
          finish: 'nonfoil',
          condition: 'NM',
          cardId: 2,
        },
      ],
      cardData,
    )
    expect(targets.map((t) => t.cardIds)).toEqual([[1, 2]])
  })

  test('a language token is part of the copy identity', () => {
    const { targets } = flatSwapTargets(
      [
        { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', cardId: 1 },
        { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', language: 'ja', cardId: 2 },
        { name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', language: 'en', cardId: 3 },
      ],
      cardData,
    )
    expect(targets.map((t) => [t.cardIds, t.language])).toEqual([
      [[1, 3], undefined],
      [[2], 'ja'],
    ])
  })
})

describe('preselectedKeysFor', () => {
  const targets: SwapTarget[] = [
    {
      cardName: 'Lightning Bolt',
      cardIds: [1, 2],
      quantity: 2,
      set: 'm10',
      collectorNumber: '146',
      card: boltM10,
    },
    {
      cardName: 'Lightning Bolt',
      cardIds: [3],
      quantity: 1,
      set: 'lea',
      collectorNumber: '161',
      card: boltLea,
    },
    {
      cardName: 'Sol Ring',
      cardIds: [],
      quantity: 1,
      set: 'c21',
      collectorNumber: '263',
      card: null,
    },
  ]
  const info = (overrides: Partial<CardContextInfo>): CardContextInfo => ({
    cardName: 'Lightning Bolt',
    card: null,
    cardIds: [],
    quantity: 1,
    ...overrides,
  })

  test('a target is pre-checked when any of its ids is selected', () => {
    const keys = preselectedKeysFor(targets, [info({ cardIds: [2] })])
    expect([...keys]).toEqual([swapTargetKey(targets[0]!)])
  })

  test('an id-less target matches a selected tile by card and printing', () => {
    const keys = preselectedKeysFor(targets, [
      info({ cardName: 'Sol Ring', set: 'C21', collectorNumber: '263' }),
    ])
    expect([...keys]).toEqual([swapTargetKey(targets[2]!)])
  })

  test('a printing match alone never pre-checks a target that has ids', () => {
    const keys = preselectedKeysFor(targets, [info({ set: 'm10', collectorNumber: '146' })])
    expect(keys.size).toBe(0)
  })
})

/** A change's line id — `ChangeInput` is a union, and its section variants carry none. */
function cardIdOf(change: ChangeInput): number | undefined {
  return 'cardId' in change ? change.cardId : undefined
}

describe('buildSwapRequest', () => {
  const targets: SwapTarget[] = [
    {
      cardName: 'Lightning Bolt',
      cardIds: [1],
      quantity: 1,
      set: 'm10',
      collectorNumber: '146',
      card: boltM10,
    },
    {
      cardName: 'Lightning Bolt',
      cardIds: [2],
      quantity: 1,
      set: 'lea',
      collectorNumber: '161',
      card: boltLea,
    },
  ]
  const nameOnly = [{ cardName: 'Counterspell', quantity: 1 }]
  const info = (overrides: Partial<CardContextInfo>): CardContextInfo => ({
    cardName: 'Lightning Bolt',
    card: null,
    cardIds: [],
    quantity: 1,
    ...overrides,
  })

  test("'all' opens on the Cards step with nothing pre-checked and no single-card entry", () => {
    expect(buildSwapRequest({ targets, nameOnly }, 'all')).toEqual({ targets, nameOnly })
  })

  test('a selection resolving to exactly one target takes the single-card entry', () => {
    const request = buildSwapRequest({ targets, nameOnly }, [info({ cardIds: [2] })])
    expect([...request.preselected!]).toEqual([swapTargetKey(targets[1]!)])
    expect(request.singleCard).toBe(true)
  })

  test('a lone name-only tile pre-checks nothing and never takes the single-card entry', () => {
    // The Selected menu is not gated per card: a name-only line can be the one
    // selected tile. It matches no target, so the wizard must open on the Cards
    // step (where the greyed row explains itself), not on an empty picker.
    const request = buildSwapRequest({ targets, nameOnly }, [
      info({ cardName: 'Counterspell', cardIds: [9] }),
    ])
    expect(request.preselected?.size).toBe(0)
    expect(request.singleCard).toBeUndefined()
  })

  test('a selection covering several targets pre-checks them without the single-card entry', () => {
    const request = buildSwapRequest({ targets, nameOnly }, [info({ cardIds: [1, 2] })])
    expect(request.preselected?.size).toBe(2)
    expect(request.singleCard).toBeUndefined()
  })
})

describe('swapMovesToChanges', () => {
  const inMove = (overrides: Partial<SwapMove> = {}): SwapMove => ({
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
    card: boltLea,
    ...overrides,
  })
  const outMove = (overrides: Partial<SwapMove> = {}): SwapMove => ({
    direction: 'out',
    cardName: 'Lightning Bolt',
    count: 2,
    set: 'm10',
    collectorNumber: '146',
    condition: 'NM',
    from: DECK,
    to: BINDER,
    sourceCardIds: [7, 7],
    card: boltM10,
    ...overrides,
  })

  /** The ops a move set produces, drained from the generator the controller pulls one at a time. */
  function opsOf(moves: readonly SwapMove[], ctx: SwapApplyContext): SwapChangeOp[] {
    return [...swapMovesToChanges(moves, ctx)]
  }

  /** An apply context with a counting allocator and fixed line quantities. */
  function context(
    kind: SwapApplyContext['kind'],
    quantities: Record<number, number>,
    mergeTargetId: SwapApplyContext['mergeTargetId'] = () => undefined,
  ): SwapApplyContext {
    let next = 50
    return {
      kind,
      allocateId: () => next++,
      quantityOf: (id) => quantities[id] ?? 0,
      mergeTargetId,
    }
  }

  test('deck: out moves come first, one move-from per copy; the id is released with the last copy', () => {
    const ops = opsOf([inMove(), outMove()], context('deck', { 7: 2 }))
    expect(ops.map((op) => op.change.action)).toEqual([
      'move-from',
      'move-from',
      'move-to',
      'move-to',
    ])
    const outs = ops.slice(0, 2)
    expect(outs[0]).toEqual({
      change: {
        action: 'move-from',
        cardName: 'Lightning Bolt',
        set: 'm10',
        collectorNumber: '146',
        condition: 'NM',
        to: { type: 'collection', name: 'Binder' },
        cardId: 7,
      },
    })
    expect(outs[1]?.release).toBe(7)
  })

  test('deck: a partial swap keeps the line id', () => {
    const ops = opsOf([outMove()], context('deck', { 7: 4 }))
    expect(ops.map((op) => op.release)).toEqual([undefined, undefined])
  })

  test('deck: a line drained by two destinations releases its id once, on the final copy', () => {
    const ops = opsOf(
      [
        outMove({ count: 1, sourceCardIds: [7] }),
        outMove({ count: 1, sourceCardIds: [7], to: CUBE }),
      ],
      context('deck', { 7: 2 }),
    )
    expect(ops.map((op) => op.release)).toEqual([undefined, 7])
    expect(ops[1]?.change).toMatchObject({ to: { type: 'deck', name: 'Cube' } })
  })

  test('deck: copies of one in move share a single fresh id and each carry their source id', () => {
    const ops = opsOf([inMove()], context('deck', {}))
    const expected: ChangeInput = {
      action: 'move-to',
      cardName: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      finish: 'nonfoil',
      from: { type: 'collection', name: 'Binder' },
      cardId: 50,
      section: 'Main',
      sourceCardId: 100,
    }
    expect(ops[0]?.change).toEqual(expected)
    expect(ops[1]?.change).toEqual({ ...expected, sourceCardId: 101 })
  })

  test('deck: in moves the add reducer would merge share one id, whatever their source; a different finish gets its own', () => {
    const ops = opsOf(
      [
        inMove({ count: 1, sourceCardIds: [100] }),
        inMove({ count: 1, sourceCardIds: [300], from: CUBE }),
        inMove({ count: 1, sourceCardIds: [101], finish: undefined }),
        inMove({ count: 1, sourceCardIds: [102], finish: 'foil' }),
      ],
      context('deck', {}),
    )
    // `mergesOntoCard` folds a bare finish to nonfoil and ignores the source list.
    expect(ops.map((op) => cardIdOf(op.change))).toEqual([50, 50, 50, 51])
  })

  test('deck: a copy the deck already holds a line for lands on that line; nothing is allocated', () => {
    let allocated = 0
    const ctx: SwapApplyContext = {
      ...context('deck', {}),
      allocateId: () => {
        allocated += 1
        return 50
      },
      mergeTargetId: (move) => (move.set === 'lea' ? 7 : undefined),
    }
    const ops = opsOf([inMove()], ctx)
    expect(ops.map((op) => cardIdOf(op.change))).toEqual([7, 7])
    expect(allocated).toBe(0)
  })

  test('deck: the merge probe is asked as each in op is produced, after the ops before it applied', () => {
    // The probe "sees" the first arriving copy's line once that op is pulled:
    // the second copy must land on the same id it reports, never a fresh one.
    const seen: number[] = []
    const ctx = context('deck', {}, () => (seen.length > 0 ? seen[0] : undefined))
    const ops: number[] = []
    for (const op of swapMovesToChanges([inMove()], ctx)) {
      const id = cardIdOf(op.change)!
      ops.push(id)
      seen.push(id)
    }
    expect(ops).toEqual([50, 50])
  })

  test("deckSwapMergeTargetId probes the add reducer's merge rule over live deck data", () => {
    const live = deck([
      {
        name: 'Main',
        cards: [
          { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 9 },
          { quantity: 1, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', cardId: 4 },
        ],
      },
    ])
    expect(deckSwapMergeTargetId(live, inMove())).toBe(9)
    expect(deckSwapMergeTargetId(live, inMove({ finish: 'foil' }))).toBeUndefined()
    expect(
      deckSwapMergeTargetId(live, inMove({ set: 'sta', collectorNumber: '42' })),
    ).toBeUndefined()
  })

  test('flat: every arriving copy gets its own fresh id; every leaving copy releases its own', () => {
    const ops = opsOf(
      [inMove(), outMove({ sourceCardIds: [7, 8] })],
      context('flat', { 7: 1, 8: 1 }),
    )
    expect(ops.map((op) => [op.change.action, cardIdOf(op.change), op.release])).toEqual([
      ['move-from', 7, 7],
      ['move-from', 8, 8],
      ['move-to', 50, undefined],
      ['move-to', 51, undefined],
    ])
  })

  test('legacy lines without ids: the out copy carries no cardId (nothing to release), the in copy no sourceCardId', () => {
    const ops = opsOf(
      [
        inMove({ count: 1, sourceCardIds: [undefined] }),
        outMove({ count: 1, sourceCardIds: [undefined] }),
      ],
      context('flat', {}),
    )
    expect(ops[0]?.change).not.toHaveProperty('cardId')
    expect(ops[0]?.release).toBeUndefined()
    expect(ops[1]?.change).not.toHaveProperty('sourceCardId')
  })

  test('optional printing details are present only when set (no undefined keys)', () => {
    const ops = opsOf(
      [inMove({ finish: undefined, section: undefined, language: 'ja', condition: 'LP' })],
      context('deck', {}),
    )
    expect(Object.keys(ops[0]!.change).sort()).toEqual([
      'action',
      'cardId',
      'cardName',
      'collectorNumber',
      'condition',
      'from',
      'language',
      'set',
      'sourceCardId',
    ])
  })
})
