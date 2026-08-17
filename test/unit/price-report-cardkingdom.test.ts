import { describe, expect, test } from 'bun:test'
import {
  buildPriceReport,
  type CardKingdomPricing,
  type PriceListInput,
} from '../../src/price-report'
import type { CardPrintingsLookup } from '../../src/card-printing'
import type { QuotePrinting } from '../../src/cardkingdom/quote'
import type { ScryfallCard } from '../../src/types'
import { ckRetailQuote, makeBuylistQuote, makeScryfallCard } from '../test-utils'

function lookupFor(printings: Record<string, ScryfallCard[]>): CardPrintingsLookup {
  return async (name) => printings[name] ?? []
}

/** The report's CK seam over the shared retail stub, with its ask log exposed. */
function ckFor(retail: Record<string, number>): CardKingdomPricing & { asked: QuotePrinting[] } {
  const quote = ckRetailQuote(retail)
  return { quote, asked: quote.asked }
}

const bolt = makeScryfallCard({
  id: 'sf-bolt-aaa',
  name: 'Test Card',
  set: 'aaa',
  collector_number: '1',
  finishes: ['nonfoil', 'foil'],
  prices: { usd: '9.99', usd_foil: '19.99' },
})

function collectionInput(entries: PriceListInput['entries']): PriceListInput {
  return { type: 'collection', name: 'Binder', entries }
}

