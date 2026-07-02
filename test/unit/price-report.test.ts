import { describe, expect, test } from 'bun:test'
import {
  buildPriceReport,
  comparePricedEntries,
  deckPriceEntries,
  filterPricedEntries,
  hasActiveFilters,
  isPriceSortField,
  sumPricedEntries,
  UNRANKED_EDHREC,
  type PriceListInput,
  type PricedEntry,
  type PrintingsLookup,
} from '../../src/price-report'
import type { ScryfallCard } from '../../src/types'

type PriceOverrides = Partial<ScryfallCard['prices']>

function makeCard(
  overrides: Partial<ScryfallCard> = {},
  prices: PriceOverrides = {},
): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 2,
    type_line: 'Artifact',
    prices: {
      usd: '1.00',
      usd_foil: null,
      usd_etched: null,
      eur: null,
      eur_foil: null,
      tix: null,
      ...prices,
    },
    finishes: ['nonfoil'],
    games: ['paper'],
    set: 'aaa',
    set_name: 'Set AAA',
    collector_number: '1',
    rarity: 'rare',
    color_identity: [],
    released_at: '2020-01-01',
    ...overrides,
  }
}

function lookupFor(printings: Record<string, ScryfallCard[]>): PrintingsLookup {
  return async (name) => printings[name] ?? []
}

function input(overrides: Partial<PriceListInput> = {}): PriceListInput {
  return { type: 'deck', name: 'My Deck', entries: [], ...overrides }
}

async function priceSingle(
  listInput: PriceListInput,
  printings: Record<string, ScryfallCard[]>,
): Promise<PricedEntry> {
  const { report } = await buildPriceReport([listInput], {
    currency: 'usd',
    lookup: lookupFor(printings),
  })
  expect(report.entries).toHaveLength(1)
  return report.entries[0]!
}

