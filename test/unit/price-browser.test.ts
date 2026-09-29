import { describe, expect, test } from 'bun:test'
import prompts from 'prompts'
import {
  buildCardBrowserChoices,
  buildMainMenuChoices,
  createDefaultBrowserState,
  formatEntryChoiceTitle,
  formatEntryDetailLines,
  formatListChoiceTitle,
  formatPrintingPriceLines,
  formatReportHeaderLines,
  runPriceBrowser,
  storeChoices,
  formatTotalsSegment,
  visibleBrowserEntries,
  type CardBrowserSelection,
  type PriceMainSelection,
} from '../../src/commands/price-browser'
import {
  UNRANKED_EDHREC,
  type ListPriceSummary,
  type PriceTotals,
  type PricedEntry,
  type PriceReport,
} from '../../src/pricing/price-report'
import type { ScryfallCard } from '../../src/scryfall/types'
import { makeScryfallCard, stubTty } from '../test-utils'
import { captureConsole } from '../helpers/capture'

function entry(overrides: Partial<PricedEntry> = {}): PricedEntry {
  return {
    listType: 'deck',
    listName: 'My Deck',
    section: 'Main',
    name: 'Sol Ring',
    quantity: 1,
    pinned: true,
    price: 2,
    lowest: 2,
    cmc: 1,
    edhrecRank: 4,
    typeLine: 'Artifact',
    fileOrder: 0,
    set: 'c19',
    collectorNumber: '221',
    ...overrides,
  }
}

function summary(overrides: Partial<ListPriceSummary> = {}): ListPriceSummary {
  return {
    type: 'deck',
    name: 'My Deck',
    cardCount: 100,
    total: 250,
    lowestTotal: 200,
    unpricedCount: 0,
    estimatedCount: 0,
    ...overrides,
  }
}

function report(overrides: Partial<PriceReport> = {}): PriceReport {
  return {
    source: 'tcgplayer',
    currency: 'usd',
    lists: [summary(), summary({ type: 'wanted', name: 'Wanted', total: 5, lowestTotal: 5 })],
    entries: [],
    typeTotals: [
      {
        type: 'deck',
        listCount: 1,
        cardCount: 100,
        total: 250,
        lowestTotal: 200,
        unpricedCount: 0,
        estimatedCount: 0,
      },
      {
        type: 'wanted',
        listCount: 1,
        cardCount: 2,
        total: 5,
        lowestTotal: 5,
        unpricedCount: 1,
        estimatedCount: 0,
      },
    ],
    totals: {
      listCount: 2,
      cardCount: 102,
      total: 255,
      lowestTotal: 205,
      unpricedCount: 1,
      estimatedCount: 0,
    },
    ...overrides,
  }
}

describe('formatTotalsSegment', () => {
  const totals = (overrides: Partial<PriceTotals>): PriceTotals => ({
    cardCount: 1,
    total: 10,
    lowestTotal: 10,
    unpricedCount: 0,
    estimatedCount: 0,
    ...overrides,
  })

  test('shows lowest only when it differs and unpriced only when positive', () => {
    expect(formatTotalsSegment(totals({ lowestTotal: 8, unpricedCount: 2 }), 'usd')).toBe(
      'Total $10.00 · Lowest $8.00 · 2 unpriced',
    )
    expect(formatTotalsSegment(totals({}), 'usd')).toBe('Total $10.00')
  })

  test('marks an estimated total', () => {
    expect(formatTotalsSegment(totals({ estimatedCount: 1 }), 'usd')).toBe('Total Est. $10.00')
  })
})

describe('storeChoices', () => {
  test('lists every store with its currency, marking the current one', () => {
    const choices = storeChoices('cardkingdom')
    expect(choices.map((c) => c.value)).toEqual([
      'tcgplayer',
      'cardmarket',
      'cardkingdom',
      'cardhoarder',
    ])
    expect(choices[2]).toMatchObject({ title: 'Card Kingdom (current)', description: 'USD' })
    expect(choices[1]).toMatchObject({ title: 'Cardmarket', description: 'EUR' })
  })
})

