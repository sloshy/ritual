import { describe, expect, test } from 'bun:test'
import {
  applyPrintingUpdates,
  buildCardIdsResolver,
  diffByCardName,
  diffPrintings,
  diffToChangeEvents,
  printingSatisfies,
  printingUpdatesToChangeEvents,
  summarizeCards,
  type PrintingUpdate,
} from '../../src/deck-sync/diff'
import type { Card, DeckSection } from '../../src/types'

/**
 * The printing-aware half of the deck-sync diff (`--sync-printings`): which
 * cards get a printing update, how updates rewrite local lines on a pull, and
 * the `set-printing` changelog events they produce. The name/quantity diff
 * these sit beside is pinned in `deck-sync.test.ts`.
 */

const main = (cards: Card[]): DeckSection[] => [{ name: 'Main', cards }]

describe('printingSatisfies', () => {
  test('compares only the dimensions the source states', () => {
    // A source with no set speaks only to the finish.
    expect(printingSatisfies({ set: 'lea', collectorNumber: '161' }, { finish: 'foil' })).toBe(
      false,
    )
    expect(
      printingSatisfies({ set: 'lea', collectorNumber: '161', finish: 'foil' }, { finish: 'foil' }),
    ).toBe(true)
  })

  test('folds an absent finish to nonfoil', () => {
    expect(
      printingSatisfies(
        { set: 'lea', collectorNumber: '161' },
        { set: 'lea', collectorNumber: '161', finish: 'nonfoil' },
      ),
    ).toBe(true)
  })

  test('compares collector numbers case-insensitively', () => {
    // Sets are lowercased at the parse boundary, but collector numbers keep
    // their case (`507A`) — the comparison must fold it, per printingKey's rule.
    expect(
      printingSatisfies(
        { set: 'lea', collectorNumber: '161A' },
        { set: 'lea', collectorNumber: '161a' },
      ),
    ).toBe(true)
  })
})

describe('diffPrintings', () => {
  test('reports a card whose printing differs, and nothing for one that matches', () => {
    const local = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' },
      { quantity: 1, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
    ])
    const remote = main([
      { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
      { quantity: 1, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
    ])

    const { updates, skipped } = diffPrintings(local, remote)
    expect(skipped).toEqual([])
    expect(updates).toEqual([
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: 'ltc', collectorNumber: '284', finish: 'foil' },
      },
    ])
  })

  test('reports a finish-only difference on the same printing', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' },
    ])
    const { updates } = diffPrintings(local, remote)
    expect(updates).toHaveLength(1)
    expect(updates[0]!.to.finish).toBe('foil')
  })

  test('a source line stating no printing leaves the destination alone', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([{ quantity: 1, name: 'Sol Ring' }])
    expect(diffPrintings(local, remote)).toEqual({ updates: [], skipped: [] })
  })

  test('a bare destination adopts the source printing', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring' }])
    const remote = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const { updates } = diffPrintings(local, remote)
    expect(updates).toEqual([
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: undefined, collectorNumber: undefined, finish: undefined },
        to: { set: 'c21', collectorNumber: '240', finish: undefined },
      },
    ])
  })

  test('skips a card with several distinct printings, naming the ambiguous side', () => {
    const twoPrintings: Card[] = [
      { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
    ]
    const onePrinting: Card[] = [
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
    ]

    const oldAmbiguous = diffPrintings(main(twoPrintings), main(onePrinting))
    expect(oldAmbiguous.updates).toEqual([])
    expect(oldAmbiguous.skipped).toEqual([{ name: 'Lightning Bolt', board: 'Main', side: 'old' }])

    const newAmbiguous = diffPrintings(main(onePrinting), main(twoPrintings))
    expect(newAmbiguous.skipped).toEqual([{ name: 'Lightning Bolt', board: 'Main', side: 'new' }])
  })

  test('same-name lines that agree on one printing are not ambiguous', () => {
    const local = main([
      { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
    ])
    const remote = main([
      { quantity: 3, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
    ])
    const { updates, skipped } = diffPrintings(local, remote)
    expect(skipped).toEqual([])
    expect(updates).toHaveLength(1)
  })

  test('cards on only one side are the name diff’s business, not this one’s', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([
      { quantity: 1, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
    ])
    expect(diffPrintings(local, remote)).toEqual({ updates: [], skipped: [] })
  })

  test('by board: the same card is compared per board, and carries its board', () => {
    const local: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
    ]
    const remote: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }],
      },
    ]
    const { updates } = diffPrintings(local, remote)
    expect(updates).toEqual([
      {
        name: 'Sol Ring',
        board: 'Sideboard',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: 'ltc', collectorNumber: '284', finish: undefined },
      },
    ])
  })

  test('byBoard: false flattens boards, matching a push’s name-only namespace', () => {
    // Remote holds the card in Main, local in the Sideboard. Board-aware these
    // never meet (an add plus a removal); flattened they are the same card and
    // its printing difference is found.
    const remote: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
    ]
    const local: DeckSection[] = [
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284' }],
      },
    ]
    expect(diffPrintings(remote, local).updates).toEqual([])
    const { updates } = diffPrintings(remote, local, { byBoard: false })
    expect(updates).toHaveLength(1)
    expect(updates[0]!.to.set).toBe('ltc')
  })
})