describe('buildPriceReport pricing rules', () => {
  test('pinned collection entry is priced at its exact printing and finish', async () => {
    const entry = await priceSingle(
      input({
        type: 'collection',
        name: 'Binder',
        entries: [
          {
            name: 'Test Card',
            quantity: 1,
            set: 'bbb',
            collectorNumber: '7',
            finish: 'foil',
            section: 'Main',
          },
        ],
      }),
      {
        'Test Card': [
          makeCard({ set: 'aaa', collector_number: '1' }, { usd: '0.10' }),
          makeCard(
            { set: 'bbb', collector_number: '7', finishes: ['nonfoil', 'foil'] },
            { usd: '3.00', usd_foil: '9.00' },
          ),
        ],
      },
    )
    expect(entry.price).toBe(9)
    expect(entry.finish).toBe('foil')
    expect(entry.pinned).toBe(true)
    // A collection entry is a specific owned copy — its lowest price is itself.
    expect(entry.lowest).toBe(9)
  })

  test('unpinned deck entry uses a representative printing and the cheapest printing as lowest', async () => {
    const entry = await priceSingle(
      input({
        entries: [{ name: 'Test Card', quantity: 1, section: 'Main' }],
      }),
      {
        'Test Card': [
          makeCard(
            { set: 'old', collector_number: '9', released_at: '2015-01-01' },
            { usd: '1.00' },
          ),
          makeCard(
            { set: 'new', collector_number: '2', released_at: '2024-01-01' },
            { usd: '2.00' },
          ),
        ],
      },
    )
    expect(entry.pinned).toBe(false)
    expect(entry.price).toBe(2)
    expect(entry.set).toBe('new')
    expect(entry.lowest).toBe(1)
    expect(entry.lowestSet).toBe('old')
  })

  test('pinned deck entry still reports the cheapest printing as lowest', async () => {
    const entry = await priceSingle(
      input({
        entries: [
          { name: 'Test Card', quantity: 1, set: 'new', collectorNumber: '2', section: 'Main' },
        ],
      }),
      {
        'Test Card': [
          makeCard({ set: 'old', collector_number: '9' }, { usd: '0.50' }),
          makeCard({ set: 'new', collector_number: '2' }, { usd: '4.00' }),
        ],
      },
    )
    expect(entry.price).toBe(4)
    expect(entry.lowest).toBe(0.5)
  })

  test('wanted entry pinned to a printing without finish takes that printing’s cheapest finish', async () => {
    const entry = await priceSingle(
      input({
        type: 'wanted',
        name: 'Wanted',
        entries: [
          { name: 'Test Card', quantity: 1, set: 'bbb', collectorNumber: '7', section: 'Main' },
        ],
      }),
      {
        'Test Card': [
          // A cheaper other printing must NOT win — the pin restricts to bbb:7.
          makeCard({ set: 'aaa', collector_number: '1' }, { usd: '0.25' }),
          makeCard(
            { set: 'bbb', collector_number: '7', finishes: ['nonfoil', 'foil'] },
            { usd: '3.00', usd_foil: '1.50' },
          ),
        ],
      },
    )
    expect(entry.price).toBe(3)
    expect(entry.lowest).toBe(1.5)
  })

  test('fully-specified wanted entry has lowest equal to its own price', async () => {
    const entry = await priceSingle(
      input({
        type: 'wanted',
        name: 'Wanted',
        entries: [
          {
            name: 'Test Card',
            quantity: 1,
            set: 'bbb',
            collectorNumber: '7',
            finish: 'nonfoil',
            section: 'Main',
          },
        ],
      }),
      {
        'Test Card': [
          makeCard({ set: 'aaa', collector_number: '1' }, { usd: '0.25' }),
          makeCard({ set: 'bbb', collector_number: '7' }, { usd: '3.00' }),
        ],
      },
    )
    expect(entry.price).toBe(3)
    expect(entry.lowest).toBe(3)
  })

  test('name-only wanted entry prices at the representative and takes the global cheapest as lowest', async () => {
    const entry = await priceSingle(
      input({
        type: 'wanted',
        name: 'Wanted',
        entries: [{ name: 'Test Card', quantity: 1, section: 'Main' }],
      }),
      {
        'Test Card': [
          makeCard(
            { set: 'old', collector_number: '9', released_at: '2015-01-01' },
            { usd: '0.75' },
          ),
          makeCard(
            { set: 'new', collector_number: '2', released_at: '2024-01-01' },
            { usd: '1.25' },
          ),
        ],
      },
    )
    expect(entry.price).toBe(1.25)
    expect(entry.lowest).toBe(0.75)
  })

  test('card with no printings is unpriced with no-printings reason', async () => {
    const entry = await priceSingle(
      input({ entries: [{ name: 'Unknown Card', quantity: 2, section: 'Main' }] }),
      {},
    )
    expect(entry.price).toBe(0)
    expect(entry.unpricedReason).toBe('no-printings')
    expect(entry.edhrecRank).toBe(UNRANKED_EDHREC)
  })

  test('pinned printing missing from the card database is unpriced with printing-not-found', async () => {
    const entry = await priceSingle(
      input({
        entries: [
          { name: 'Test Card', quantity: 1, set: 'zzz', collectorNumber: '99', section: 'Main' },
        ],
      }),
      { 'Test Card': [makeCard()] },
    )
    expect(entry.price).toBe(0)
    expect(entry.unpricedReason).toBe('printing-not-found')
  })

  test('MTGO-only card is unpriced in USD with currency-unavailable', async () => {
    const entry = await priceSingle(
      input({ entries: [{ name: 'Test Card', quantity: 1, section: 'Main' }] }),
      { 'Test Card': [makeCard({ games: ['mtgo'] }, { tix: '0.05' })] },
    )
    expect(entry.price).toBe(0)
    expect(entry.unpricedReason).toBe('currency-unavailable')
  })

  test('lowest falls back to the entry price when no printing has a cheapest price', async () => {
    // The plain usd field is priced, but the only listed finish (foil) has no
    // price, so findCheapestPrinting comes up empty while the representative
    // price is positive.
    const entry = await priceSingle(
      input({ entries: [{ name: 'Test Card', quantity: 1, section: 'Main' }] }),
      {
        'Test Card': [makeCard({ finishes: ['foil'] }, { usd: '2.00', usd_foil: null })],
      },
    )
    expect(entry.price).toBe(2)
    expect(entry.lowest).toBe(2)
    expect(entry.lowestSet).toBeUndefined()
  })

  test('printing without price data is unpriced with no-price-data', async () => {
    const entry = await priceSingle(
      input({ entries: [{ name: 'Test Card', quantity: 1, section: 'Main' }] }),
      { 'Test Card': [makeCard({}, { usd: null })] },
    )
    expect(entry.price).toBe(0)
    expect(entry.unpricedReason).toBe('no-price-data')
  })

  test('each unique card name is looked up exactly once across lists', async () => {
    const calls: string[] = []
    const lookup: PrintingsLookup = async (name) => {
      calls.push(name)
      return [makeCard({ name })]
    }
    await buildPriceReport(
      [
        input({ entries: [{ name: 'Shared Card', quantity: 1, section: 'Main' }] }),
        input({
          type: 'collection',
          name: 'Binder',
          entries: [
            { name: 'Shared Card', quantity: 1, set: 'aaa', collectorNumber: '1', section: 'Main' },
          ],
        }),
      ],
      { currency: 'usd', lookup },
    )
    expect(calls).toEqual(['Shared Card'])
  })
})

