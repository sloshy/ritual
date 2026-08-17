import { afterEach, describe, expect, test } from 'bun:test'
import { resetPriceView, selectUsdSource, setEnabledPriceSources } from '../../src/site/price-view'
import type { BuylistQuoteRequest, BuylistQuotesResponse } from '../../src/buylist'
import {
  buylistError,
  buylistFieldsFor,
  requestBuylistQuotes,
  resetBuylistFetcher,
  resetBuylistQuotes,
  setBuylistFetcher,
} from '../../src/site/buylist-quotes'
import { resetSellMode, setSellModeActive } from '../../src/site/sell-mode'
import { makeScryfallCard } from '../test-utils'
import {
  allocateSellQuantities,
  isEmptySellSummary,
  sellShortfallNote,
  selectionToCartCsv,
  summarizeSellValue,
  type SellableCard,
} from '../../src/site/sell-value'

/** A quote as the API files it, keyed by `set:collectorNumber:finish`. */
type QuoteSpec = {
  key: string
  productId: number
  priceBuy: number
  qtyBuying: number
  priceRetail?: number
  name?: string
  edition?: string
  variation?: string
}

/** Load the store with quotes from a stub transport, as a page would. */
async function seedQuotes(specs: QuoteSpec[]): Promise<void> {
  setBuylistFetcher(async (buyer) => {
    const response: BuylistQuotesResponse = {
      success: true,
      buyer,
      quotes: Object.fromEntries(
        specs.map((spec) => [
          spec.key,
          {
            priceBuy: spec.priceBuy,
            qtyBuying: spec.qtyBuying,
            priceRetail: spec.priceRetail ?? 0,
            qtyRetail: spec.priceRetail !== undefined ? 1 : 0,
            buying: spec.qtyBuying > 0 && spec.priceBuy > 0,
            finish: 'nonfoil' as const,
            matchVia: 'scryfall-id' as const,
            productId: spec.productId,
            name: spec.name ?? 'Sol Ring',
            edition: spec.edition ?? 'Commander 2021',
            variation: spec.variation,
          },
        ]),
      ),
      feedCreatedAt: '2026-08-04 06:06:09',
      feedRetrievedAt: 1785850800000,
      stale: false,
      productCount: specs.length,
    }
    return response
  })
  await requestBuylistQuotes(
    specs.map((spec) => {
      const [set, collectorNumber] = spec.key.split(':')
      return { set: set!, collectorNumber: collectorNumber!, finish: 'nonfoil' as const }
    }),
  )
}

const card = (collectorNumber: string, quantity: number): SellableCard => ({
  quantity,
  set: 'dsk',
  collectorNumber,
  finish: 'nonfoil',
  scryfallCard: null,
})

afterEach(() => {
  resetBuylistQuotes()
  resetSellMode()
  // The fetcher install is module-global and `bun test` shares the module across
  // files, so leaving one behind would hand the next suite this file's quotes.
  resetBuylistFetcher()
  resetPriceView()
})

describe('allocateSellQuantities', () => {
  test('caps a tile at the buyer’s remaining quantity and prices only those copies', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])

    expect(allocateSellQuantities([card('1', 5)])[0]).toMatchObject({
      sellableQuantity: 3,
      value: 6,
    })
  })

  test('never quotes a proxy, however good the buyer’s offer for the printing is', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])

    expect(allocateSellQuantities([{ ...card('1', 2), labels: ['proxy'] }])[0]).toMatchObject({
      quote: undefined,
      sellableQuantity: 0,
      value: 0,
    })
    // The cart never carries a row for it either.
    expect(selectionToCartCsv([{ ...card('1', 2), labels: ['proxy'] }]).cardCount).toBe(0)
  })

  test('never quotes a copy wearing custom art — it is not that printing', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])

    const custom = { ...card('1', 2), customArt: 'art/sol-ring.jpg' }
    expect(allocateSellQuantities([custom])[0]).toMatchObject({
      quote: undefined,
      sellableQuantity: 0,
      value: 0,
    })
    expect(selectionToCartCsv([custom]).cardCount).toBe(0)
  })

  test('shares one budget across tiles resolving to the same product', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])

    const allocations = allocateSellQuantities([card('1', 2), card('1', 2)])

    expect(allocations.map((a) => a.sellableQuantity)).toEqual([2, 1])
  })

  test('allocates nothing for a paused offer, but still reports the quote', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 5, qtyBuying: 0 }])

    expect(allocateSellQuantities([card('1', 2)])[0]).toMatchObject({
      sellableQuantity: 0,
      value: 0,
      quote: { buying: false },
    })
  })
})