describe('formatReportHeaderLines', () => {
  test('shows cache age, per-type totals, and a grand total across types', () => {
    const now = Date.parse('2026-07-02T12:00:00Z')
    const lines = formatReportHeaderLines(
      report({ source: 'cardmarket', currency: 'eur' }),
      now - 3 * 60 * 60 * 1000,
      now,
    )
    expect(lines[0]).toContain('Prices last updated:')
    expect(lines[0]).toContain('(3 hours ago)')
    expect(lines[0]).toContain('Store: Cardmarket (EUR)')
    expect(lines.some((line) => line.includes('Decks (1)'))).toBe(true)
    expect(lines.some((line) => line.includes('All lists (2)'))).toBe(true)
  })

  test('reports an unknown refresh time and omits the grand total for one type', () => {
    const single = report({
      typeTotals: [
        {
          type: 'deck',
          listCount: 1,
          cardCount: 100,
          total: 250,
          lowestTotal: 200,
          unpricedCount: 0,
          estimatedCount: 0,
        },
      ],
    })
    const lines = formatReportHeaderLines(single, null, Date.now())
    expect(lines[0]).toContain('Prices last updated: unknown')
    expect(lines.some((line) => line.includes('All lists'))).toBe(false)
  })
})

describe('buildMainMenuChoices', () => {
  test('lists every list in type order followed by the actions', () => {
    const outOfOrder = report({
      lists: [
        summary({ type: 'wanted', name: 'Wanted' }),
        summary({ type: 'deck', name: 'My Deck' }),
      ],
    })
    const choices = buildMainMenuChoices(outOfOrder)
    const titles = choices.map((choice) => choice.title)
    expect(titles[0]).toContain('My Deck')
    expect(titles[1]).toContain('Wanted')
    expect(choices.slice(2).map((choice) => choice.value as PriceMainSelection)).toEqual([
      { kind: 'search' },
      { kind: 'refresh' },
      { kind: 'store' },
      { kind: 'exit' },
    ])
  })

  test('choice values identify the list to open', () => {
    const choices = buildMainMenuChoices(report())
    const first = choices[0]!.value as PriceMainSelection
    expect(first).toEqual({ kind: 'open', type: 'deck', name: 'My Deck' })
  })
})

describe('formatListChoiceTitle', () => {
  test('includes totals, unpriced badge, and card count', () => {
    const title = formatListChoiceTitle(summary({ unpricedCount: 3 }), 'usd')
    expect(title).toContain('My Deck — Total $250.00 · Lowest $200.00 · 3 unpriced · 100 cards')
  })
})

describe('formatEntryChoiceTitle', () => {
  test('marks representative printings with an asterisk', () => {
    expect(formatEntryChoiceTitle(entry({ pinned: false }), 'usd', false)).toBe(
      'Sol Ring (C19:221)* — $2.00',
    )
    expect(formatEntryChoiceTitle(entry(), 'usd', false)).toBe('Sol Ring (C19:221) — $2.00')
  })

  test('shows quantity multiplier, line total, lowest, finish, and source', () => {
    const title = formatEntryChoiceTitle(
      entry({ quantity: 2, price: 3, lowest: 1, finish: 'foil' }),
      'usd',
      true,
    )
    expect(title).toStartWith('2x Sol Ring (C19:221) [foil] — $6.00 · lowest $2.00')
    expect(title).toEndWith('My Deck')
  })

  test('renders unpriced entries as N/A', () => {
    expect(formatEntryChoiceTitle(entry({ price: 0, lowest: 0 }), 'usd', false)).toBe(
      'Sol Ring (C19:221) — N/A',
    )
  })

  test('marks a proxy instead of reporting a missing price', () => {
    expect(
      formatEntryChoiceTitle(entry({ price: 0, lowest: 0, unpricedReason: 'proxy' }), 'usd', false),
    ).toBe('Sol Ring (C19:221) — PROXY')
  })

  test('marks a custom-art card with its own marker', () => {
    expect(
      formatEntryChoiceTitle(
        entry({ price: 0, lowest: 0, unpricedReason: 'custom-art' }),
        'usd',
        false,
      ),
    ).toBe('Sol Ring (C19:221) — CUSTOM')
  })
})

