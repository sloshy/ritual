import { describe, expect, test } from 'bun:test'
import {
  buildCardBrowserChoices,
  buildMainMenuChoices,
  createDefaultBrowserState,
  formatEntryChoiceTitle,
  formatEntryDetailLines,
  formatListChoiceTitle,
  formatPrintingPriceLines,
  formatReportHeaderLines,
  formatTotalsSegment,
  suggestBrowserChoices,
  visibleBrowserEntries,
  type CardBrowserSelection,
  type PriceMainSelection,
} from '../../src/commands/price-browser'
import {
  UNRANKED_EDHREC,
  type ListPriceSummary,
  type PricedEntry,
  type PriceReport,
} from '../../src/price-report'
import type { ScryfallCard } from '../../src/types'
import { makeScryfallCard } from '../test-utils'

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
    ...overrides,
  }
}

function report(overrides: Partial<PriceReport> = {}): PriceReport {
  return {
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
      },
      { type: 'wanted', listCount: 1, cardCount: 2, total: 5, lowestTotal: 5, unpricedCount: 1 },
    ],
    totals: { listCount: 2, cardCount: 102, total: 255, lowestTotal: 205, unpricedCount: 1 },
    ...overrides,
  }
}

describe('formatTotalsSegment', () => {
  test('shows lowest only when it differs and unpriced only when positive', () => {
    expect(
      formatTotalsSegment({ cardCount: 1, total: 10, lowestTotal: 8, unpricedCount: 2 }, 'usd'),
    ).toBe('Total $10.00 · Lowest $8.00 · 2 unpriced')
    expect(
      formatTotalsSegment({ cardCount: 1, total: 10, lowestTotal: 10, unpricedCount: 0 }, 'usd'),
    ).toBe('Total $10.00')
  })
})

describe('formatReportHeaderLines', () => {
  test('shows cache age, per-type totals, and a grand total across types', () => {
    const now = Date.parse('2026-07-02T12:00:00Z')
    const lines = formatReportHeaderLines(report(), now - 3 * 60 * 60 * 1000, now)
    expect(lines[0]).toContain('Prices last updated:')
    expect(lines[0]).toContain('(3 hours ago)')
    expect(lines[0]).toContain('Currency: USD')
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
      { kind: 'currency' },
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

describe('suggestBrowserChoices', () => {
  const choices = [
    { title: 'Sol Ring (C19:221) — $2.00' },
    { title: 'Solemn Simulacrum (NEO:10) — $1.00' },
    { title: '← Back' },
  ]

  test('empty input shows everything', () => {
    expect(suggestBrowserChoices('', choices)).toHaveLength(3)
  })

  test('every term must match, against name or set or collector number', () => {
    expect(suggestBrowserChoices('sol ring', choices).map((c) => c.title)).toEqual([
      'Sol Ring (C19:221) — $2.00',
    ])
    expect(suggestBrowserChoices('neo', choices).map((c) => c.title)).toEqual([
      'Solemn Simulacrum (NEO:10) — $1.00',
    ])
    expect(suggestBrowserChoices('221', choices).map((c) => c.title)).toEqual([
      'Sol Ring (C19:221) — $2.00',
    ])
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
})