describe('summarizeSellValue', () => {
  test('separates copies with no offer from copies over the buyer’s limit', async () => {
    await seedQuotes([
      { key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 1 },
      { key: 'dsk:2:nonfoil', productId: 11, priceBuy: 4, qtyBuying: 0 },
    ])

    const summary = summarizeSellValue([card('1', 3), card('2', 2), card('9', 1)])

    expect(summary).toEqual({
      value: 2,
      sellableCount: 1,
      // 2 paused copies + 1 unquoted copy.
      notOnBuylistCount: 3,
      overLimitCount: 2,
      nonEnglishCount: 0,
    })
  })

  test('is all zeros with no quotes loaded, so sell mode off costs nothing', () => {
    expect(summarizeSellValue([card('1', 4)])).toEqual({
      value: 0,
      sellableCount: 0,
      notOnBuylistCount: 4,
      overLimitCount: 0,
      nonEnglishCount: 0,
    })
  })

  test('counts non-English copies separately — they are never quotable', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 4 }])

    // Same printing, but the entry carries a [ja] token: the English quote for
    // dsk:1 must not price it.
    const jaCard = { ...card('1', 2), language: 'ja' as const }
    expect(summarizeSellValue([jaCard])).toEqual({
      value: 0,
      sellableCount: 0,
      notOnBuylistCount: 0,
      overLimitCount: 0,
      nonEnglishCount: 2,
    })
  })
})

describe('isEmptySellSummary', () => {
  test('is true only when no copies at all went into the summary', () => {
    // The header stats read their visibility off this, so a summary whose copies
    // are all *unsellable* must still count as non-empty: "$0.00 (3 cards not on
    // buylist)" is the answer for a page the buyer wants nothing from.
    expect(isEmptySellSummary(summarizeSellValue([]))).toBe(true)
    expect(isEmptySellSummary(summarizeSellValue([card('1', 3)]))).toBe(false)
  })
})

describe('sellShortfallNote', () => {
  test('is null when the buyer takes everything', () => {
    expect(
      sellShortfallNote({
        value: 10,
        sellableCount: 4,
        notOnBuylistCount: 0,
        overLimitCount: 0,
        nonEnglishCount: 0,
      }),
    ).toBeNull()
  })

  test('names both shortfall kinds, singularizing a lone card', () => {
    expect(
      sellShortfallNote({
        value: 0,
        sellableCount: 0,
        notOnBuylistCount: 1,
        overLimitCount: 2,
        nonEnglishCount: 0,
      }),
    ).toBe("(1 card not on buylist, 2 over the buyer's limit)")
  })

  test('names non-English copies with their own not-quotable wording', () => {
    expect(
      sellShortfallNote({
        value: 0,
        sellableCount: 0,
        notOnBuylistCount: 0,
        overLimitCount: 0,
        nonEnglishCount: 1,
      }),
    ).toBe('(1 non-English card — not quotable)')
  })
})

describe('selectionToCartCsv', () => {
  test('uses the buyer’s own listing title and the capped quantities', async () => {
    await seedQuotes([
      {
        key: 'dsk:1:nonfoil',
        productId: 10,
        priceBuy: 2,
        qtyBuying: 2,
        name: 'Overlord of the Balemurk',
        edition: 'Duskmourn: House of Horror',
        // CK's listed title for a variant printing carries their variant note.
        variation: '298 - Borderless',
      },
    ])

    const cart = selectionToCartCsv([card('1', 5)])

    expect(cart.csv).toBe(
      'Overlord of the Balemurk (298 - Borderless),Duskmourn: House of Horror,false,2\n',
    )
  })

  test('omits cards the buyer has no active offer for', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 5, qtyBuying: 0 }])

    expect(selectionToCartCsv([card('1', 2)]).cardCount).toBe(0)
  })
})

