import { describe, expect, test } from 'bun:test'
import {
  distributeQuantity,
  pairPrintings,
  printingSatisfies,
  printingsAlign,
  type DeckPrintingRef,
  type PrintingHolder,
} from '../../src/deck-sync/reconcile'

/**
 * The pairing rules a deck sync reconciles two sides with. Everything here is
 * pure: what the diff and the upload planner both build on, tested once, at the
 * layer that decides it.
 */

/** A holding, spelled as `set:cn` (or `-` for a bare one) with an optional finish. */
function holding(printing: string, quantity: number, finish?: 'foil' | 'etched'): PrintingHolder {
  if (printing === '-') return { printing: { finish }, quantity }
  const [set, collectorNumber] = printing.split(':')
  return { printing: { set, collectorNumber, finish }, quantity }
}

/** `set:cn` again, for reading a pairing's result back. */
function label(printing: DeckPrintingRef): string {
  return printing.set ? `${printing.set}:${printing.collectorNumber}` : '-'
}

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

describe('pairPrintings', () => {
  test('pairs identical printings regardless of the order they appear in', () => {
    const pairing = pairPrintings(
      [holding('lea:161', 3), holding('2xm:157', 1)],
      [holding('2xm:157', 2), holding('lea:161', 4)],
    )
    expect(pairing.repinned).toEqual([])
    expect(pairing.added).toEqual([])
    expect(pairing.removed).toEqual([])
    expect(pairing.kept.map((pair) => [label(pair.from.printing), pair.to.quantity])).toEqual([
      ['2xm:157', 2],
      ['lea:161', 4],
    ])
  })

  test('a source that states no printing keeps the destination’s', () => {
    const pairing = pairPrintings([holding('lea:161', 1)], [holding('-', 2)])
    expect(pairing.kept).toHaveLength(1)
    expect(pairing.repinned).toEqual([])
    expect(label(pairing.kept[0]!.from.printing)).toBe('lea:161')
  })

  test('a source the destination already satisfies is not a re-pin', () => {
    // The source states a finish the destination already has, and no set.
    const pairing = pairPrintings([holding('lea:161', 1, 'foil')], [holding('-', 1, 'foil')])
    expect(pairing.repinned).toEqual([])
    expect(pairing.kept).toHaveLength(1)
  })

  test('leftovers on both sides pair up as re-pins, in order', () => {
    const pairing = pairPrintings(
      [holding('lea:161', 2), holding('2xm:157', 1)],
      [holding('lea:161', 2), holding('clb:187', 1)],
    )
    expect(
      pairing.repinned.map((pair) => [label(pair.from.printing), label(pair.to.printing)]),
    ).toEqual([['2xm:157', 'clb:187']])
    expect(pairing.added).toEqual([])
    expect(pairing.removed).toEqual([])
  })

  test('a source printing with nothing left to pair against is an addition', () => {
    const pairing = pairPrintings(
      [holding('lea:161', 3)],
      [holding('lea:161', 2), holding('2xm:157', 1)],
    )
    expect(pairing.repinned).toEqual([])
    expect(pairing.added.map((holding) => label(holding.printing))).toEqual(['2xm:157'])
    expect(pairing.removed).toEqual([])
  })

  test('a destination printing the source no longer holds is a removal', () => {
    const pairing = pairPrintings(
      [holding('lea:161', 2), holding('2xm:157', 1)],
      [holding('lea:161', 3)],
    )
    expect(pairing.removed.map((holding) => label(holding.printing))).toEqual(['2xm:157'])
    expect(pairing.added).toEqual([])
  })

  test('a source mixing bare and stated printings pairs each on its own terms', () => {
    // The bare holding must claim a leftover rather than re-pinning one: it
    // states no preference, so nothing about it is a printing change.
    const pairing = pairPrintings(
      [holding('lea:161', 2), holding('2xm:157', 1)],
      [holding('-', 2), holding('2xm:157', 1)],
    )
    expect(pairing.repinned).toEqual([])
    expect(pairing.added).toEqual([])
    expect(pairing.removed).toEqual([])
    expect(pairing.kept.map((pair) => label(pair.from.printing)).sort()).toEqual([
      '2xm:157',
      'lea:161',
    ])
  })

  test('the same printing in two finishes does not pair with itself', () => {
    const pairing = pairPrintings(
      [holding('c21:240', 2)],
      [holding('c21:240', 1), holding('c21:240', 1, 'foil')],
    )
    expect(pairing.kept).toHaveLength(1)
    expect(pairing.added.map((holding) => holding.printing.finish)).toEqual(['foil'])
  })
})

describe('printingsAlign', () => {
  test('a source stating no printing agrees with anything', () => {
    expect(printingsAlign([holding('lea:161', 1), holding('2xm:157', 1)], [holding('-', 2)])).toBe(
      true,
    )
  })

  test('the same printings on both sides align, whatever the quantities', () => {
    expect(
      printingsAlign(
        [holding('lea:161', 1), holding('2xm:157', 3)],
        [holding('2xm:157', 1), holding('lea:161', 9)],
      ),
    ).toBe(true)
  })

  test('a printing with no counterpart at all does not align', () => {
    // The source splits its copies across a printing the destination has
    // nowhere to put: squaring this up means adding a copy.
    expect(
      printingsAlign([holding('lea:161', 3)], [holding('lea:161', 2), holding('2xm:157', 1)]),
    ).toBe(false)
    // And the mirror: a printing the source dropped entirely.
    expect(
      printingsAlign([holding('lea:161', 2), holding('2xm:157', 1)], [holding('lea:161', 3)]),
    ).toBe(false)
  })

  test('holding one card at different printings is not a mismatch on its own', () => {
    // One holding each: `--sync-printings` would re-pin these, adding and
    // removing nothing. Reporting it would mean warning about every card of
    // every deck whose printings are not already in sync.
    expect(printingsAlign([holding('lea:161', 3)], [holding('2xm:157', 3)])).toBe(true)
  })

  test('a bare destination against a stated source aligns — the pull’s common case', () => {
    // A local file with no printings, pulled against Archidekt, which always
    // states an edition. A mismatch here would be one warning per card on every
    // ordinary pull.
    expect(printingsAlign([holding('-', 2)], [holding('lea:161', 2)])).toBe(true)
  })
})

describe('distributeQuantity', () => {
  test('leaves the holdings alone when the total already matches', () => {
    expect(distributeQuantity([2, 1], 3)).toEqual([2, 1])
  })

  test('puts a surplus on the first holding', () => {
    expect(distributeQuantity([2, 1], 5)).toEqual([4, 1])
  })

  test('drains a shortfall from the last holding backwards', () => {
    // The trailing holdings give up their copies before the primary one does.
    expect(distributeQuantity([2, 1], 1)).toEqual([1, 0])
    expect(distributeQuantity([2, 1], 2)).toEqual([2, 0])
  })

  test('never goes negative, and zeroes everything for a zero total', () => {
    expect(distributeQuantity([2, 1], 0)).toEqual([0, 0])
  })

  test('invents nothing when there is nothing to spread over', () => {
    expect(distributeQuantity([], 4)).toEqual([])
  })
})
