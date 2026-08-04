import { describe, expect, test } from 'bun:test'
import {
  buildCardKingdomIndex,
  type CardKingdomFeed,
  type CardKingdomProduct,
} from '../../src/cardkingdom'
import {
  aggregateSellEntries,
  applySellFilters,
  buildSellCartCsv,
  buildSellReport,
  chooseProduct,
  isBuyingEntry,
  parseMinPrice,
  productIsBuying,
  sumSellEntries,
  type BuildSellReportOptions,
  type MatchedSellEntry,
  type SellListEntry,
  type SellListInput,
  type SellReportEntry,
} from '../../src/sell-report'
import type { ScryfallCard } from '../../src/types'
import { makeCardKingdomProduct, makeScryfallCard } from '../test-utils'

/** Assert an entry matched a product, narrowing to the matched arm. */
function expectMatched(entry: SellReportEntry | undefined): MatchedSellEntry {
  if (!entry || entry.status === 'no-match') {
    throw new Error(`Expected a matched entry, got ${entry?.status}`)
  }
  return entry
}

// A card with nonfoil and foil printings in CK's catalog, plus one printing
// (tst:9) CK does not carry, and a card CK links only through its sku.
const PRINTINGS: Record<string, ScryfallCard[]> = {
  Arahbo: [
    makeScryfallCard({
      id: 'sf-a294',
      name: 'Arahbo',
      set: 'fdn',
      collector_number: '294',
      finishes: ['nonfoil', 'foil'],
    }),
    makeScryfallCard({
      id: 'sf-a2',
      name: 'Arahbo',
      set: 'fdn',
      collector_number: '2',
      finishes: ['nonfoil', 'foil'],
    }),
    makeScryfallCard({
      id: 'sf-a9',
      name: 'Arahbo',
      set: 'tst',
      collector_number: '9',
      finishes: ['nonfoil'],
    }),
  ],
  'Skuuronn, Unlinked': [
    makeScryfallCard({
      id: 'sf-sku',
      name: 'Skuuronn, Unlinked',
      set: 'hbt',
      collector_number: '17',
      finishes: ['nonfoil'],
    }),
  ],
  Paused: [
    makeScryfallCard({
      id: 'sf-p',
      name: 'Paused',
      set: 'tst',
      collector_number: '5',
      finishes: ['nonfoil'],
    }),
  ],
}

const PRODUCTS: CardKingdomProduct[] = [
  makeCardKingdomProduct({
    id: 10,
    sku: 'FDN-0294',
    scryfallId: 'sf-a294',
    name: 'Arahbo',
    edition: 'Foundations Variants',
    variation: '0294 - Borderless',
    priceBuy: 1.5,
    qtyBuying: 25,
  }),
  makeCardKingdomProduct({
    id: 11,
    sku: 'FFDN-0294',
    scryfallId: 'sf-a294',
    name: 'Arahbo',
    edition: 'Foundations Variants',
    finish: 'foil',
    priceBuy: 3.5,
    qtyBuying: 4,
  }),
  makeCardKingdomProduct({
    id: 12,
    sku: 'FDN-0002',
    scryfallId: 'sf-a2',
    name: 'Arahbo',
    edition: 'Foundations',
    priceBuy: 0.6,
    qtyBuying: 2,
  }),
  // Linked only via sku: CK has no scryfall_id for it.
  makeCardKingdomProduct({
    id: 13,
    sku: 'HBT-0017',
    scryfallId: '',
    name: 'Skuuronn, Unlinked',
    edition: 'The Hobbit',
    priceBuy: 9,
    qtyBuying: 8,
  }),
  // Paused offer: a price is published but CK is not buying.
  makeCardKingdomProduct({
    id: 14,
    sku: 'TST-0005',
    scryfallId: 'sf-p',
    name: 'Paused',
    priceBuy: 5,
    qtyBuying: 0,
  }),
]

const FEED: CardKingdomFeed = {
  createdAt: '2026-08-04 06:06:09',
  baseUrl: 'https://www.cardkingdom.com/',
  products: PRODUCTS,
}

