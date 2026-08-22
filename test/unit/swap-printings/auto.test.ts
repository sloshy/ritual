import { describe, expect, test } from 'bun:test'
import {
  autoAllocate,
  currentPrintingPrice,
  rankOptions,
  type SwapAutoOptions,
  type SwapRankedOption,
} from '../../../src/editor/swap-printings'
import {
  BINDER,
  CUBE,
  WANTS,
  bolt,
  boltFoilOnly,
  boltLea,
  boltSta,
  makeCandidate,
  makeTarget,
  priceOf,
  printinglessCandidate,
  uncachedCandidate,
} from './fixtures'

const most: SwapAutoOptions = { mode: 'most-expensive', unpriced: 'skip', finish: 'any' }
const least: SwapAutoOptions = { mode: 'least-expensive', unpriced: 'skip', finish: 'any' }

// Target: 1x M10 Bolt nonfoil at $2. Candidates: LEA $400, STA foil $25, STA nonfoil $10.
const lea = makeCandidate(BINDER, boltLea, 1, 400)
const staFoil = makeCandidate(BINDER, boltSta, 2, 25, 'foil')
const sta = makeCandidate(CUBE, boltSta, 3, 10)
/** A priced cheap printing below the target's $2. */
const cheap = makeCandidate(CUBE, bolt('cheap', '1', 0.5), 5, 0.5)
const uncached = uncachedCandidate(BINDER, 1)

function counts(plan: ReturnType<typeof autoAllocate>): Array<[string, number]> {
  return plan.allocations.map((a) => [a.candidate.key, a.count])
}

describe('currentPrintingPrice', () => {
  test('prices the current printing at its resolved finish', () => {
    expect(currentPrintingPrice(makeTarget(), priceOf)).toBe(2)
    expect(currentPrintingPrice(makeTarget({ finish: 'foil' }), priceOf)).toBe(30)
    // A foil-only printing with no stated finish is foil, not an unpriced nonfoil.
    expect(
      currentPrintingPrice(
        makeTarget({ set: 'plst', collectorNumber: 'M10-146', card: boltFoilOnly }),
        priceOf,
      ),
    ).toBe(7)
    expect(currentPrintingPrice(makeTarget({ language: 'ja' }), priceOf)).toBe(4)
    expect(currentPrintingPrice(makeTarget({ card: null }), priceOf)).toBeNull()
  })
})

