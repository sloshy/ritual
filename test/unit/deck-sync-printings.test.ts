import { describe, expect, test } from 'bun:test'
import {
  applyDownloadDiff,
  applyPrintingUpdates,
  buildCardIdResolver,
  buildCardIdsResolver,
  diffDeckCards,
  diffToChangeEvents,
  printingUpdatesToChangeEvents,
  type PrintingUpdate,
} from '../../src/deck-sync/diff'
import type { Card, DeckSection } from '../../src/types'

/**
 * The printing-aware half of the deck-sync diff (`--sync-printings`): how a
 * card's copies are matched printing by printing, what that produces when the
 * two sides split a card across different printings, how the result rewrites
 * local lines on a pull, and the changelog events it produces. The
 * name-and-quantity diff these sit beside is pinned in `deck-sync.test.ts`, and
 * the pairing rules themselves in `deck-sync-reconcile.test.ts`.
 */

const main = (cards: Card[]): DeckSection[] => [{ name: 'Main', cards }]

/** Diff two sets of sections the way a printing-syncing pull does. */
const diffPrintings = (oldSections: DeckSection[], newSections: DeckSection[]) =>
  diffDeckCards(oldSections, newSections, { withPrintings: true })

describe('diffDeckCards withPrintings', () => {
  test('reports a card whose printing differs, and nothing for one that matches', () => {
    const local = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' },
      { quantity: 1, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
    ])
    const remote = main([
      { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil' },
      { quantity: 1, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
    ])

    const diff = diffPrintings(local, remote)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.quantityChanged).toEqual([])
    expect(diff.printingUpdates).toEqual([
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
    const { printingUpdates } = diffPrintings(local, remote)
    expect(printingUpdates).toHaveLength(1)
    expect(printingUpdates[0]!.to.finish).toBe('foil')
  })

  test('a source line stating no printing leaves the destination alone', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([{ quantity: 1, name: 'Sol Ring' }])
    const diff = diffPrintings(local, remote)
    expect(diff.printingUpdates).toEqual([])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  test('a bare destination adopts the source printing', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring' }])
    const remote = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    expect(diffPrintings(local, remote).printingUpdates).toEqual([
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: undefined, collectorNumber: undefined, finish: undefined },
        to: { set: 'c21', collectorNumber: '240', finish: undefined },
      },
    ])
  })

  test('cards on only one side are reported per printing', () => {
    const local = main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([
      { quantity: 2, name: 'Arcane Signet', set: 'ltc', collectorNumber: '285' },
      { quantity: 1, name: 'Arcane Signet', set: 'eld', collectorNumber: '331', finish: 'foil' },
    ])
    const diff = diffPrintings(local, remote)
    expect(diff.removed).toEqual([
      {
        name: 'Sol Ring',
        board: 'Main',
        totalQuantity: 1,
        printing: { set: 'c21', collectorNumber: '240', finish: undefined },
      },
    ])
    // A card new to the destination arrives as one entry per printing, so each
    // one's copies are pinned to the printing the source actually holds.
    expect(diff.added).toEqual([
      {
        name: 'Arcane Signet',
        board: 'Main',
        totalQuantity: 2,
        printing: { set: 'ltc', collectorNumber: '285', finish: undefined },
      },
      {
        name: 'Arcane Signet',
        board: 'Main',
        totalQuantity: 1,
        printing: { set: 'eld', collectorNumber: '331', finish: 'foil' },
      },
    ])
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
    expect(diffPrintings(local, remote).printingUpdates).toEqual([
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
    expect(diffPrintings(remote, local).printingUpdates).toEqual([])
    const { printingUpdates } = diffDeckCards(remote, local, {
      withPrintings: true,
      byBoard: false,
    })
    expect(printingUpdates).toHaveLength(1)
    expect(printingUpdates[0]!.to.set).toBe('ltc')
  })
})

// ── Cards held at several printings at once ──────────────────────────

/**
 * The case the printing sync exists for: Archidekt (and a local file) can hold
 * the same card several times over at different printings, so reconciling one
 * means adding, removing, and re-quantifying *within* a name — not picking a
 * single printing for all of its copies.
 */
describe('diffDeckCards withPrintings across several printings of one card', () => {
  const bolt = (quantity: number, set: string, collectorNumber: string): Card => ({
    quantity,
    name: 'Lightning Bolt',
    set,
    collectorNumber,
  })

  test('splitting copies across printings adds the new one and re-quantifies the old', () => {
    // The destination holds 3 of one printing; the source splits them 2/1.
    const diff = diffPrintings(
      main([bolt(3, 'lea', '161')]),
      main([bolt(2, 'lea', '161'), bolt(1, '2xm', '157')]),
    )

    expect(diff.printingUpdates).toEqual([])
    expect(diff.quantityChanged).toEqual([
      {
        name: 'Lightning Bolt',
        board: 'Main',
        oldQty: 3,
        newQty: 2,
        printing: { set: 'lea', collectorNumber: '161', finish: undefined },
      },
    ])
    expect(diff.added).toEqual([
      {
        name: 'Lightning Bolt',
        board: 'Main',
        totalQuantity: 1,
        printing: { set: '2xm', collectorNumber: '157', finish: undefined },
      },
    ])
  })

  test('collapsing copies onto one printing removes the printing that was dropped', () => {
    const diff = diffPrintings(
      main([bolt(2, 'lea', '161'), bolt(1, '2xm', '157')]),
      main([bolt(3, 'lea', '161')]),
    )

    expect(diff.printingUpdates).toEqual([])
    expect(diff.quantityChanged.map((entry) => [entry.oldQty, entry.newQty])).toEqual([[2, 3]])
    expect(diff.removed).toEqual([
      {
        name: 'Lightning Bolt',
        board: 'Main',
        totalQuantity: 1,
        printing: { set: '2xm', collectorNumber: '157', finish: undefined },
      },
    ])
  })

  test('printings shared by both sides pair up regardless of the order they appear in', () => {
    const diff = diffPrintings(
      main([bolt(1, '2xm', '157'), bolt(3, 'lea', '161')]),
      main([bolt(3, 'lea', '161'), bolt(1, '2xm', '157')]),
    )
    expect(diff).toMatchObject({ added: [], removed: [], quantityChanged: [], printingUpdates: [] })
  })

  test('one printing can move while another only changes quantity', () => {
    const diff = diffPrintings(
      main([bolt(2, 'lea', '161'), bolt(1, '2xm', '157')]),
      main([bolt(4, 'lea', '161'), bolt(1, 'clb', '187')]),
    )
    // LEA matched exactly and only re-quantified; 2XM had no counterpart and so
    // was re-pinned to CLB rather than being removed and re-added.
    expect(diff.printingUpdates).toEqual([
      {
        name: 'Lightning Bolt',
        board: 'Main',
        from: { set: '2xm', collectorNumber: '157', finish: undefined },
        to: { set: 'clb', collectorNumber: '187', finish: undefined },
      },
    ])
    expect(diff.quantityChanged.map((entry) => [entry.oldQty, entry.newQty])).toEqual([[2, 4]])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
  })

  test('a re-pin that also changes quantity keys the quantity by the new printing', () => {
    // The applier rewrites the printing first, so a quantity change for the same
    // copies has to name the printing they end up on or it would find no lines.
    const diff = diffPrintings(main([bolt(1, 'lea', '161')]), main([bolt(3, '2xm', '157')]))
    expect(diff.printingUpdates).toHaveLength(1)
    expect(diff.quantityChanged).toEqual([
      {
        name: 'Lightning Bolt',
        board: 'Main',
        oldQty: 1,
        newQty: 3,
        printing: { set: '2xm', collectorNumber: '157', finish: undefined },
      },
    ])
  })

  test('the same printing in two finishes is two holdings, not one', () => {
    const diff = diffPrintings(
      main([{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
      main([
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' },
        { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' },
      ]),
    )
    expect(diff.quantityChanged.map((entry) => [entry.oldQty, entry.newQty])).toEqual([[2, 1]])
    expect(diff.added.map((card) => card.printing?.finish)).toEqual(['foil'])
  })

  test('applying the split to local sections leaves one line per printing', () => {
    // The pull's own composition: printings move first, then quantities.
    const local = main([
      { quantity: 3, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 4 },
    ])
    const remote = main([bolt(2, 'lea', '161'), bolt(1, '2xm', '157')])
    const diff = diffPrintings(local, remote)
    const result = applyDownloadDiff(applyPrintingUpdates(local, diff.printingUpdates), diff)

    expect(result[0]!.cards).toEqual([
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 4 },
      {
        quantity: 1,
        name: 'Lightning Bolt',
        set: '2xm',
        collectorNumber: '157',
        finish: undefined,
      },
    ])
  })

  test('applying a re-pin keeps the line’s own id and drops the printing that went away', () => {
    const local = main([
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 2 },
    ])
    const remote = main([bolt(2, 'lea', '161'), bolt(1, 'clb', '187')])
    const diff = diffPrintings(local, remote)
    const result = applyDownloadDiff(applyPrintingUpdates(local, diff.printingUpdates), diff)

    // The re-pinned line kept `&2` rather than being dropped and re-added.
    expect(result[0]!.cards.map((card) => [card.set, card.quantity, card.cardId])).toEqual([
      ['lea', 2, 1],
      ['clb', 1, 2],
    ])
  })
})

// ── Runs that are not syncing printings ──────────────────────────────

describe('diffDeckCards without printings', () => {
  test('reports cards the two sides hold at different printings without changing them', () => {
    const local = main([
      { quantity: 3, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
    ])
    const remote = main([
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
    ])
    const diff = diffDeckCards(local, remote)
    expect(diff.unaligned).toEqual([{ name: 'Lightning Bolt', board: 'Main' }])
    // Totals match, so nothing at all is applied — the printings are simply
    // reported, and `--sync-printings` is what reconciles them.
    expect(diff).toMatchObject({ added: [], removed: [], quantityChanged: [], printingUpdates: [] })
  })

  test('a source stating no printing never counts as a mismatch', () => {
    const local = main([{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }])
    const remote = main([{ quantity: 3, name: 'Sol Ring' }])
    const diff = diffDeckCards(local, remote)
    expect(diff.unaligned).toEqual([])
    expect(diff.quantityChanged.map((entry) => entry.newQty)).toEqual([3])
  })

  test('a quantity change spreads over the lines the card already occupies', () => {
    // The card is split across printings on both sides and the totals differ.
    // Nothing may be re-pinned, but the total still has to land — and without
    // collapsing the two lines into one.
    const local = main([
      { quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
      { quantity: 2, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
    ])
    const remote = main([
      { quantity: 3, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
    ])
    const diff = diffDeckCards(local, remote)
    const result = applyDownloadDiff(local, diff)
    expect(result[0]!.cards.map((card) => [card.set, card.quantity])).toEqual([
      ['lea', 2],
      ['2xm', 1],
    ])
    expect(diff.unaligned).toEqual([{ name: 'Lightning Bolt', board: 'Main' }])
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

  test('clears a finish the source no longer states', () => {
    // The source wins on every dimension it speaks to, and a re-pin to a
    // nonfoil printing speaks to the finish by stating none.
    const sections = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' },
    ])
    const result = applyPrintingUpdates(sections, [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: 'foil' },
        to: { set: 'ltc', collectorNumber: '284', finish: undefined },
      },
    ])
    expect(result[0]!.cards[0]!.finish).toBeUndefined()
  })

  test('resolves every update’s lines before rewriting any of them', () => {
    // A finish-only update leaves the edition alone, so the printing it lands
    // on can be one another update moves *from*. Selecting as we go would let
    // the second update pick up the first's output and rewrite it twice.
    const sections = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', cardId: 1 },
      {
        quantity: 1,
        name: 'Sol Ring',
        set: 'c21',
        collectorNumber: '240',
        finish: 'foil',
        cardId: 2,
      },
    ])
    const result = applyPrintingUpdates(sections, [
      {
        name: 'Sol Ring',
        board: 'Main',
        // Lands on C21:240 [foil] — which the second update moves away from.
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: undefined, collectorNumber: undefined, finish: 'foil' },
      },
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: 'foil' },
        to: { set: 'ltc', collectorNumber: '284', finish: 'foil' },
      },
    ])
    expect(result[0]!.cards.map((card) => [card.cardId, card.set, card.finish])).toEqual([
      [1, 'c21', 'foil'],
      [2, 'ltc', 'foil'],
    ])
  })

  test('only touches the lines holding the printing it moves from', () => {
    const sections = main([
      { quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' },
      { quantity: 1, name: 'Sol Ring', set: 'mrd', collectorNumber: '217' },
    ])
    const result = applyPrintingUpdates(sections, [update])
    expect(result[0]!.cards.map((card) => card.set)).toEqual(['ltc', 'mrd'])
  })
})

describe('printing-aware change events', () => {
  test('adds from a printing-keyed diff carry the printing onto the add event', () => {
    const diff = diffPrintings(
      main([]),
      main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240', finish: 'foil' }]),
    )
    const [change] = diffToChangeEvents(diff)
    expect(change?.action).toBe('add')
    if (change?.action !== 'add') throw new Error('expected an add change')
    expect(change.set).toBe('c21')
    expect(change.collectorNumber).toBe('240')
    expect(change.finish).toBe('foil')
  })

  test('quantity-change events carry the printing the same way adds do', () => {
    const diff = diffPrintings(
      main([{ quantity: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
      main([{ quantity: 2, name: 'Sol Ring', set: 'c21', collectorNumber: '240' }]),
    )
    const [change] = diffToChangeEvents(diff)
    expect(change?.action).toBe('add')
    if (change?.action !== 'add') throw new Error('expected an add change')
    expect(change.set).toBe('c21')
    expect(change.collectorNumber).toBe('240')
  })

  test('events for a card split across printings are stamped with each line’s own id', () => {
    // The saved deck holds both printings; each change must name the line it
    // actually touched, or a replay applies it to the wrong copies.
    const diff = diffPrintings(
      main([{ quantity: 2, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' }]),
      main([
        { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161' },
        { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157' },
      ]),
    )
    const saved = main([
      { quantity: 1, name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', cardId: 1 },
      { quantity: 1, name: 'Lightning Bolt', set: '2xm', collectorNumber: '157', cardId: 2 },
    ])
    const events = diffToChangeEvents(diff, buildCardIdResolver(saved))
    expect(events.map((event) => [event.action, event.cardId])).toEqual([
      ['add', 2],
      ['remove', 1],
    ])
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
    const [change] = printingUpdatesToChangeEvents(updates, (board, name, printing) =>
      board === 'Main' && name === 'Sol Ring' && printing.set === 'ltc' ? [7] : [],
    )
    expect(change?.action).toBe('set-printing')
    if (change?.action !== 'set-printing') throw new Error('expected a set-printing change')
    expect(change.set).toBe('ltc')
    expect(change.collectorNumber).toBe('284')
    expect(change.finish).toBe('foil')
    expect(change.cardId).toBe(7)
  })

  test('a card spanning several lines gets one event per line, each with its id', () => {
    // The apply rewrites every line holding the printing, and a changelog replay
    // applies each event to exactly one card — so the event count must match the
    // line count or a replay reproduces only part of the rewrite.
    const updates: PrintingUpdate[] = [
      {
        name: 'Sol Ring',
        board: 'Main',
        from: { set: 'c21', collectorNumber: '240', finish: undefined },
        to: { set: 'ltc', collectorNumber: '284', finish: undefined },
      },
    ]
    // The resolver reads the *saved* deck, where the lines already moved.
    const saved = main([
      { quantity: 1, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 3 },
      { quantity: 2, name: 'Sol Ring', set: 'ltc', collectorNumber: '284', cardId: 8 },
    ])
    const changes = printingUpdatesToChangeEvents(updates, buildCardIdsResolver(saved))
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