function options(): BuildSellReportOptions {
  return {
    lookup: async (name) => PRINTINGS[name] ?? [],
    index: buildCardKingdomIndex(PRODUCTS),
    feed: FEED,
    feedRetrievedAt: 123,
  }
}

function input(entries: Partial<SellListEntry>[]): SellListInput[] {
  return [
    {
      type: 'collection',
      name: 'Binder',
      entries: entries.map(
        (entry): SellListEntry => ({
          name: 'Arahbo',
          quantity: 1,
          section: 'Main',
          ...entry,
        }),
      ),
    },
  ]
}

describe('buildSellReport matching', () => {
  test('a pinned entry matches its printing and finish through the scryfall id', async () => {
    const report = await buildSellReport(
      input([{ set: 'fdn', collectorNumber: '294', quantity: 4 }]),
      options(),
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.status).toBe('buying')
    expect(entry.matchVia).toBe('scryfall-id')
    expect(entry.ckSku).toBe('FDN-0294')
    expect(entry.ckFinish).toBe('nonfoil')
    expect(entry.priceBuy).toBe(1.5)
    expect(entry.sellableQuantity).toBe(4)
    expect(entry.value).toBe(6)
    expect(entry.ambiguous).toBeUndefined()
    expect(entry.ckUrl).toBe('https://www.cardkingdom.com/mtg/test-set/test-card')
  })

  test('a foil pin matches the foil product sharing the scryfall id', async () => {
    const report = await buildSellReport(
      input([{ set: 'fdn', collectorNumber: '294', finish: 'foil' }]),
      options(),
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.ckSku).toBe('FFDN-0294')
    expect(entry.ckFinish).toBe('foil')
    expect(entry.priceBuy).toBe(3.5)
  })

  test("CK's buy cap limits the sellable quantity", async () => {
    const report = await buildSellReport(
      input([{ set: 'fdn', collectorNumber: '2', quantity: 5 }]),
      options(),
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.sellableQuantity).toBe(2)
    expect(entry.value).toBe(1.2)
  })

  test('entries sharing a product draw down one budget, across lists too', async () => {
    // qtyBuying is 2 for FDN-0002; a NM copy and an LP copy (distinct entries)
    // plus a second list's copy must not each get the full cap.
    const inputs: SellListInput[] = [
      {
        type: 'collection',
        name: 'Binder',
        entries: [
          { name: 'Arahbo', quantity: 1, set: 'fdn', collectorNumber: '2', section: 'Main' },
          {
            name: 'Arahbo',
            quantity: 1,
            set: 'fdn',
            collectorNumber: '2',
            condition: 'LP',
            section: 'Main',
          },
        ],
      },
      {
        type: 'collection',
        name: 'Shoebox',
        entries: [
          { name: 'Arahbo', quantity: 3, set: 'fdn', collectorNumber: '2', section: 'Main' },
        ],
      },
    ]
    const report = await buildSellReport(inputs, options())
    expect(report.entries.map((entry) => entry.sellableQuantity)).toEqual([1, 1, 0])
    expect(report.totals.sellableCount).toBe(2)
    expect(report.totals.totalValue).toBe(1.2)
  })

  test('a paused offer (qtyBuying 0) is not-buying and worth nothing', async () => {
    const report = await buildSellReport(
      input([{ name: 'Paused', set: 'tst', collectorNumber: '5' }]),
      options(),
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.status).toBe('not-buying')
    expect(entry.priceBuy).toBe(5)
    expect(entry.sellableQuantity).toBe(0)
    expect(entry.value).toBe(0)
  })

  test('a product without a scryfall link still matches through its sku', async () => {
    const report = await buildSellReport(
      input([{ name: 'Skuuronn, Unlinked', set: 'hbt', collectorNumber: '17' }]),
      options(),
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.status).toBe('buying')
    expect(entry.matchVia).toBe('sku')
    expect(entry.priceBuy).toBe(9)
  })

  test('no-match reasons distinguish unknown names, missing printings, and absent products', async () => {
    const report = await buildSellReport(
      input([
        { name: 'Unknown Card', set: 'zzz', collectorNumber: '1' },
        { set: 'fdn', collectorNumber: '999' },
        { set: 'tst', collectorNumber: '9' },
      ]),
      options(),
    )
    expect(
      report.entries.map((entry) =>
        entry.status === 'no-match' ? entry.noMatchReason : entry.status,
      ),
    ).toEqual(['no-printings', 'printing-not-found', 'not-on-buylist'])
  })

  test('an unpinned entry quotes the best-paying product and reports its printing', async () => {
    const report = await buildSellReport(input([{}]), options())
    const entry = expectMatched(report.entries[0])
    expect(entry.pinned).toBe(false)
    expect(entry.status).toBe('buying')
    expect(entry.priceBuy).toBe(3.5)
    expect(entry.ckFinish).toBe('foil')
    expect(entry.ambiguous).toBe(true)
    // The quoted printing backfills set/collector so filters and display work.
    expect(entry.set).toBe('fdn')
    expect(entry.collectorNumber).toBe('294')
  })

  test('an unpinned name unknown to the cache falls back to CK’s own name index', async () => {
    const report = await buildSellReport(
      [
        {
          type: 'wanted',
          name: 'Wish',
          entries: [{ name: 'Paused', quantity: 1, section: 'Main' }],
        },
      ],
      { ...options(), lookup: async () => [] },
    )
    const entry = expectMatched(report.entries[0])
    expect(entry.matchVia).toBe('name')
    expect(entry.status).toBe('not-buying')
  })

  test('totals are quantity-weighted per status', async () => {
    const report = await buildSellReport(
      input([
        { set: 'fdn', collectorNumber: '294', quantity: 2 },
        { name: 'Paused', set: 'tst', collectorNumber: '5', quantity: 3 },
        { name: 'Unknown Card', quantity: 1 },
      ]),
      options(),
    )
    expect(report.totals).toEqual({
      listCount: 1,
      cardCount: 6,
      sellableCount: 2,
      totalValue: 3,
      notBuyingCount: 3,
      noMatchCount: 1,
    })
    expect(report.feedCreatedAt).toBe('2026-08-04 06:06:09')
    expect(report.feedRetrievedAt).toBe(123)
  })
})

