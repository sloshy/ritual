import { describe, expect, test } from 'bun:test'
import {
  buildPriceReport,
  type CardKingdomPricing,
  type PriceListInput,
} from '../../src/price-report'
import type { CardPrintingsLookup } from '../../src/card-printing'
import type { QuotePrinting } from '../../src/cardkingdom/quote'
import type { ScryfallCard } from '../../src/types'
import { makeBuylistQuote, makeScryfallCard } from '../test-utils'

function lookupFor(printings: Record<string, ScryfallCard[]>): CardPrintingsLookup {
  return async (name) => printings[name] ?? []
}

/**
 * A CK lookup over a fixed retail table keyed by `set:cn:finish`, refusing
 * non-English requests exactly as the real matcher does.
 */
function ckFor(retail: Record<string, number>): CardKingdomPricing & { asked: QuotePrinting[] } {
  const asked: QuotePrinting[] = []
  return {
    asked,
    quote: (printing) => {
      asked.push(printing)
      if (printing.language !== undefined && printing.language !== 'en') return null
      const price = retail[`${printing.set}:${printing.collectorNumber}:${printing.finish}`]
      if (price === undefined) return null
      return makeBuylistQuote({ priceRetail: price, qtyRetail: 1, finish: printing.finish })
    },
  }
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
