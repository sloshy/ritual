import { describe, expect, test } from 'bun:test'
import { formatListsSummaryLines, formatListsTable } from '../../../src/commands/lists'
import type { ListInfo } from '../../../src/list/list-identity'
import type { PriceTotals } from '../../../src/pricing/price-report'
import type { ListsSummaryPayload, ListsSummaryRow } from '../../../src/summary/lists'

const info = (listType: ListInfo['listType'], name: string, slug = name): ListInfo => ({
  listType,
  slug,
  name,
})

describe('formatListsTable', () => {
  test('heads the columns, and leaves out the file column when every file is named after its list', () => {
    expect(formatListsTable([info('deck', 'Pauper Elves'), info('wanted', 'Upgrades')])).toEqual([
      'Type         Name',
      'deck         Pauper Elves',
      'wanted list  Upgrades',
    ])
  })

  test('adds the file column when some list name differs from its file name', () => {
    expect(
      formatListsTable([
        info('deck', "Atraxa: Praetors' Voice", "Atraxa Praetors' Voice"),
        info('collection', 'Binder'),
      ]),
    ).toEqual([
      'Type        Name                     File',
      "deck        Atraxa: Praetors' Voice  Atraxa Praetors' Voice",
      'collection  Binder                   Binder',
    ])
  })
})

/** Priced totals: `total` dollars over `cards` copies, nothing unpriced or estimated. */
function value(total: number, cards: number): PriceTotals {
  return { cardCount: cards, total, lowestTotal: total, unpricedCount: 0, estimatedCount: 0 }
}

function row(overrides: Partial<ListsSummaryRow> & Pick<ListsSummaryRow, 'slug'>): ListsSummaryRow {
  return {
    listType: 'collection',
    name: overrides.slug,
    counts: { entryCount: 2, cardCount: 3, sections: [] },
    ...overrides,
  }
}

const NOW = Date.parse('2026-07-02T12:00:00Z')

describe('formatListsSummaryLines', () => {
  test('a priced summary: store line, a value column, per-type and grand totals', () => {
    const summary: ListsSummaryPayload = {
      lists: [
        row({ listType: 'deck', slug: 'burn', value: value(12, 3) }),
        // Pricing failed for this one: its cell says so instead of a total.
        row({ slug: 'binder' }),
      ],
      totals: {
        listCount: 2,
        entryCount: 4,
        cardCount: 6,
        distinctCardCount: 3,
        value: value(12, 3),
      },
      typeTotals: [
        {
          listType: 'deck',
          listCount: 1,
          entryCount: 2,
          cardCount: 3,
          distinctCardCount: 2,
          value: value(12, 3),
        },
        { listType: 'collection', listCount: 1, entryCount: 2, cardCount: 3, distinctCardCount: 2 },
      ],
      source: 'tcgplayer',
      currency: 'usd',
      lastRefreshedAt: NOW - 2 * 60 * 60 * 1000,
      warnings: [],
    }
    const lines = formatListsSummaryLines(summary, NOW)
    expect(lines[0]).toContain('Store: TCGplayer (USD)')
    expect(lines[0]).toContain('(2 hours ago)')
    expect(lines.slice(2, 5)).toEqual([
      'Type        Name    Entries  Cards  Value',
      'deck        burn          2      3  Total $12.00',
      'collection  binder        2      3  not priced',
    ])
    expect(lines.slice(-3)).toEqual([
      'Decks: 1 list · 2 entries · 3 cards · 2 distinct cards · Total $12.00',
      'Collections: 1 list · 2 entries · 3 cards · 2 distinct cards · not priced',
      'All lists: 2 lists · 4 entries · 6 cards · 3 distinct cards · Total $12.00',
    ])
  })

  test('an unpriced, empty summary: the placeholder, then zero totals and no value', () => {
    const lines = formatListsSummaryLines(
      {
        lists: [],
        totals: { listCount: 0, entryCount: 0, cardCount: 0, distinctCardCount: 0 },
        warnings: [],
      },
      NOW,
    )
    expect(lines).toEqual([
      '(no lists)',
      '',
      'All lists: 0 lists · 0 entries · 0 cards · 0 distinct cards',
    ])
  })
})