describe('buildPriceReport aggregation', () => {
  test('summaries and totals are quantity-weighted and grouped by type', async () => {
    const printings = {
      Priced: [makeCard({ name: 'Priced' }, { usd: '2.00' })],
      Unpriced: [makeCard({ name: 'Unpriced' }, { usd: null })],
    }
    const { report } = await buildPriceReport(
      [
        input({
          entries: [
            { name: 'Priced', quantity: 3, section: 'Main' },
            { name: 'Unpriced', quantity: 2, section: 'Main' },
          ],
        }),
        input({
          type: 'wanted',
          name: 'Wanted',
          entries: [{ name: 'Priced', quantity: 1, section: 'Main' }],
        }),
      ],
      { currency: 'usd', lookup: lookupFor(printings) },
    )

    const deckSummary = report.lists.find((list) => list.name === 'My Deck')!
    expect(deckSummary.cardCount).toBe(5)
    expect(deckSummary.total).toBe(6)
    expect(deckSummary.unpricedCount).toBe(2)

    expect(report.typeTotals.map((t) => t.type)).toEqual(['deck', 'wanted'])
    expect(report.totals.listCount).toBe(2)
    expect(report.totals.total).toBe(8)
    expect(report.totals.unpricedCount).toBe(2)
  })
})

describe('deckPriceEntries', () => {
  test('excludes maybeboard and token sections but keeps the sideboard', () => {
    const entries = deckPriceEntries({
      sections: [
        { name: 'Commander', cards: [{ quantity: 1, name: 'A' }] },
        { name: 'Main', cards: [{ quantity: 1, name: 'B' }] },
        { name: 'Sideboard', cards: [{ quantity: 1, name: 'C' }] },
        { name: 'Maybeboard', cards: [{ quantity: 1, name: 'D' }] },
        { name: 'Tokens', cards: [{ quantity: 1, name: 'E' }] },
      ],
    })
    expect(entries.map((entry) => entry.name)).toEqual(['A', 'B', 'C'])
  })

  test('lowercases pinned set codes', () => {
    const entries = deckPriceEntries({
      sections: [{ name: 'Main', cards: [{ quantity: 1, name: 'A', set: 'NEO' }] }],
    })
    expect(entries[0]!.set).toBe('neo')
  })
})

function entry(overrides: Partial<PricedEntry>): PricedEntry {
  return {
    listType: 'deck',
    listName: 'My Deck',
    section: 'Main',
    name: 'Test Card',
    quantity: 1,
    pinned: false,
    price: 0,
    lowest: 0,
    cmc: 0,
    edhrecRank: UNRANKED_EDHREC,
    typeLine: '',
    fileOrder: 0,
    ...overrides,
  }
}