describe('applyPrintingUpdates', () => {
  const update: PrintingUpdate = {
    name: 'Sol Ring',
    board: 'Main',
    from: { set: 'c21', collectorNumber: '240', finish: undefined },
    to: { set: 'ltc', collectorNumber: '284', finish: 'foil' },
  }

  test('rewrites set, collector number, and finish, preserving everything else', () => {
    const sections = main([
      {
        quantity: 1,
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '240',
        condition: 'LP',
        language: 'ja',
        note: 'from the precon',
        cardId: 5,
      },
    ])
    const result = applyPrintingUpdates(sections, [update])
    expect(result[0]!.cards[0]).toEqual({
      quantity: 1,
      name: 'Sol Ring',
      set: 'ltc',
      collectorNumber: '284',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      note: 'from the precon',
      cardId: 5,
    })
    // The input is copied, not mutated.
    expect(sections[0]!.cards[0]!.set).toBe('c21')
  })

  test('a finish-only update keeps the line’s own printing', () => {
    // The reachable finish-only shape: the source states a finish but no set
    // (an update whose `to` states nothing at all is never emitted).
    const sections = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const finishOnly: PrintingUpdate = {
      name: 'Sol Ring',
      board: 'Main',
      from: { set: 'c21', collectorNumber: '240', finish: undefined },
      to: { set: undefined, collectorNumber: undefined, finish: 'foil' },
    }
    const result = applyPrintingUpdates(sections, [finishOnly])
    expect(result[0]!.cards[0]).toEqual({
      quantity: 1,
      name: 'Sol Ring',
      set: 'c21',
      collectorNumber: '240',
      finish: 'foil',
    })
  })

  test('only touches the update’s board', () => {
    const sections: DeckSection[] = [
      {
        name: 'Main',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
      {
        name: 'Sideboard',
        cards: [{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }],
      },
    ]
    const result = applyPrintingUpdates(sections, [update])
    expect(result[0]!.cards[0]!.set).toBe('ltc')
    expect(result[1]!.cards[0]!.set).toBe('c21')
  })
})

describe('summarizeCards withPrintings', () => {
  test('carries the printing when every line agrees on one', () => {
    const summary = summarizeCards(
      main([
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' },
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' },
      ]),
      { withPrintings: true },
    )
    expect(summary.get('Main sol ring')?.printing).toEqual({
      set: 'c21',
      collectorNumber: '240',
      finish: 'foil',
    })
  })

  test('carries no printing for mixed printings or bare lines', () => {
    const summary = summarizeCards(
      main([
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
        { quantity: 1, name: 'Sol Ring' },
      ]),
      { withPrintings: true },
    )
    const bolt = summary.get('Main lightning bolt')
    // The quantity pins the lookup key, so a missing entry cannot pass as
    // "no printing".
    expect(bolt?.totalQuantity).toBe(2)
    expect(bolt?.printing).toBeUndefined()
    const solRing = summary.get('Main sol ring')
    expect(solRing?.totalQuantity).toBe(1)
    expect(solRing?.printing).toBeUndefined()
  })

  test('is absent entirely without the option', () => {
    const summary = summarizeCards(
      main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
    )
    expect(summary.get('Main sol ring')?.printing).toBeUndefined()
  })
})

describe('printing-aware change events', () => {
  test('adds from a withPrintings diff carry the printing onto the add event', () => {
    const diff = diffByCardName(
      main([]),
      main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' }]),
      { withPrintings: true },
    )
    const [change] = diffToChangeEvents(diff)
    expect(change?.action).toBe('add')
    if (change?.action !== 'add') throw new Error('expected an add change')
    expect(change.set).toBe('c21')
    expect(change.collectorNumber).toBe('240')
    expect(change.finish).toBe('foil')
  })

  test('quantity-change events carry the printing the same way adds do', () => {
    const diff = diffByCardName(
      main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
      main([{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
      { withPrintings: true },
    )
    const [change] = diffToChangeEvents(diff)
    expect(change?.action).toBe('add')
    if (change?.action !== 'add') throw new Error('expected an add change')
    expect(change.set).toBe('c21')
    expect(change.collectorNumber).toBe('240')
  })

  test('printing updates become set-printing events stamped with the card id', () => {
    const updates: PrintingUpdate[] = [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: 'ltc', collectorNumber: '284', finish: 'foil' },
      },
    ]
    const [change] = printingUpdatesToChangeEvents(updates, (board, name) =>
      board === 'Main' && name === 'Sol Ring' ? [7] : [],
    )
    expect(change?.action).toBe('set-printing')
    if (change?.action !== 'set-printing') throw new Error('expected a set-printing change')
    expect(change.set).toBe('ltc')
    expect(change.collectorNumber).toBe('284')
    expect(change.finish).toBe('foil')
    expect(change.cardId).toBe(7)
  })

  test('a card spanning several lines gets one event per line, each with its id', () => {
    // The apply rewrites every line of the card in the board, and a changelog
    // replay applies each event to exactly one card — so the event count must
    // match the line count or a replay reproduces only part of the rewrite.
    const updates: PrintingUpdate[] = [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: 'ltc', collectorNumber: '284', finish: undefined },
      },
    ]
    const sections = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 3 },
      { quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 8 },
    ])
    const changes = printingUpdatesToChangeEvents(updates, buildCardIdsResolver(sections))
    expect(changes.map((change) => change.cardId)).toEqual([3, 8])
    expect(changes.every((change) => change.action === 'set-printing')).toBe(true)
  })

  test('a finish-only update records the line’s own printing on the event', () => {
    const updates: PrintingUpdate[] = [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: undefined, collectorNumber: undefined, finish: 'foil' },
      },
    ]
    const [change] = printingUpdatesToChangeEvents(updates)
    expect(change?.action).toBe('set-printing')
    if (change?.action !== 'set-printing') throw new Error('expected a set-printing change')
    expect(change.set).toBe('c21')
    expect(change.collectorNumber).toBe('240')
    expect(change.finish).toBe('foil')
  })
})
