import { describe, expect, test } from 'bun:test'
import {
  collectSetCodes,
  countActiveFilters,
  createDefaultCardFilters,
  filterCards,
  parseManaValueFilter,
  toggleColorSelection,
  type CardFilters,
} from '../../../src/site/card-filters'
import { matchesAllTerms } from '../../../src/term-match'
import type { CardData } from '../../../src/site/card-sorting'

function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test Card',
    quantity: 1,
    cmc: 3,
    edhrec: 1000,
    price: 1.5,
    type: 'Creature — Human',
    section: 'Main',
    fileOrder: 0,
    setCode: 'tst',
    colorIdentity: [],
    hasPrinting: true,
    card: null,
    ...overrides,
  }
}

function makeFilters(overrides: Partial<CardFilters> = {}): CardFilters {
  return { ...createDefaultCardFilters(), ...overrides }
}

describe('filterCards', () => {
  test('default filters pass every card through unchanged', () => {
    const cards = [makeCard(), makeCard({ name: 'Other', price: 0 })]
    expect(filterCards(cards, makeFilters())).toEqual(cards)
  })

  test('hideLands removes cmc-0 cards with Land in the type line', () => {
    const land = makeCard({ name: 'Forest', cmc: 0, type: 'Basic Land — Forest' })
    const spell = makeCard({ name: 'Bolt', cmc: 1, type: 'Instant' })
    const result = filterCards([land, spell], makeFilters({ hideLands: true }))
    expect(result.map((c) => c.name)).toEqual(['Bolt'])
  })

  test('hideLands matches the Basic branch of the type line check', () => {
    const basic = makeCard({ name: 'Snow Plains', cmc: 0, type: 'Basic Snow Plains' })
    expect(filterCards([basic], makeFilters({ hideLands: true }))).toHaveLength(0)
  })

  test('hideLands keeps nonzero-cmc cards that mention Land in the type line', () => {
    const dryad = makeCard({ name: 'Dryad Arbor Friend', cmc: 2, type: 'Creature — Land Dryad' })
    expect(filterCards([dryad], makeFilters({ hideLands: true }))).toHaveLength(1)
  })

  test('hideUnpriced removes cards without a positive price', () => {
    const priced = makeCard({ name: 'Priced', price: 3.5 })
    const unpriced = makeCard({ name: 'Unpriced', price: 0 })
    const result = filterCards([priced, unpriced], makeFilters({ hideUnpriced: true }))
    expect(result.map((c) => c.name)).toEqual(['Priced'])
  })

  test('name filter requires every space-separated term as a substring, case-insensitively', () => {
    const cards = [
      makeCard({ name: 'Black Market Connections' }),
      makeCard({ name: 'Black Lotus' }),
      makeCard({ name: 'Market Gnome' }),
    ]
    const result = filterCards(cards, makeFilters({ name: 'market black' }))
    expect(result.map((c) => c.name)).toEqual(['Black Market Connections'])
  })

  test('name filter ignores surrounding and repeated whitespace', () => {
    const cards = [makeCard({ name: 'Llanowar Elves' })]
    expect(filterCards(cards, makeFilters({ name: '  llanowar   elves  ' }))).toHaveLength(1)
  })

  test('exclusive color filter matches only the exact color identity', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const result = filterCards(
      [golgari, mono, colorless],
      makeFilters({ colors: ['B', 'G'], colorMode: 'exclusive' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Golgari'])
  })

  test('exclusive color match ignores identity ordering', () => {
    const card = makeCard({ colorIdentity: ['G', 'B'] })
    expect(
      filterCards([card], makeFilters({ colors: ['B', 'G'], colorMode: 'exclusive' })),
    ).toHaveLength(1)
  })

  test('inclusive color filter matches any card playable in the selected colors', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const boros = makeCard({ name: 'Boros', colorIdentity: ['R', 'W'] })
    const result = filterCards(
      [golgari, mono, colorless, boros],
      makeFilters({ colors: ['B', 'G'], colorMode: 'inclusive' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Golgari', 'Mono Green', 'Rock'])
  })

  test('set code filter matches case-insensitively against the card set code', () => {
    const a = makeCard({ name: 'A', setCode: 'MKM' })
    const b = makeCard({ name: 'B', setCode: 'lea' })
    const c = makeCard({ name: 'C', setCode: '2xm' })
    const result = filterCards([a, b, c], makeFilters({ setCodes: ['mkm', '2xm'] }))
    expect(result.map((card) => card.name)).toEqual(['A', 'C'])
  })

  test('set code filter excludes cards with no set code', () => {
    const noSet = makeCard({ setCode: '' })
    expect(filterCards([noSet], makeFilters({ setCodes: ['mkm'] }))).toHaveLength(0)
  })

  test('hideExtras has no effect in filterCards (applied at section level by the deck page)', () => {
    const cards = [makeCard(), makeCard({ name: 'Other' })]
    expect(filterCards(cards, makeFilters({ hideExtras: true }))).toEqual(cards)
  })

  test('mana value filter matches the exact cmc, including 0', () => {
    const zero = makeCard({ name: 'Zero', cmc: 0 })
    const three = makeCard({ name: 'Three', cmc: 3 })
    expect(filterCards([zero, three], makeFilters({ manaValue: 0 })).map((c) => c.name)).toEqual([
      'Zero',
    ])
    expect(filterCards([zero, three], makeFilters({ manaValue: 3 })).map((c) => c.name)).toEqual([
      'Three',
    ])
  })

  test.each([
    ['<' as const, ['0', '1']],
    ['<=' as const, ['0', '1', '2']],
    ['>' as const, ['3', '5']],
    ['>=' as const, ['2', '3', '5']],
    ['=' as const, ['2']],
  ])('mana value comparator %s 2 keeps the expected cards', (op, expected) => {
    const cards = [0, 1, 2, 3, 5].map((cmc) => makeCard({ name: String(cmc), cmc }))
    const result = filterCards(cards, makeFilters({ manaValue: 2, manaValueOp: op }))
    expect(result.map((c) => c.name)).toEqual(expected)
  })

  test('filters combine: every active filter must pass', () => {
    const match = makeCard({
      name: 'Green Elf',
      colorIdentity: ['G'],
      setCode: 'tsb',
      cmc: 1,
      price: 2,
    })
    const wrongSet = makeCard({ ...match, name: 'Green Elf Twin', setCode: 'tsa' })
    const result = filterCards(
      [match, wrongSet],
      makeFilters({ name: 'elf', colors: ['G'], setCodes: ['tsb'], manaValue: 1 }),
    )
    expect(result.map((c) => c.name)).toEqual(['Green Elf'])
  })
})

describe('matchesAllTerms', () => {
  test('terms can appear in any order', () => {
    expect(matchesAllTerms('Black Market Connections', 'connections black')).toBe(true)
  })

  test('empty query matches everything', () => {
    expect(matchesAllTerms('Anything', '')).toBe(true)
  })

  test('fails when any term is missing', () => {
    expect(matchesAllTerms('Black Lotus', 'black market')).toBe(false)
  })
})

describe('countActiveFilters', () => {
  test('defaults count as zero', () => {
    expect(countActiveFilters(createDefaultCardFilters())).toBe(0)
  })

  test('whitespace-only name does not count as active', () => {
    expect(countActiveFilters(makeFilters({ name: '   ' }))).toBe(0)
  })

  test('mana value 0 counts as active', () => {
    expect(countActiveFilters(makeFilters({ manaValue: 0 }))).toBe(1)
  })

  test('each filter contributes one to the count', () => {
    const filters = makeFilters({
      hideLands: true,
      hideUnpriced: true,
      hideExtras: true,
      name: 'bolt',
      colors: ['R'],
      setCodes: ['lea'],
      manaValue: 1,
    })
    expect(countActiveFilters(filters)).toBe(7)
  })

  test('a non-default comparator alone does not count as active', () => {
    expect(countActiveFilters(makeFilters({ manaValueOp: '>=' }))).toBe(0)
  })
})

describe('parseManaValueFilter', () => {
  test('empty input clears the filter', () => {
    expect(parseManaValueFilter('')).toEqual({ ok: true, value: null })
    expect(parseManaValueFilter('   ')).toEqual({ ok: true, value: null })
  })

  test('parses non-negative integers including 0', () => {
    expect(parseManaValueFilter('0')).toEqual({ ok: true, value: 0 })
    expect(parseManaValueFilter('12')).toEqual({ ok: true, value: 12 })
  })

  test.each(['-1', '1.5', 'abc', '1e3'])('rejects %p', (input) => {
    const result = parseManaValueFilter(input)
    expect(result.ok).toBe(false)
  })
})

describe('toggleColorSelection', () => {
  test('adds a color keeping canonical WUBRG order', () => {
    expect(toggleColorSelection(['G'], 'W')).toEqual(['W', 'G'])
    expect(toggleColorSelection(['W', 'G'], 'B')).toEqual(['W', 'B', 'G'])
  })

  test('removes an already-selected color', () => {
    expect(toggleColorSelection(['W', 'B', 'G'], 'B')).toEqual(['W', 'G'])
  })
})

describe('collectSetCodes', () => {
  test('returns unique lowercase codes, sorted, skipping empty', () => {
    const cards = [
      makeCard({ setCode: 'MKM' }),
      makeCard({ setCode: 'lea' }),
      makeCard({ setCode: 'mkm' }),
      makeCard({ setCode: '' }),
    ]
    expect(collectSetCodes(cards)).toEqual(['lea', 'mkm'])
  })
})
