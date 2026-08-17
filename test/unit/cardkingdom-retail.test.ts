import { describe, expect, test } from 'bun:test'
import {
  cardKingdomDisplayPrints,
  cardKingdomPrints,
  cardKingdomRetail,
} from '../../src/cardkingdom/retail'
import { cardPrintingKey } from '../../src/printing-key'
import type { ScryfallCard } from '../../src/types'
import { ckRetailQuote as ckQuote, makeScryfallCard } from '../test-utils'

/**
 * Four printings of one card, newest first. Prices are Scryfall's; the CK table
 * in each test decides what CK charges (and whether it stocks the printing).
 */
function printings(): ScryfallCard[] {
  return [
    makeScryfallCard({
      id: 'p-new',
      set: 'new',
      collector_number: '1',
      released_at: '2026-01-01',
      prices: { usd: '5.00' },
    }),
    makeScryfallCard({
      id: 'p-mid',
      set: 'mid',
      collector_number: '2',
      released_at: '2024-01-01',
      prices: { usd: '4.00' },
    }),
    makeScryfallCard({
      id: 'p-old',
      set: 'old',
      collector_number: '3',
      released_at: '2020-01-01',
      finishes: ['nonfoil', 'foil'],
      prices: { usd: '3.00', usd_foil: '30.00' },
    }),
    makeScryfallCard({
      id: 'p-anc',
      set: 'anc',
      collector_number: '4',
      released_at: '1995-01-01',
      prices: { usd: '2.00' },
    }),
  ]
}

describe('cardKingdomPrints', () => {
  test('picks the newest printing Card Kingdom actually stocks', () => {
    const all = printings()
    // CK carries neither of the two newest printings.
    const prints = cardKingdomPrints(
      ckQuote({ 'old:3:nonfoil': 3.5, 'anc:4:nonfoil': 2.5 }),
      all,
      all,
    )
    expect(prints.representative?.set).toBe('old')
    expect(prints.cheapest?.card.set).toBe('anc')
    expect(prints.cheapest?.price).toBe(2.5)
  })

  test('slides past a recent printing CK prices far above the median', () => {
    const all = printings()
    const prints = cardKingdomPrints(
      ckQuote({
        'new:1:nonfoil': 400,
        'mid:2:nonfoil': 4,
        'old:3:nonfoil': 3,
        'anc:4:nonfoil': 2,
      }),
      all,
      all,
    )
    expect(prints.representative?.set).toBe('mid')
  })

  test('never picks a banned printing', () => {
    const all = printings()
    const banned = new Set([cardPrintingKey(all[1]!)])
    const prints = cardKingdomPrints(
      ckQuote({ 'mid:2:nonfoil': 4, 'old:3:nonfoil': 3 }),
      all,
      all,
      banned,
    )
    expect(prints.representative?.set).toBe('old')
  })

  test('a card CK carries no printing of yields no picks at all', () => {
    const all = printings()
    const prints = cardKingdomPrints(ckQuote({}), all, all)
    expect(prints.representative).toBeNull()
    expect(prints.cheapest).toBeNull()
  })

  test('the cheapest pick considers foils, which are their own CK product', () => {
    const all = printings()
    const prints = cardKingdomPrints(
      ckQuote({ 'old:3:nonfoil': 9, 'old:3:foil': 1.25, 'anc:4:nonfoil': 4 }),
      all,
      all,
    )
    expect(prints.cheapest?.card).toBe(all[2])
    expect(prints.cheapest?.finish).toBe('foil')
    expect(prints.cheapest?.price).toBe(1.25)
    // The representative is picked per name, before a line's finish is known, so
    // it reads the printing's display finish only.
    expect(prints.representative?.set).toBe('old')
  })

  test('a printing CK publishes at 0 is not a candidate', () => {
    const all = printings()
    const prints = cardKingdomPrints(ckQuote({ 'new:1:nonfoil': 0, 'mid:2:nonfoil': 4 }), all, all)
    // Only the cheapest half is load-bearing here: the representative skips
    // zero-priced candidates on its own, whatever the retail guard returns.
    expect(prints.cheapest?.card.set).toBe('mid')
    expect(prints.representative?.set).toBe('mid')
  })

  test('a foil-only printing is priced — and pickable — at its foil product', () => {
    // Its display finish is foil (no nonfoil to offer), so CK's foil price is
    // the one the pick must read. A hardcoded 'nonfoil' would skip it entirely.
    const foilOnly = makeScryfallCard({
      id: 'p-foil',
      set: 'fol',
      collector_number: '5',
      released_at: '2025-06-01',
      finishes: ['foil'],
      prices: { usd_foil: '6.00' },
    })
    const all = [foilOnly, ...printings()]
    const prints = cardKingdomPrints(ckQuote({ 'fol:5:foil': 6, 'anc:4:nonfoil': 2 }), all, all)
    expect(prints.representative).toBe(foilOnly)
  })

  test('an out-of-stock product keeps its listed price', () => {
    const all = printings()
    // `makeBuylistQuote` answers qtyRetail > 0 by default; the rule under test is
    // that only `priceRetail` gates pricing, so an empty shelf still prices.
    const quote = ckQuote({ 'mid:2:nonfoil': 4 })
    const outOfStock = ((printing) => {
      const hit = quote(printing)
      return hit ? { ...hit, qtyRetail: 0 } : null
    }) as typeof quote
    const prints = cardKingdomPrints(outOfStock, all, all)
    expect(prints.representative?.set).toBe('mid')
    expect(prints.cheapest?.price).toBe(4)
  })

  test('the banned-key check folds case, like the printing key it is built from', () => {
    const upper = makeScryfallCard({
      id: 'p-upper',
      set: 'UPR',
      collector_number: '507A',
      released_at: '2026-02-01',
      prices: { usd: '5.00' },
    })
    const all = [upper, ...printings()]
    const prints = cardKingdomPrints(
      ckQuote({ 'UPR:507A:nonfoil': 5, 'mid:2:nonfoil': 4 }),
      all,
      all,
      new Set(['upr:507a']),
    )
    expect(prints.representative?.set).toBe('mid')
  })
})

describe('cardKingdomDisplayPrints', () => {
  test("the site's cheapest pick reads each printing at its display finish", () => {
    const all = printings()
    // `old` is cheapest only as a foil. A tile prices what it displays at the
    // line's finish, so the display pick must not choose it on a foil price it
    // would then never read — the price-report pick (finish-aware) does.
    const quote = ckQuote({ 'old:3:nonfoil': 9, 'old:3:foil': 1.25, 'anc:4:nonfoil': 4 })
    expect(cardKingdomDisplayPrints(quote, all, all).cheapest?.set).toBe('anc')
    expect(cardKingdomPrints(quote, all, all).cheapest?.card.set).toBe('old')
  })
})

describe('cardKingdomRetail', () => {
  test('a non-English copy is never priced from the English-only feed', () => {
    const card = printings()[0]!
    const quote = ckQuote({ 'new:1:nonfoil': 5 })
    expect(cardKingdomRetail(quote, card, 'nonfoil')).toBe(5)
    expect(cardKingdomRetail(quote, card, 'nonfoil', 'ja')).toBe(0)
  })
})