describe('buylistFieldsFor', () => {
  const printing = makeScryfallCard({
    id: 'sf-1',
    set: 'dsk',
    collector_number: '1',
    prices: { usd: '6.00' },
  })

  test('is inert while sell mode is off, even with quotes loaded', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])

    // Quotes outlive a toggle-off, so the mode — not the store — is the gate.
    // The spread is 0 rather than the -$6 the card would score in sell mode:
    // with the sort's controls gone, nothing may keep reordering the page.
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, {})).toMatchObject({
      buylistPrice: 0,
      buylistSpread: 0,
      onBuylist: false,
    })
    setSellModeActive(true)
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, {})).toMatchObject({
      buylistPrice: 2,
      buylistSpread: -4,
      onBuylist: true,
    })
  })

  test('the spread compares against the selected price store, not always Scryfall', async () => {
    await seedQuotes([
      { key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3, priceRetail: 8 },
    ])
    setSellModeActive(true)
    setEnabledPriceSources(['tcgplayer', 'cardkingdom'])

    // TCGplayer view: offer vs Scryfall's $6.00.
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, {}).buylistSpread).toBe(-4)
    // Card Kingdom view: offer vs CK's own $8.00 retail — apples to apples.
    selectUsdSource('cardkingdom')
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, {}).buylistSpread).toBe(-6)
  })

  test('a paused offer does not count as being on the buylist', async () => {
    await seedQuotes([{ key: 'dsk:5:nonfoil', productId: 10, priceBuy: 9, qtyBuying: 0 }])
    setSellModeActive(true)
    const paused = makeScryfallCard({
      id: 'sf-5',
      set: 'dsk',
      collector_number: '5',
      prices: { usd: '3.00' },
    })

    expect(buylistFieldsFor(paused, 'nonfoil', undefined, {})).toMatchObject({
      buylistPrice: 0,
      // Card Kingdom's feed carries every product they have ever sold, ~45% of
      // it paused. Counting a mere catalog entry as "on the buylist" made the
      // filter and the grouping pass nearly every English printing while the
      // tile beside them showed no offer at all.
      onBuylist: false,
      // A paused offer is not money you can get today, so it counts as 0 on the
      // buylist side of the spread — leaving the card's retail price as a loss.
      buylistSpread: -3,
    })
  })

  test('a copy that is priceless by rule is never quoted, whatever the offer', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])
    setSellModeActive(true)

    expect(buylistFieldsFor(printing, 'nonfoil', undefined, { labels: ['proxy'] })).toMatchObject({
      buylistPrice: 0,
      buylistSpread: 0,
      onBuylist: false,
    })
    // A copy wearing custom art is refused for the same reason: it is no longer
    // the printing the quote would be for.
    expect(
      buylistFieldsFor(printing, 'nonfoil', undefined, { customArt: 'art/sol-ring.jpg' }),
    ).toMatchObject({
      buylistPrice: 0,
      buylistSpread: 0,
      onBuylist: false,
    })
    // And by the sidecar fact alone: an art file the build could not deploy
    // leaves the tile showing its real printing, with nothing to quote.
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, { hasCustomArt: true })).toMatchObject({
      buylistPrice: 0,
      buylistSpread: 0,
      onBuylist: false,
    })
    // Any other label leaves the quote exactly as it was.
    expect(buylistFieldsFor(printing, 'nonfoil', undefined, { labels: ['keep'] })).toMatchObject({
      buylistPrice: 2,
      onBuylist: true,
    })
  })

  test('resolves the finish from the printing when the entry states none', async () => {
    await seedQuotes([{ key: 'dsk:2:foil', productId: 11, priceBuy: 5, qtyBuying: 1 }])
    setSellModeActive(true)
    // A foil-only printing is foil, not nonfoil — the `displayFinish` rule.
    const foilOnly = makeScryfallCard({
      id: 'sf-2',
      set: 'dsk',
      collector_number: '2',
      finishes: ['foil'],
      prices: { usd: '10.00', usd_foil: '30.00' },
    })

    expect(buylistFieldsFor(foilOnly, undefined, undefined, {})).toMatchObject({
      buylistPrice: 5,
      // The retail half follows the same finish: against the nonfoil price the
      // spread would be -5.
      buylistSpread: -25,
      onBuylist: true,
    })
  })
})