describe('buildCardBrowserChoices', () => {
  test('leads with sort/filter controls and Back, then entries', () => {
    const state = createDefaultBrowserState()
    const choices = buildCardBrowserChoices([entry()], state, 'usd', {
      showSource: false,
      withTypeFilter: false,
    })
    expect(choices.slice(0, 4).map((choice) => choice.value as CardBrowserSelection)).toEqual([
      { kind: 'sort' },
      { kind: 'filter-set' },
      { kind: 'filter-collector' },
      { kind: 'back' },
    ])
    expect(choices[0]!.title).toContain('Sort: Name (ascending)')
    expect(choices[1]!.title).toContain('Set code filter: all')
    expect(choices[2]!.title).toContain('Collector number filter: all')
    expect(choices[4]!.title).toContain('Sol Ring')
  })

  test('adds the list-type filter only for the global search', () => {
    const state = createDefaultBrowserState()
    state.filters.set = 'neo'
    const titles = buildCardBrowserChoices([], state, 'usd', {
      showSource: true,
      withTypeFilter: true,
    }).map((choice) => choice.title)
    expect(titles.find((t) => t.includes('List type filter'))).toContain('List type filter: all')
    expect(titles.find((t) => t.includes('Set code filter'))).toContain('Set code filter: NEO')
  })
})

describe('visibleBrowserEntries', () => {
  test('applies filters then the sort', () => {
    const state = createDefaultBrowserState()
    state.sort = 'price'
    state.descending = true
    state.filters.set = 'c19'
    const entries = [
      entry({ name: 'Cheap', price: 1, set: 'c19' }),
      entry({ name: 'Dear', price: 9, set: 'c19' }),
      entry({ name: 'Other Set', price: 5, set: 'neo' }),
    ]
    expect(visibleBrowserEntries(entries, state).map((e) => e.name)).toEqual(['Dear', 'Cheap'])
  })
})

describe('formatEntryDetailLines', () => {
  test('shows list, price, lowest printing, and card facts', () => {
    const lines = formatEntryDetailLines(
      entry({
        quantity: 2,
        price: 3,
        lowest: 1,
        lowestSet: 'cm2',
        lowestCollectorNumber: '189',
        lowestFinish: 'nonfoil',
      }),
      'usd',
    )
    expect(lines[0]).toBe('Sol Ring (C19:221)')
    expect(lines.find((line) => line.includes('List:'))).toContain('My Deck (Main)')
    expect(lines).toContain('  Price: $3.00 · $6.00 for 2')
    expect(lines).toContain('  Lowest: $1.00 (CM2:189) [nonfoil]')
    expect(lines).toContain('  Artifact · Mana value 1 · EDHREC #4')
  })

  test('explains unpriced entries and unranked cards', () => {
    const lines = formatEntryDetailLines(
      entry({ price: 0, lowest: 0, unpricedReason: 'no-price-data', edhrecRank: UNRANKED_EDHREC }),
      'usd',
    )
    expect(lines).toContain('  Price: N/A')
    expect(lines.some((line) => line.includes('no price data'))).toBe(true)
    expect(lines.some((line) => line.includes('EDHREC'))).toBe(false)
  })

  test('a proxy detail marks the price and explains why there is none', () => {
    const lines = formatEntryDetailLines(
      entry({ price: 0, lowest: 0, unpricedReason: 'proxy' }),
      'usd',
    )
    expect(lines).toContain('  Price: PROXY')
    expect(lines.some((line) => line.includes('is a proxy'))).toBe(true)
  })

  test('a custom-art detail marks the price and explains why there is none', () => {
    const lines = formatEntryDetailLines(
      entry({ price: 0, lowest: 0, unpricedReason: 'custom-art' }),
      'usd',
    )
    expect(lines).toContain('  Price: CUSTOM')
    expect(lines.some((line) => line.includes('has custom art'))).toBe(true)
  })

  test('notes when the shown printing is only representative', () => {
    const lines = formatEntryDetailLines(entry({ pinned: false }), 'usd')
    expect(lines.some((line) => line.includes('representative'))).toBe(true)
  })
})