describe('filterPricedEntries', () => {
  const entries = [
    entry({ name: 'Sol Ring', set: 'c19', collectorNumber: '221' }),
    entry({ name: 'Solemn Simulacrum', set: 'neo', collectorNumber: '10' }),
    entry({ name: 'Séance', set: 'dka', collectorNumber: '5', listType: 'collection' }),
  ]

  test('name filter requires every term, ignoring case and diacritics', () => {
    expect(filterPricedEntries(entries, { name: 'sol ring' }).map((e) => e.name)).toEqual([
      'Sol Ring',
    ])
    expect(filterPricedEntries(entries, { name: 'seance' }).map((e) => e.name)).toEqual(['Séance'])
  })

  test('set filter matches exactly, case-insensitively', () => {
    expect(filterPricedEntries(entries, { set: 'NEO' }).map((e) => e.name)).toEqual([
      'Solemn Simulacrum',
    ])
  })

  test('collector filter matches exactly', () => {
    expect(filterPricedEntries(entries, { collector: '221' }).map((e) => e.name)).toEqual([
      'Sol Ring',
    ])
  })

  test('type filter matches the source list type', () => {
    expect(filterPricedEntries(entries, { type: 'collection' }).map((e) => e.name)).toEqual([
      'Séance',
    ])
  })

  test('hasActiveFilters is false only for a blank filter', () => {
    expect(hasActiveFilters({})).toBe(false)
    expect(hasActiveFilters({ set: 'neo' })).toBe(true)
  })
})

describe('comparePricedEntries', () => {
  const cheap = entry({
    name: 'B Card',
    price: 1,
    lowest: 0.5,
    cmc: 3,
    edhrecRank: 10,
    set: 'bbb',
    quantity: 4,
  })
  const dear = entry({
    name: 'A Card',
    price: 5,
    lowest: 4,
    cmc: 1,
    edhrecRank: 2,
    set: 'aaa',
    quantity: 1,
  })

  test('sorts by each field', () => {
    expect(comparePricedEntries(cheap, dear, 'name')).toBeGreaterThan(0)
    expect(comparePricedEntries(cheap, dear, 'price')).toBeLessThan(0)
    expect(comparePricedEntries(cheap, dear, 'lowest')).toBeLessThan(0)
    expect(comparePricedEntries(cheap, dear, 'cmc')).toBeGreaterThan(0)
    expect(comparePricedEntries(cheap, dear, 'edhrec')).toBeGreaterThan(0)
    expect(comparePricedEntries(cheap, dear, 'set')).toBeGreaterThan(0)
    expect(comparePricedEntries(cheap, dear, 'quantity')).toBeGreaterThan(0)
  })

  test('breaks ties by name', () => {
    const first = entry({ name: 'A Card', price: 5, set: 'zzz' })
    const second = entry({ name: 'B Card', price: 5, set: 'zzz' })
    expect(comparePricedEntries(second, first, 'price')).toBeGreaterThan(0)
    expect(comparePricedEntries(second, first, 'set')).toBeGreaterThan(0)
  })

  test('sorts entries without a set before those with one', () => {
    const unset = entry({ name: 'A Card', set: undefined })
    const withSet = entry({ name: 'B Card', set: 'aaa' })
    expect(comparePricedEntries(unset, withSet, 'set')).toBeLessThan(0)
  })

  test('descending negates the comparison', () => {
    expect(comparePricedEntries(cheap, dear, 'price', true)).toBeGreaterThan(0)
  })

  test('isPriceSortField accepts only known fields', () => {
    expect(isPriceSortField('price')).toBe(true)
    expect(isPriceSortField('bogus')).toBe(false)
  })
})

describe('sumPricedEntries', () => {
  test('multiplies by quantity and counts unpriced by quantity', () => {
    const totals = sumPricedEntries([
      entry({ price: 2, lowest: 1, quantity: 3 }),
      entry({ price: 0, lowest: 0, quantity: 4 }),
    ])
    expect(totals).toEqual({ cardCount: 7, total: 6, lowestTotal: 3, unpricedCount: 4 })
  })
})
