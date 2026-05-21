import { describe, test, expect } from 'bun:test'
import type { CollectionSummary, DeckSummary } from '../../../src/site/data-types'
import {
  groupDecksByFormat,
  INDEX_SORT_OPTIONS,
  LIST_SORT_OPTIONS,
  parseIndexGroup,
  parseIndexSort,
  sortSummaries,
} from '../../../src/site/index-filter'

function makeDeck(partial: Partial<DeckSummary> & { slug: string; name: string }): DeckSummary {
  return {
    slug: partial.slug,
    name: partial.name,
    featuredCardImage: '',
    commander: null,
    format: partial.format ?? null,
    cardCount: partial.cardCount ?? 60,
    lastUpdatedAt: partial.lastUpdatedAt,
    totalPrice: partial.totalPrice,
    lowestPrice: partial.lowestPrice,
    totalPriceEur: partial.totalPriceEur,
    lowestPriceEur: partial.lowestPriceEur,
    totalPriceTix: partial.totalPriceTix,
    lowestPriceTix: partial.lowestPriceTix,
    missingPriceCount: partial.missingPriceCount,
    missingPriceCountEur: partial.missingPriceCountEur,
    missingPriceCountTix: partial.missingPriceCountTix,
  }
}

describe('sortSummaries (decks)', () => {
  const charlie = makeDeck({
    slug: 'c',
    name: 'Charlie',
    lastUpdatedAt: '2026-03-01T00:00:00.000Z',
    totalPrice: 50,
    lowestPrice: 20,
  })
  const alpha = makeDeck({
    slug: 'a',
    name: 'Alpha',
    lastUpdatedAt: '2026-05-01T00:00:00.000Z',
    totalPrice: 200,
    lowestPrice: 100,
  })
  const bravo = makeDeck({
    slug: 'b',
    name: 'Bravo',
    lastUpdatedAt: '2026-01-01T00:00:00.000Z',
    totalPrice: 10,
    lowestPrice: 5,
  })
  const stale = makeDeck({
    slug: 'd',
    name: 'Delta',
    totalPrice: 0,
    lowestPrice: 0,
  })
  const decks = [charlie, alpha, bravo, stale]

  test("'alpha' sorts by name A-Z", () => {
    expect(sortSummaries(decks, 'alpha', 'usd', false).map((d) => d.slug)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  test("'recent' sorts newest first, undated last", () => {
    expect(sortSummaries(decks, 'recent', 'usd', false).map((d) => d.slug)).toEqual([
      'a',
      'c',
      'b',
      'd',
    ])
  })

  test("'price' sorts highest first", () => {
    expect(sortSummaries(decks, 'price', 'usd', false).map((d) => d.slug)).toEqual([
      'a',
      'c',
      'b',
      'd',
    ])
  })

  test("'lowestPrice' sorts highest first", () => {
    expect(sortSummaries(decks, 'lowestPrice', 'usd', false).map((d) => d.slug)).toEqual([
      'a',
      'c',
      'b',
      'd',
    ])
  })

  test('reverse flips the result of any sort', () => {
    expect(sortSummaries(decks, 'alpha', 'usd', true).map((d) => d.slug)).toEqual([
      'd',
      'c',
      'b',
      'a',
    ])
    expect(sortSummaries(decks, 'price', 'usd', true).map((d) => d.slug)).toEqual([
      'd',
      'b',
      'c',
      'a',
    ])
  })

  test('does not mutate the input array', () => {
    const input = decks.slice()
    sortSummaries(input, 'alpha', 'usd', true)
    expect(input.map((d) => d.slug)).toEqual(['c', 'a', 'b', 'd'])
  })

  test('price sort respects the selected currency', () => {
    const eurFavored = makeDeck({
      slug: 'e1',
      name: 'EurFavored',
      totalPrice: 10,
      totalPriceEur: 500,
    })
    const usdFavored = makeDeck({
      slug: 'u1',
      name: 'UsdFavored',
      totalPrice: 500,
      totalPriceEur: 10,
    })
    expect(
      sortSummaries([eurFavored, usdFavored], 'price', 'usd', false).map((d) => d.slug),
    ).toEqual(['u1', 'e1'])
    expect(
      sortSummaries([eurFavored, usdFavored], 'price', 'eur', false).map((d) => d.slug),
    ).toEqual(['e1', 'u1'])
  })
})

function makeCollection(
  partial: Partial<CollectionSummary> & { slug: string; name: string },
): CollectionSummary {
  return {
    slug: partial.slug,
    name: partial.name,
    featuredCardImage: '',
    cardCount: partial.cardCount ?? 1,
    lastUpdatedAt: partial.lastUpdatedAt,
    totalPrice: partial.totalPrice ?? 0,
    totalPriceEur: partial.totalPriceEur ?? 0,
    totalPriceTix: partial.totalPriceTix ?? 0,
  }
}

describe('sortSummaries (collections / wanted lists)', () => {
  // Collections and wanted lists share the same summary shape for sorting, so a
  // single set of collection-backed cases covers both index tabs. These tabs do
  // not offer the 'lowestPrice' sort (deck-only), so it is not exercised here.
  const main = makeCollection({
    slug: 'main',
    name: 'Main Binder',
    lastUpdatedAt: '2026-02-01T00:00:00.000Z',
    totalPrice: 1200,
  })
  const trades = makeCollection({
    slug: 'trades',
    name: 'Trade Stock',
    lastUpdatedAt: '2026-05-10T00:00:00.000Z',
    totalPrice: 75,
  })
  const cube = makeCollection({
    slug: 'cube',
    name: 'Awesome Cube',
    lastUpdatedAt: '2026-03-15T00:00:00.000Z',
    totalPrice: 450,
  })
  const lists = [main, trades, cube]

  test("'alpha' sorts by name A-Z", () => {
    expect(sortSummaries(lists, 'alpha', 'usd', false).map((c) => c.slug)).toEqual([
      'cube',
      'main',
      'trades',
    ])
  })

  test("'recent' sorts newest first", () => {
    expect(sortSummaries(lists, 'recent', 'usd', false).map((c) => c.slug)).toEqual([
      'trades',
      'cube',
      'main',
    ])
  })

  test("'price' sorts highest current total first", () => {
    expect(sortSummaries(lists, 'price', 'usd', false).map((c) => c.slug)).toEqual([
      'main',
      'cube',
      'trades',
    ])
  })

  test('reverse flips the result', () => {
    expect(sortSummaries(lists, 'alpha', 'usd', true).map((c) => c.slug)).toEqual([
      'trades',
      'main',
      'cube',
    ])
  })

  test('items without a timestamp sort last under recent', () => {
    const undated = makeCollection({ slug: 'x', name: 'Unknown' })
    const sorted = sortSummaries([undated, main, trades], 'recent', 'usd', false)
    expect(sorted.map((c) => c.slug)).toEqual(['trades', 'main', 'x'])
  })
})

describe('groupDecksByFormat', () => {
  test('groups decks by their detected format, preserving input order within groups', () => {
    const decks: DeckSummary[] = [
      makeDeck({ slug: 'a', name: 'Alpha', format: 'commander' }),
      makeDeck({ slug: 'b', name: 'Bravo', format: 'modern' }),
      makeDeck({ slug: 'c', name: 'Charlie', format: 'commander' }),
    ]
    const groups = groupDecksByFormat(decks)
    expect(groups.map((g) => g.label)).toEqual(['Commander', 'Modern'])
    expect(groups[0]!.decks.map((d) => d.slug)).toEqual(['a', 'c'])
    expect(groups[1]!.decks.map((d) => d.slug)).toEqual(['b'])
  })

  test('decks without a detected format land in the "Other" group, sorted last', () => {
    const decks: DeckSummary[] = [
      makeDeck({ slug: 'a', name: 'Alpha', format: null }),
      makeDeck({ slug: 'b', name: 'Bravo', format: 'commander' }),
    ]
    const groups = groupDecksByFormat(decks)
    expect(groups.map((g) => g.label)).toEqual(['Commander', 'Other'])
    expect(groups[1]!.decks.map((d) => d.slug)).toEqual(['a'])
  })

  test('returns an empty list for no decks', () => {
    expect(groupDecksByFormat([])).toEqual([])
  })
})

describe('parseIndexSort / parseIndexGroup', () => {
  test('passes through valid sort values', () => {
    expect(parseIndexSort('alpha')).toBe('alpha')
    expect(parseIndexSort('recent')).toBe('recent')
    expect(parseIndexSort('lowestPrice')).toBe('lowestPrice')
  })

  test('falls back to alpha for unknown sort strings', () => {
    expect(parseIndexSort('totally-bogus')).toBe('alpha')
    expect(parseIndexSort('')).toBe('alpha')
  })

  test('rejects values outside a restricted option set', () => {
    // The collection/wanted tabs pass LIST_SORT_OPTIONS, which excludes
    // 'lowestPrice' — so a stray 'lowestPrice' falls back to the default.
    expect(parseIndexSort('lowestPrice', LIST_SORT_OPTIONS)).toBe('alpha')
    expect(parseIndexSort('price', LIST_SORT_OPTIONS)).toBe('price')
  })

  test('passes through valid group values', () => {
    expect(parseIndexGroup('format')).toBe('format')
    expect(parseIndexGroup('none')).toBe('none')
  })

  test('falls back to none for unknown group strings', () => {
    expect(parseIndexGroup('unknown')).toBe('none')
  })
})

describe('sort option sets', () => {
  test('decks offer the lowest-price sort', () => {
    expect(INDEX_SORT_OPTIONS.map((o) => o.value)).toContain('lowestPrice')
  })

  test('collections and wanted lists omit the lowest-price sort', () => {
    expect(LIST_SORT_OPTIONS.map((o) => o.value)).toEqual(['alpha', 'recent', 'price'])
  })
})