describe('autoAllocate', () => {
  test('no candidates after the finish filter: keep everything and flag no-candidates', () => {
    const plan = autoAllocate(makeTarget(), [sta], { ...most, finish: 'foil' }, priceOf)
    expect(plan).toMatchObject({ allocations: [], keep: 1, flags: ['no-candidates'] })
    // The unfiltered candidates stay on the plan (as a copy) for a later manual pick.
    const input = [sta]
    const kept = autoAllocate(makeTarget(), input, { ...most, finish: 'foil' }, priceOf)
    expect(kept.candidates).toEqual(input)
    expect(kept.candidates).not.toBe(input)
  })

  test('the finish filter narrows who can win but leaves the plan candidates whole', () => {
    const plan = autoAllocate(makeTarget(), [lea, staFoil], { ...most, finish: 'foil' }, priceOf)
    expect(counts(plan)).toEqual([[staFoil.key, 1]])
    expect(plan.candidates).toEqual([lea, staFoil])
  })

  test('most-expensive takes the priciest candidate and displaces the current copy', () => {
    const plan = autoAllocate(makeTarget(), [sta, lea, staFoil], most, priceOf)
    expect(counts(plan)).toEqual([[lea.key, 1]])
    expect(plan.keep).toBe(0)
    expect(plan.flags).toEqual([])
  })

  test('least-expensive keeps the current printing when it is already the cheapest', () => {
    const plan = autoAllocate(makeTarget(), [sta, lea, staFoil], least, priceOf)
    expect(plan.allocations).toEqual([])
    expect(plan.keep).toBe(1)
    expect(plan.flags).toEqual([])
  })

  test('least-expensive moves to a cheaper candidate when one exists', () => {
    const plan = autoAllocate(makeTarget(), [sta, cheap], least, priceOf)
    expect(counts(plan)).toEqual([[cheap.key, 1]])
    expect(plan.keep).toBe(0)
  })

  test('fills a quantity across several candidates from the best down', () => {
    const target = makeTarget({ quantity: 4 })
    const plan = autoAllocate(target, [sta, lea, staFoil], most, priceOf)
    expect(counts(plan)).toEqual([
      [lea.key, 1],
      [staFoil.key, 2],
      [sta.key, 1],
    ])
    expect(plan.keep).toBe(0)
    expect(plan.flags).toEqual([])
  })

  test('a candidate with nothing available produces no allocation', () => {
    const empty = makeCandidate(BINDER, boltLea, 0, 400)
    const plan = autoAllocate(makeTarget({ quantity: 2 }), [empty, sta], most, priceOf)
    expect(counts(plan)).toEqual([[sta.key, 2]])
  })

  test('keeping beats a worse candidate for the remainder without a partial flag', () => {
    // LEA ($400) x1, current ($2) x4, cheap ($0.50) x5 — cheap is never taken.
    const plan = autoAllocate(makeTarget({ quantity: 4 }), [cheap, lea], most, priceOf)
    expect(counts(plan)).toEqual([[lea.key, 1]])
    expect(plan.keep).toBe(3)
    expect(plan.flags).toEqual([])
  })

  test('partial when candidate supply runs out before the quantity is filled', () => {
    const plan = autoAllocate(makeTarget({ quantity: 4 }), [lea], most, priceOf)
    expect(counts(plan)).toEqual([[lea.key, 1]])
    expect(plan.keep).toBe(3)
    expect(plan.flags).toEqual(['partial'])
  })

  test('ties prefer keeping the current printing, then candidate order', () => {
    const same = makeCandidate(BINDER, bolt('tie', '1', 2), 1, 2)
    const plan = autoAllocate(makeTarget(), [same], most, priceOf)
    expect(plan.allocations).toEqual([])
    expect(plan.keep).toBe(1)

    const current: SwapRankedOption = { candidate: null, price: 5, available: 1 }
    const a: SwapRankedOption = { candidate: sta, price: 5, available: 1 }
    const b: SwapRankedOption = { candidate: lea, price: 5, available: 1 }
    expect(rankOptions([b, a, current], 'least-expensive')).toEqual([current, b, a])
  })

  test('rankOptions orders by price in both directions and drops unpriced options', () => {
    const cheapOpt: SwapRankedOption = { candidate: cheap, price: 0.5, available: 1 }
    const staOpt: SwapRankedOption = { candidate: sta, price: 10, available: 1 }
    const none: SwapRankedOption = { candidate: uncached, price: null, available: 1 }
    expect(rankOptions([cheapOpt, none, staOpt], 'most-expensive')).toEqual([staOpt, cheapOpt])
    expect(rankOptions([staOpt, none, cheapOpt], 'least-expensive')).toEqual([cheapOpt, staOpt])
  })

  describe('unpriced policy', () => {
    test('skip leaves the card unchanged and flags it', () => {
      const plan = autoAllocate(
        makeTarget(),
        [lea, uncached],
        { ...most, unpriced: 'skip' },
        priceOf,
      )
      expect(plan).toMatchObject({ allocations: [], keep: 1, flags: ['unpriced-candidates'] })
    })

    test('force hands the card to the manual picker', () => {
      const plan = autoAllocate(
        makeTarget(),
        [lea, uncached],
        { ...most, unpriced: 'force' },
        priceOf,
      )
      expect(plan).toMatchObject({
        allocations: [],
        keep: 1,
        flags: ['needs-manual', 'unpriced-candidates'],
      })
    })

    test('ignore ranks the priced candidates and still flags the card', () => {
      const plan = autoAllocate(
        makeTarget(),
        [uncached, lea],
        { ...most, unpriced: 'ignore' },
        priceOf,
      )
      expect(counts(plan)).toEqual([[lea.key, 1]])
      expect(plan.flags).toEqual(['unpriced-candidates'])
    })

    test('a printingless candidate is never auto-selectable and does not trip the unpriced policy', () => {
      const plan = autoAllocate(makeTarget(), [lea, printinglessCandidate(WANTS, 1)], most, priceOf)
      expect(counts(plan)).toEqual([[lea.key, 1]])
      expect(plan.flags).toEqual([])
      // Alone, it leaves the card with nothing to rank — not "unpriced".
      const alone = autoAllocate(makeTarget(), [printinglessCandidate(WANTS, 1)], most, priceOf)
      expect(alone).toMatchObject({ allocations: [], keep: 1, flags: ['no-candidates'] })
    })

    test('an unpriced current printing under ignore never ranks, so leftovers stay and read partial', () => {
      const target = makeTarget({ quantity: 3, card: null })
      const plan = autoAllocate(target, [cheap], { ...least, unpriced: 'ignore' }, priceOf)
      expect(counts(plan)).toEqual([[cheap.key, 3]])
      expect(plan.keep).toBe(0)
      expect(plan.flags).toEqual(['unpriced-candidates'])
      const short = autoAllocate(target, [lea], { ...least, unpriced: 'ignore' }, priceOf)
      expect(counts(short)).toEqual([[lea.key, 1]])
      expect(short.keep).toBe(2)
      expect(short.flags).toEqual(['unpriced-candidates', 'partial'])
    })

    test('a priced pool with a priced current printing raises no unpriced flag under any policy', () => {
      for (const unpriced of ['skip', 'ignore', 'force'] as const) {
        const plan = autoAllocate(makeTarget(), [lea, sta], { ...most, unpriced }, priceOf)
        expect(counts(plan)).toEqual([[lea.key, 1]])
        expect(plan.flags).toEqual([])
      }
    })
  })
})