describe('productIsBuying', () => {
  test('needs both a quantity and a nonzero price', () => {
    expect(productIsBuying(makeCardKingdomProduct({ priceBuy: 1, qtyBuying: 5 }))).toBe(true)
    expect(productIsBuying(makeCardKingdomProduct({ priceBuy: 1, qtyBuying: 0 }))).toBe(false)
    // CK publishes token $0.00 prices on paused offers.
    expect(productIsBuying(makeCardKingdomProduct({ priceBuy: 0, qtyBuying: 5 }))).toBe(false)
  })
})

describe('chooseProduct', () => {
  test('an active offer beats a higher-priced paused one, in either order', () => {
    const paused = makeCardKingdomProduct({ priceBuy: 5, qtyBuying: 0 })
    const active = makeCardKingdomProduct({ priceBuy: 0.1, qtyBuying: 3 })
    expect(chooseProduct([paused, active])).toBe(active)
    expect(chooseProduct([active, paused])).toBe(active)
  })

  test('among active offers the best price wins; inactive-only picks the highest', () => {
    const low = makeCardKingdomProduct({ priceBuy: 1 })
    const high = makeCardKingdomProduct({ priceBuy: 2 })
    expect(chooseProduct([low, high])).toBe(high)
    const pausedLow = makeCardKingdomProduct({ priceBuy: 1, qtyBuying: 0 })
    const pausedHigh = makeCardKingdomProduct({ priceBuy: 2, qtyBuying: 0 })
    expect(chooseProduct([pausedLow, pausedHigh])).toBe(pausedHigh)
    expect(chooseProduct([])).toBeUndefined()
  })
})

describe('aggregateSellEntries', () => {
  test('collapses identical variants and keeps distinct ones apart', () => {
    const line: SellListEntry = {
      name: 'Arahbo',
      quantity: 1,
      set: 'fdn',
      collectorNumber: '2',
      section: 'Main',
    }
    const aggregated = aggregateSellEntries([
      line,
      { ...line },
      { ...line, finish: 'foil' },
      { ...line, condition: 'LP' },
      { ...line, section: 'Binder Two' },
    ])
    expect(aggregated.map((entry) => entry.quantity)).toEqual([2, 1, 1, 1])
  })
})