describe('buylistFieldsFor spread', () => {
  test('is the offer minus USD retail, never the page’s display currency', async () => {
    await seedQuotes([{ key: 'dsk:3:nonfoil', productId: 12, priceBuy: 4, qtyBuying: 1 }])
    setSellModeActive(true)
    const priced = makeScryfallCard({
      id: 'sf-3',
      set: 'dsk',
      collector_number: '3',
      prices: { usd: '10.00', eur: '1.00' },
    })

    // Against EUR this would be +3, a number that means nothing.
    expect(buylistFieldsFor(priced, 'nonfoil', undefined, {}).buylistSpread).toBe(-6)
  })

  test('is rounded to cents, not left to float drift', async () => {
    await seedQuotes([{ key: 'dsk:7:nonfoil', productId: 14, priceBuy: 4.1, qtyBuying: 1 }])
    setSellModeActive(true)
    const priced = makeScryfallCard({
      id: 'sf-7',
      set: 'dsk',
      collector_number: '7',
      prices: { usd: '10.30' },
    })

    // The raw subtraction is -6.199999999999999.
    expect(buylistFieldsFor(priced, 'nonfoil', undefined, {}).buylistSpread).toBe(-6.2)
  })

  test('counts a missing USD retail price as zero', async () => {
    await seedQuotes([{ key: 'dsk:4:nonfoil', productId: 13, priceBuy: 4, qtyBuying: 1 }])
    setSellModeActive(true)
    const eurOnly = makeScryfallCard({
      id: 'sf-4',
      set: 'dsk',
      collector_number: '4',
      prices: { eur: '9.00' },
    })

    // The EUR price is deliberately not substituted: the spread is USD on both
    // sides, and a card with no USD retail is compared against 0.
    expect(buylistFieldsFor(eurOnly, 'nonfoil', undefined, {})).toMatchObject({
      buylistPrice: 4,
      buylistSpread: 4,
      onBuylist: true,
    })
  })

  test('counts a card with no offer at all as the full retail loss', async () => {
    setSellModeActive(true)
    const unquoted = makeScryfallCard({
      id: 'sf-6',
      set: 'dsk',
      collector_number: '6',
      prices: { usd: '7.50' },
    })

    expect(buylistFieldsFor(unquoted, 'nonfoil', undefined, {})).toMatchObject({
      buylistPrice: 0,
      buylistSpread: -7.5,
      onBuylist: false,
    })
  })
})

describe('requestBuylistQuotes', () => {
  const ask = (collectorNumber: string) => ({
    set: 'dsk',
    collectorNumber,
    finish: 'nonfoil' as const,
  })

  /** Record every batch a run posts, answering with no quotes. */
  function recordingFetcher(): BuylistQuoteRequest[][] {
    const batches: BuylistQuoteRequest[][] = []
    setBuylistFetcher(async (buyer, printings) => {
      batches.push(printings)
      return {
        success: true,
        buyer,
        quotes: {},
        feedCreatedAt: '',
        feedRetrievedAt: 0,
        stale: false,
        productCount: 0,
      }
    })
    return batches
  }

  test('asks once per printing, and never re-asks one already answered for', async () => {
    const batches = recordingFetcher()

    await requestBuylistQuotes([ask('1'), ask('2'), ask('1')])
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)

    // A miss is still an answer: re-requesting must not hit the network again.
    await requestBuylistQuotes([ask('1'), ask('2')])
    expect(batches).toHaveLength(1)
  })

  test('records a failure so the UI can explain an empty sell mode', async () => {
    setBuylistFetcher(() => Promise.reject(new Error('Buylist quotes failed: HTTP 503')))

    await requestBuylistQuotes([ask('1')])

    expect(buylistError()).toContain('503')
  })

  test('switching buyers drops the previous buyer’s quotes', async () => {
    await seedQuotes([{ key: 'dsk:1:nonfoil', productId: 10, priceBuy: 2, qtyBuying: 3 }])
    setSellModeActive(true)
    expect(summarizeSellValue([card('1', 1)]).value).toBe(2)

    const batches = recordingFetcher()
    await requestBuylistQuotes([ask('1')], 'cardkingdom')
    // Same buyer, already resolved: nothing re-asked, quotes intact.
    expect(batches).toHaveLength(0)
    expect(summarizeSellValue([card('1', 1)]).value).toBe(2)
  })
})