describe('formatPrintingPriceLines', () => {
  test('sorts newest first and lists per-finish prices', () => {
    const printings: ScryfallCard[] = [
      makeScryfallCard({
        id: '1',
        name: 'Sol Ring',
        prices: { usd: '1.00', usd_foil: '3.00' },
        finishes: ['nonfoil', 'foil'],
        set: 'old',
        set_name: 'Old Set',
        collector_number: '9',
        released_at: '2015-01-01',
      }),
      makeScryfallCard({
        id: '2',
        name: 'Sol Ring',
        set: 'new',
        set_name: 'New Set',
        collector_number: '2',
        released_at: '2024-01-01',
      }),
    ]
    const lines = formatPrintingPriceLines(printings, 'usd')
    expect(lines[0]).toBe('  NEW:2 (New Set) — N/A nonfoil')
    expect(lines[1]).toBe('  OLD:9 (Old Set) — $1.00 nonfoil · $3.00 foil')
  })

  test('skips a finish Ritual does not model rather than quoting it as nonfoil', () => {
    const printing = makeScryfallCard({
      prices: { usd: '1.00' },
      finishes: ['nonfoil', 'glossy'],
      set: 'sld',
      set_name: 'Secret Lair Drop',
      collector_number: '1',
    })
    // Before the Finish narrowing this listed '$1.00 glossy' — the nonfoil price
    // under another finish's name.
    expect(formatPrintingPriceLines([printing], 'usd')).toEqual([
      '  SLD:1 (Secret Lair Drop) — $1.00 nonfoil',
    ])
  })
})

describe('runPriceBrowser store switching', () => {
  // `ask` refuses to prompt without a terminal; the answers below are injected.
  stubTty({ stdin: true })

  /** The main screen's header lines, one block per render, from captured output. */
  const storeHeaders = (lines: readonly string[]): string[] =>
    lines.filter((line) => line.includes('Store:'))

  test('a store that cannot be priced keeps the current report; one that can replaces it', async () => {
    const asked: string[] = []
    const rebuilds: (PriceReport | string)[] = [
      'No Card Kingdom buylist is cached.',
      report({ source: 'cardkingdom', currency: 'usd' }),
    ]
    prompts.inject([
      { kind: 'store' } satisfies PriceMainSelection,
      'cardkingdom',
      { kind: 'store' } satisfies PriceMainSelection,
      'cardkingdom',
      { kind: 'refresh' } satisfies PriceMainSelection,
      { kind: 'exit' } satisfies PriceMainSelection,
    ])

    const { lines } = await captureConsole(['log', 'error'], () =>
      runPriceBrowser({
        built: { report: report(), printingsByName: new Map() },
        lastRefreshedAt: null,
        rebuild: (source) => {
          asked.push(source)
          const next = rebuilds.shift() ?? report({ source: 'cardkingdom', currency: 'usd' })
          return Promise.resolve(
            typeof next === 'string' ? next : { report: next, printingsByName: new Map() },
          )
        },
        refreshPrices: () => Promise.resolve(),
        getLastRefreshedAt: () => Promise.resolve(null),
      }),
    )

    // Two switches to Card Kingdom, then a refresh that rebuilds at the store
    // now in force rather than the one the browser opened on.
    expect(asked).toEqual(['cardkingdom', 'cardkingdom', 'cardkingdom'])
    expect(lines.error).toEqual(['No Card Kingdom buylist is cached.'])
    const headers = storeHeaders(lines.log)
    expect(headers[0]).toContain('Store: TCGplayer (USD)')
    // The failed switch left TCGplayer on screen…
    expect(headers[1]).toContain('Store: TCGplayer (USD)')
    // …and the one that succeeded swapped the report.
    expect(headers[2]).toContain('Store: Card Kingdom (USD)')
  })
})