describe('buildPriceReport with Card Kingdom pricing', () => {
  test('prices a pinned entry at CK retail, never the Scryfall figure', async () => {
    const ck = ckFor({ 'aaa:1:nonfoil': 4.5 })
    const { report } = await buildPriceReport(
      [
        collectionInput([
          { name: 'Test Card', quantity: 2, set: 'aaa', collectorNumber: '1', section: 'Main' },
        ]),
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }), cardKingdom: ck },
    )
    expect(report.source).toBe('cardkingdom')
    expect(report.entries[0]!.price).toBe(4.5)
    expect(report.entries[0]!.unpricedReason).toBeUndefined()
    expect(report.totals.total).toBe(9)
    // The lookup carried the Scryfall id, the primary CK join key.
    expect(ck.asked[0]!.scryfallId).toBe('sf-bolt-aaa')
  })

  test('a printing CK does not sell is honestly unpriced — no Scryfall fallback', async () => {
    const { report } = await buildPriceReport(
      [
        collectionInput([
          { name: 'Test Card', quantity: 1, set: 'aaa', collectorNumber: '1', section: 'Main' },
        ]),
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }), cardKingdom: ckFor({}) },
    )
    expect(report.entries[0]!.price).toBe(0)
    expect(report.entries[0]!.unpricedReason).toBe('no-price-data')
  })

  test('a published retail of 0 is unpriced, not a free card', async () => {
    const ck = ckFor({})
    const zero: CardKingdomPricing = {
      quote: (printing) => {
        ck.quote(printing)
        return makeBuylistQuote({ priceRetail: 0, qtyRetail: 0 })
      },
    }
    const { report } = await buildPriceReport(
      [
        collectionInput([
          { name: 'Test Card', quantity: 1, set: 'aaa', collectorNumber: '1', section: 'Main' },
        ]),
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }), cardKingdom: zero },
    )
    expect(report.entries[0]!.price).toBe(0)
    expect(report.entries[0]!.unpricedReason).toBe('no-price-data')
  })

  test('a non-English entry is never quoted against the English-only feed', async () => {
    const { report } = await buildPriceReport(
      [
        collectionInput([
          {
            name: 'Test Card',
            quantity: 1,
            set: 'aaa',
            collectorNumber: '1',
            language: 'ja',
            section: 'Main',
          },
        ]),
      ],
      {
        currency: 'usd',
        lookup: lookupFor({ 'Test Card': [bolt] }),
        cardKingdom: ckFor({ 'aaa:1:nonfoil': 4.5 }),
      },
    )
    expect(report.entries[0]!.price).toBe(0)
    expect(report.entries[0]!.unpricedReason).toBe('no-price-data')
  })

  test("the entry's language token reaches the matcher", async () => {
    const ck = ckFor({ 'aaa:1:nonfoil': 4.5 })
    await buildPriceReport(
      [
        collectionInput([
          {
            name: 'Test Card',
            quantity: 1,
            set: 'aaa',
            collectorNumber: '1',
            language: 'ja',
            section: 'Main',
          },
        ]),
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }), cardKingdom: ck },
    )
    // The cheapest-printing scan asks language-neutrally first; the entry's
    // own quote must carry the token so the matcher can refuse it.
    expect(ck.asked.some((printing) => printing.language === 'ja')).toBe(true)
  })

  test('the lowest price is the cheapest printing+finish CK actually sells', async () => {
    const other = makeScryfallCard({
      id: 'sf-bolt-bbb',
      name: 'Test Card',
      set: 'bbb',
      collector_number: '2',
      finishes: ['nonfoil'],
      prices: { usd: '0.05' },
    })
    const ck = ckFor({ 'aaa:1:nonfoil': 4.5, 'aaa:1:foil': 3.25, 'bbb:2:nonfoil': 6 })
    const { report } = await buildPriceReport(
      [
        {
          type: 'deck',
          name: 'Deck',
          entries: [{ name: 'Test Card', quantity: 1, section: 'Mainboard' }],
        },
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt, other] }), cardKingdom: ck },
    )
    // Scryfall's 5¢ printing is irrelevant: CK's cheapest offering is the foil at $3.25.
    expect(report.entries[0]!.lowest).toBe(3.25)
    expect(report.entries[0]!.lowestFinish).toBe('foil')
  })

  test('an unpinned entry is priced at a printing CK actually sells', async () => {
    // Scryfall's newest printing is the representative it would pick; CK stocks
    // only the older one, which is what the entry must be priced at.
    const newer = makeScryfallCard({
      id: 'sf-bolt-ccc',
      name: 'Test Card',
      set: 'ccc',
      collector_number: '7',
      released_at: '2026-01-01',
      prices: { usd: '11.00' },
    })
    const older = makeScryfallCard({
      id: 'sf-bolt-ddd',
      name: 'Test Card',
      set: 'ddd',
      collector_number: '8',
      released_at: '2015-01-01',
      prices: { usd: '10.00' },
    })
    const ck = ckFor({ 'ddd:8:nonfoil': 7.25 })
    const { report } = await buildPriceReport(
      [
        {
          type: 'deck',
          name: 'Deck',
          entries: [{ name: 'Test Card', quantity: 1, section: 'Mainboard' }],
        },
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [newer, older] }), cardKingdom: ck },
    )
    expect(report.entries[0]!.set).toBe('ddd')
    expect(report.entries[0]!.price).toBe(7.25)
    expect(report.entries[0]!.unpricedReason).toBeUndefined()
  })

  test('an unpinned entry CK stocks no printing of stays unpriced, showing the Scryfall pick', async () => {
    // Two printings, oldest first: only the *representative* fallback yields
    // `ccc`, so the assertion cannot pass on `printings[0]` by accident.
    const older = makeScryfallCard({
      id: 'sf-bolt-ddd',
      name: 'Test Card',
      set: 'ddd',
      collector_number: '8',
      released_at: '2015-01-01',
      prices: { usd: '10.00' },
    })
    const newer = makeScryfallCard({
      id: 'sf-bolt-ccc',
      name: 'Test Card',
      set: 'ccc',
      collector_number: '7',
      released_at: '2026-01-01',
      prices: { usd: '11.00' },
    })
    const ck = ckFor({})
    const { report } = await buildPriceReport(
      [
        {
          type: 'deck',
          name: 'Deck',
          entries: [{ name: 'Test Card', quantity: 1, section: 'Mainboard' }],
        },
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [older, newer] }), cardKingdom: ck },
    )
    expect(report.entries[0]!.price).toBe(0)
    expect(report.entries[0]!.set).toBe('ccc')
    expect(report.entries[0]!.unpricedReason).toBe('no-price-data')
  })

  test("a wanted printing pin without a finish takes CK's cheapest finish of it", async () => {
    // "This printing, any finish" — priced from CK like everything else, or the
    // lowest figure would mix a Scryfall number into a Card Kingdom total.
    const ck = ckFor({ 'aaa:1:nonfoil': 4.5, 'aaa:1:foil': 2.75 })
    const { report } = await buildPriceReport(
      [
        {
          type: 'wanted',
          name: 'Wants',
          entries: [
            { name: 'Test Card', quantity: 1, set: 'aaa', collectorNumber: '1', section: 'Main' },
          ],
        },
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }), cardKingdom: ck },
    )
    expect(report.entries[0]!.price).toBe(4.5)
    expect(report.entries[0]!.lowest).toBe(2.75)
  })

  test('a plain Scryfall report is unchanged and carries no source', async () => {
    const { report } = await buildPriceReport(
      [
        collectionInput([
          { name: 'Test Card', quantity: 1, set: 'aaa', collectorNumber: '1', section: 'Main' },
        ]),
      ],
      { currency: 'usd', lookup: lookupFor({ 'Test Card': [bolt] }) },
    )
    expect(report.source).toBeUndefined()
    expect(report.entries[0]!.price).toBe(9.99)
  })
})