describe('parseMinPrice', () => {
  test('accepts non-negative numbers and rejects the rest', () => {
    expect(parseMinPrice('0')).toBe(0)
    expect(parseMinPrice('1.5')).toBe(1.5)
    expect(parseMinPrice('-1')).toContain('Invalid minimum price')
    expect(parseMinPrice('abc')).toContain('Invalid minimum price')
  })
})

describe('applySellFilters', () => {
  async function report() {
    return buildSellReport(
      input([
        { set: 'fdn', collectorNumber: '294', quantity: 1 },
        { set: 'fdn', collectorNumber: '2', quantity: 1 },
        { name: 'Skuuronn, Unlinked', set: 'hbt', collectorNumber: '17', quantity: 1 },
        { name: 'Unknown Card', quantity: 1 },
      ]),
      options(),
    )
  }

  test('sets filter matches the entry’s set and recomputes the list summaries', async () => {
    const view = applySellFilters(await report(), { sets: ['hbt'] })
    expect(view.entries).toHaveLength(1)
    expect(view.lists[0]).toMatchObject({
      type: 'collection',
      name: 'Binder',
      cardCount: 1,
      sellableCount: 1,
      totalValue: 9,
    })
  })

  test('minPrice keeps only matched offers at or above the floor', async () => {
    const view = applySellFilters(await report(), { minPrice: 1 })
    expect(view.entries.map((entry) => expectMatched(entry).priceBuy)).toEqual([1.5, 9])
  })

  test('any minPrice — even 0 — drops unmatched entries, which have no quote', async () => {
    const view = applySellFilters(await report(), { minPrice: 0 })
    expect(view.entries.every((entry) => entry.status !== 'no-match')).toBe(true)
    expect(view.totals.noMatchCount).toBe(0)
  })

  test('a blank filter returns the report’s own view', async () => {
    const built = await report()
    const view = applySellFilters(built, {})
    expect(view.entries).toBe(built.entries)
    expect(sumSellEntries(view.entries).cardCount).toBe(4)
  })
})

describe('buildSellCartCsv', () => {
  async function entries() {
    const report = await buildSellReport(
      input([
        { set: 'fdn', collectorNumber: '294', quantity: 2 },
        { set: 'fdn', collectorNumber: '294', quantity: 1 },
        { set: 'fdn', collectorNumber: '294', finish: 'foil', quantity: 1 },
        { name: 'Paused', set: 'tst', collectorNumber: '5' },
        { name: 'Unknown Card' },
      ]),
      options(),
    )
    return report.entries
  }

  test('renders only bought entries, aggregated per product, in CK’s format', async () => {
    const cart = buildSellCartCsv(await entries())
    expect(cart.csv).toBe(
      'card name,edition,foil,quantity\n' +
        'Arahbo,Foundations Variants,false,3\n' +
        'Arahbo,Foundations Variants,true,1\n',
    )
    expect(cart.titleCount).toBe(2)
    expect(cart.cardCount).toBe(4)
    expect(cart.warnings).toEqual([])
  })

  test('an unpinned entry quoted at a foil product exports as foil', async () => {
    // The entry's own line has no finish; the quote is the $3.50 foil.
    const report = await buildSellReport(input([{}]), options())
    const cart = buildSellCartCsv(report.entries)
    expect(cart.csv).toContain('Arahbo,Foundations Variants,true,1')
  })

  test('quotes commas, marks etched as foil with a warning', async () => {
    const [entry] = (await entries()).filter(isBuyingEntry)
    const etched: SellReportEntry = {
      ...entry!,
      name: 'Prossh, Skyraider of Kher',
      ckName: 'Prossh, Skyraider of Kher',
      ckEdition: 'Commander Legends Variants',
      ckFinish: 'etched',
      sellableQuantity: 1,
    }
    const cart = buildSellCartCsv([etched])
    expect(cart.csv).toContain('"Prossh, Skyraider of Kher",Commander Legends Variants,true,1')
    expect(cart.warnings).toHaveLength(1)
    expect(cart.warnings[0]).toContain('etched')
  })
})
