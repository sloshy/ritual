import { describe, expect, test } from 'bun:test'
import {
  sortCards,
  groupAndSortCards,
  getCardTypeCategory,
  colorIdentityKey,
  colorIdentityName,
  colorIdentitySortValue,
  getPriceGroupKey,
  groupTotalPrice,
  type CardData,
} from '../../../src/site/card-sorting'

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
    setCode: 'FDN',
    colorIdentity: [],
    hasPrinting: true,
    card: null,
    ...overrides,
  }
}

describe('sortCards', () => {
  test('sorts by name ascending', () => {
    const a = makeCard({ name: 'Alpha' })
    const b = makeCard({ name: 'Beta' })
    expect(sortCards(a, b, 'name', false)).toBeLessThan(0)
    expect(sortCards(b, a, 'name', false)).toBeGreaterThan(0)
  })

  test('sorts by name descending when reversed', () => {
    const a = makeCard({ name: 'Alpha' })
    const b = makeCard({ name: 'Beta' })
    expect(sortCards(a, b, 'name', true)).toBeGreaterThan(0)
  })

  test('sorts by cmc', () => {
    const a = makeCard({ cmc: 2 })
    const b = makeCard({ cmc: 5 })
    expect(sortCards(a, b, 'cmc', false)).toBeLessThan(0)
    expect(sortCards(a, b, 'cmc', true)).toBeGreaterThan(0)
  })

  test('sorts by price', () => {
    const a = makeCard({ price: 0.5 })
    const b = makeCard({ price: 10.0 })
    expect(sortCards(a, b, 'price', false)).toBeLessThan(0)
  })

  test('sorts by file-order', () => {
    const a = makeCard({ fileOrder: 0 })
    const b = makeCard({ fileOrder: 5 })
    expect(sortCards(a, b, 'file-order', false)).toBeLessThan(0)
    expect(sortCards(a, b, 'file-order', true)).toBeGreaterThan(0)
  })

  test('sorts by set-code then name', () => {
    const a = makeCard({ setCode: 'AAA', name: 'Beta' })
    const b = makeCard({ setCode: 'BBB', name: 'Alpha' })
    expect(sortCards(a, b, 'set-code', false)).toBeLessThan(0)

    // Same set code, sort by name
    const c = makeCard({ setCode: 'AAA', name: 'Alpha' })
    const d = makeCard({ setCode: 'AAA', name: 'Beta' })
    expect(sortCards(c, d, 'set-code', false)).toBeLessThan(0)
  })

  test('sorts by edhrec rank', () => {
    const a = makeCard({ edhrec: 100 })
    const b = makeCard({ edhrec: 5000 })
    expect(sortCards(a, b, 'edhrec', false)).toBeLessThan(0)
  })

  test('sorts by color identity in WUBRG order', () => {
    const white = makeCard({ name: 'White Card', colorIdentity: ['W'] })
    const blue = makeCard({ name: 'Blue Card', colorIdentity: ['U'] })
    const black = makeCard({ name: 'Black Card', colorIdentity: ['B'] })
    const red = makeCard({ name: 'Red Card', colorIdentity: ['R'] })
    const green = makeCard({ name: 'Green Card', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Colorless Card', colorIdentity: [] })

    expect(sortCards(colorless, white, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(white, blue, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(blue, black, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(black, red, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(red, green, 'color-identity', false)).toBeLessThan(0)
  })

  test('sorts multicolor by first then second color', () => {
    const wu = makeCard({ name: 'WU Card', colorIdentity: ['W', 'U'] })
    const wb = makeCard({ name: 'WB Card', colorIdentity: ['W', 'B'] })
    const ur = makeCard({ name: 'UR Card', colorIdentity: ['U', 'R'] })

    expect(sortCards(wu, wb, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(wb, ur, 'color-identity', false)).toBeLessThan(0)
  })

  test('sorts mono before multicolor', () => {
    const mono = makeCard({ name: 'Mono', colorIdentity: ['G'] })
    const multi = makeCard({ name: 'Multi', colorIdentity: ['W', 'U'] })
    expect(sortCards(mono, multi, 'color-identity', false)).toBeLessThan(0)
  })

  test('falls through to name tiebreaker when color identity is identical', () => {
    const a = makeCard({ name: 'Alpha', colorIdentity: ['W'] })
    const b = makeCard({ name: 'Beta', colorIdentity: ['W'] })
    expect(sortCards(a, b, 'color-identity', false)).toBeLessThan(0)
    expect(sortCards(b, a, 'color-identity', false)).toBeGreaterThan(0)
  })
})

describe('getCardTypeCategory', () => {
  test.each([
    ['Creature — Human Wizard', 'Creature'],
    ['Legendary Planeswalker — Teferi', 'Planeswalker'],
    ['Instant', 'Instant'],
    ['Sorcery', 'Sorcery'],
    ['Artifact', 'Artifact'],
    ['Enchantment — Aura', 'Enchantment'],
    ['Basic Land — Mountain', 'Land'],
    ['Conspiracy', 'Other'],
  ])('identifies %s as %s', (typeLine, expected) => {
    expect(getCardTypeCategory(typeLine)).toBe(expected)
  })
})

describe('groupAndSortCards', () => {
  const cards = [
    makeCard({ name: 'Bolt', type: 'Instant', cmc: 1, fileOrder: 2 }),
    makeCard({ name: 'Sol Ring', type: 'Artifact', cmc: 1, fileOrder: 0 }),
    makeCard({ name: 'Grizzly Bears', type: 'Creature — Bear', cmc: 2, fileOrder: 1 }),
  ]

  test('groups by none puts all in one group', () => {
    const groups = groupAndSortCards(cards, 'none', 'name', false, [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('All Cards')
    expect(groups[0]!.cards).toHaveLength(3)
  })

  test('groups by type', () => {
    const groups = groupAndSortCards(cards, 'type', 'name', false, [])
    const keys = groups.map((g) => g.key)
    expect(keys).toContain('Creature')
    expect(keys).toContain('Instant')
    expect(keys).toContain('Artifact')
  })

  test('groups by cmc', () => {
    const groups = groupAndSortCards(cards, 'cmc', 'name', false, [])
    const keys = groups.map((g) => g.key)
    expect(keys).toContain('1')
    expect(keys).toContain('2')
  })

  test('sorts within groups', () => {
    const groups = groupAndSortCards(cards, 'none', 'file-order', false, [])
    expect(groups[0]!.cards[0]!.name).toBe('Sol Ring')
    expect(groups[0]!.cards[1]!.name).toBe('Grizzly Bears')
    expect(groups[0]!.cards[2]!.name).toBe('Bolt')
  })

  test('respects reverse flag', () => {
    const groups = groupAndSortCards(cards, 'none', 'file-order', true, [])
    expect(groups[0]!.cards[0]!.name).toBe('Bolt')
    expect(groups[0]!.cards[2]!.name).toBe('Sol Ring')
  })

  test('groups by section with section order', () => {
    const sectionCards = [
      makeCard({ name: 'A', section: 'Sideboard' }),
      makeCard({ name: 'B', section: 'Main' }),
    ]
    const groups = groupAndSortCards(sectionCards, 'section', 'name', false, ['Main', 'Sideboard'])
    expect(groups[0]!.key).toBe('Main')
    expect(groups[1]!.key).toBe('Sideboard')
  })

  test('groups by color identity with WUBRG-ordered names', () => {
    const colorCards = [
      makeCard({ name: 'Green Card', colorIdentity: ['G'] }),
      makeCard({ name: 'White Card', colorIdentity: ['W'] }),
      makeCard({ name: 'Azorius Card', colorIdentity: ['W', 'U'] }),
      makeCard({ name: 'Colorless Card', colorIdentity: [] }),
    ]
    const groups = groupAndSortCards(colorCards, 'color-identity', 'name', false, [])
    const keys = groups.map((g) => g.key)
    expect(keys[0]).toBe('Colorless')
    expect(keys[1]).toBe('White')
    expect(keys[2]).toBe('Green')
    expect(keys[3]).toBe('Azorius (WU)')
  })

  test('groups by printing into specific and any, specific first', () => {
    const printingCards = [
      makeCard({ name: 'Any A', hasPrinting: false }),
      makeCard({ name: 'Specific A', hasPrinting: true }),
      makeCard({ name: 'Any B', hasPrinting: false }),
    ]
    const groups = groupAndSortCards(printingCards, 'printing', 'name', false, [])
    expect(groups.map((g) => g.key)).toEqual(['Specific Printing', 'Any Printing'])
    expect(groups[0]!.cards.map((c) => c.name)).toEqual(['Specific A'])
    expect(groups[1]!.cards.map((c) => c.name)).toEqual(['Any A', 'Any B'])
  })

  test('omits a printing group when no cards fall into it', () => {
    const allSpecific = [
      makeCard({ name: 'A', hasPrinting: true }),
      makeCard({ name: 'B', hasPrinting: true }),
    ]
    const groups = groupAndSortCards(allSpecific, 'printing', 'name', false, [])
    expect(groups.map((g) => g.key)).toEqual(['Specific Printing'])
  })
})

describe('groupAndSortCards with reverseGroups', () => {
  test('reverseGroups reverses type group order', () => {
    const cards = [
      makeCard({ name: 'A', type: 'Creature — Bear', cmc: 2 }),
      makeCard({ name: 'B', type: 'Instant', cmc: 1 }),
      makeCard({ name: 'C', type: 'Artifact', cmc: 1 }),
    ]
    // TYPE_ORDER canonical: Creature, Instant, Artifact (subset of the full WUBRG-style order).
    const normal = groupAndSortCards(cards, 'type', 'name', false, [], undefined, 'usd', false)
    const reversed = groupAndSortCards(cards, 'type', 'name', false, [], undefined, 'usd', true)
    expect(normal.map((g) => g.key)).toEqual(['Creature', 'Instant', 'Artifact'])
    expect(reversed.map((g) => g.key)).toEqual(['Artifact', 'Instant', 'Creature'])
  })

  test('reverseGroups reverses printing group order', () => {
    const cards = [
      makeCard({ name: 'A', hasPrinting: true }),
      makeCard({ name: 'B', hasPrinting: false }),
    ]
    const reversed = groupAndSortCards(cards, 'printing', 'name', false, [], undefined, 'usd', true)
    expect(reversed.map((g) => g.key)).toEqual(['Any Printing', 'Specific Printing'])
  })

  test('reverseGroups reverses cmc group order', () => {
    const cards = [
      makeCard({ name: 'A', cmc: 1 }),
      makeCard({ name: 'B', cmc: 3 }),
      makeCard({ name: 'C', cmc: 2 }),
    ]
    const reversed = groupAndSortCards(cards, 'cmc', 'name', false, [], undefined, 'usd', true)
    const keys = reversed.map((g) => g.key)
    expect(keys).toEqual(['3', '2', '1'])
  })

  test('reverseGroups reverses section group order', () => {
    const sectionCards = [
      makeCard({ name: 'A', section: 'Sideboard' }),
      makeCard({ name: 'B', section: 'Main' }),
    ]
    const reversed = groupAndSortCards(
      sectionCards,
      'section',
      'name',
      false,
      ['Main', 'Sideboard'],
      undefined,
      'usd',
      true,
    )
    expect(reversed[0]!.key).toBe('Sideboard')
    expect(reversed[1]!.key).toBe('Main')
  })

  test('reverseGroups does not affect card order within groups', () => {
    const cards = [
      makeCard({ name: 'Charlie', type: 'Creature — Bear' }),
      makeCard({ name: 'Alpha', type: 'Instant' }),
      makeCard({ name: 'Beta', type: 'Creature — Bear' }),
    ]
    const reversed = groupAndSortCards(cards, 'type', 'name', false, [], undefined, 'usd', true)
    const creatureGroup = reversed.find((g) => g.key === 'Creature')!
    expect(creatureGroup.cards[0]!.name).toBe('Beta')
    expect(creatureGroup.cards[1]!.name).toBe('Charlie')
  })

  test('reverseGroups is independent of reverse (card sort) flag', () => {
    const cards = [
      makeCard({ name: 'Charlie', type: 'Creature — Bear' }),
      makeCard({ name: 'Alpha', type: 'Instant' }),
      makeCard({ name: 'Beta', type: 'Creature — Bear' }),
    ]
    const normalSections = groupAndSortCards(
      cards,
      'type',
      'name',
      false,
      [],
      undefined,
      'usd',
      false,
    )
    // Both reversed: sections reversed, cards reversed within sections
    const bothReversed = groupAndSortCards(cards, 'type', 'name', true, [], undefined, 'usd', true)

    // Canonical type order is Creature, Instant; reversed is Instant, Creature.
    expect(normalSections.map((g) => g.key)).toEqual(['Creature', 'Instant'])
    expect(bothReversed.map((g) => g.key)).toEqual(['Instant', 'Creature'])

    // Cards within creature group should be reverse-alphabetical
    const creatureGroup = bothReversed.find((g) => g.key === 'Creature')!
    expect(creatureGroup.cards[0]!.name).toBe('Charlie')
    expect(creatureGroup.cards[1]!.name).toBe('Beta')
  })

  test('reverseGroups false leaves group order unchanged', () => {
    const cards = [makeCard({ name: 'A', cmc: 1 }), makeCard({ name: 'B', cmc: 2 })]
    const normal = groupAndSortCards(cards, 'cmc', 'name', false, [], undefined, 'usd', false)
    const keys = normal.map((g) => g.key)
    expect(keys).toEqual(['1', '2'])
  })
})

describe('colorIdentityKey', () => {
  test('returns empty string for colorless', () => {
    expect(colorIdentityKey([])).toBe('')
  })

  test('normalizes to WUBRG order', () => {
    expect(colorIdentityKey(['G', 'W'])).toBe('WG')
    expect(colorIdentityKey(['R', 'U', 'B'])).toBe('UBR')
  })

  test('handles all five colors', () => {
    expect(colorIdentityKey(['G', 'B', 'R', 'U', 'W'])).toBe('WUBRG')
  })
})

describe('colorIdentityName', () => {
  test('returns Colorless for empty', () => {
    expect(colorIdentityName([])).toBe('Colorless')
  })

  test.each([
    [['W'], 'White'],
    [['U'], 'Blue'],
    [['B'], 'Black'],
    [['R'], 'Red'],
    [['G'], 'Green'],
  ] as const)('returns mono color name %p → %s', (input, expected) => {
    expect(colorIdentityName([...input])).toBe(expected)
  })

  test('returns guild names for two-color combos', () => {
    expect(colorIdentityName(['W', 'U'])).toBe('Azorius (WU)')
    expect(colorIdentityName(['U', 'R'])).toBe('Izzet (UR)')
    expect(colorIdentityName(['B', 'G'])).toBe('Golgari (BG)')
  })

  test('returns shard/wedge names for three-color combos', () => {
    expect(colorIdentityName(['W', 'U', 'B'])).toBe('Esper (WUB)')
    expect(colorIdentityName(['B', 'R', 'G'])).toBe('Jund (BRG)')
  })

  test('returns four-color name with WUBRG-ordered key', () => {
    // Input is given in non-canonical order to verify both lookup and key normalization.
    expect(colorIdentityName(['R', 'W', 'U', 'B'])).toBe('WUBR (Four Color)')
    expect(colorIdentityName(['G', 'U', 'B', 'R'])).toBe('UBRG (Four Color)')
  })

  test('returns WUBRG (Five Color) for all five', () => {
    expect(colorIdentityName(['W', 'U', 'B', 'R', 'G'])).toBe('WUBRG (Five Color)')
  })
})

describe('colorIdentitySortValue', () => {
  test('colorless sorts first', () => {
    expect(colorIdentitySortValue([])).toBe(0)
  })

  test('mono colors sort strictly in WUBRG order', () => {
    const values = (['W', 'U', 'B', 'R', 'G'] as const).map((c) => colorIdentitySortValue([c]))
    // Each consecutive pair must be strictly increasing.
    for (let i = 1; i < values.length; i++) {
      expect(values[i - 1]).toBeLessThan(values[i]!)
    }
  })

  test('mono sorts before two-color', () => {
    const g = colorIdentitySortValue(['G'])
    const wu = colorIdentitySortValue(['W', 'U'])
    expect(g).toBeLessThan(wu)
  })

  test('two-color sorts by first then second color', () => {
    const wu = colorIdentitySortValue(['W', 'U'])
    const wb = colorIdentitySortValue(['W', 'B'])
    const ur = colorIdentitySortValue(['U', 'R'])
    expect(wu).toBeLessThan(wb)
    expect(wb).toBeLessThan(ur)
  })
})

describe('getPriceGroupKey', () => {
  test('archidekt strategy groups into correct brackets', () => {
    expect(getPriceGroupKey(0.25, 'archidekt')).toBe('$0 – $0.50')
    expect(getPriceGroupKey(0.75, 'archidekt')).toBe('$0.50 – $1')
    expect(getPriceGroupKey(3.0, 'archidekt')).toBe('$1 – $5')
    expect(getPriceGroupKey(7.5, 'archidekt')).toBe('$5 – $10')
    expect(getPriceGroupKey(15, 'archidekt')).toBe('$10 – $20')
    expect(getPriceGroupKey(35, 'archidekt')).toBe('$20 – $50')
    expect(getPriceGroupKey(75, 'archidekt')).toBe('$50 – $100')
    expect(getPriceGroupKey(150, 'archidekt')).toBe('$100+')
  })

  test('five-dollar strategy groups correctly', () => {
    expect(getPriceGroupKey(2.5, 'five')).toBe('$0 – $5')
    expect(getPriceGroupKey(7.5, 'five')).toBe('$5 – $10')
    expect(getPriceGroupKey(22.0, 'five')).toBe('$20 – $25')
  })

  test('ten-dollar strategy groups correctly', () => {
    expect(getPriceGroupKey(2.5, 'ten')).toBe('$0 – $10')
    expect(getPriceGroupKey(15, 'ten')).toBe('$10 – $20')
    expect(getPriceGroupKey(95, 'ten')).toBe('$90 – $100')
  })

  test('zero price goes to No Price Data group', () => {
    expect(getPriceGroupKey(0, 'archidekt')).toBe('No Price Data')
    expect(getPriceGroupKey(0, 'five')).toBe('No Price Data')
    expect(getPriceGroupKey(0, 'ten')).toBe('No Price Data')
  })

  test('renders bracket labels using the requested currency symbol', () => {
    // The default formatter uses '$' for usd, '€' for eur, and a ' tix' suffix.
    expect(getPriceGroupKey(3.0, 'archidekt', 'eur')).toBe('€1 – €5')
    expect(getPriceGroupKey(150, 'archidekt', 'eur')).toBe('€100+')
    expect(getPriceGroupKey(2.5, 'ten', 'tix')).toBe('0 tix – 10 tix')
  })
})

describe('groupAndSortCards with price grouping', () => {
  test('groups cards by archidekt price brackets', () => {
    const cards = [
      makeCard({ name: 'Cheap', price: 0.25 }),
      makeCard({ name: 'Mid', price: 7.5 }),
      makeCard({ name: 'Expensive', price: 150 }),
    ]
    const groups = groupAndSortCards(cards, 'price', 'name', false, [], 'archidekt')
    const keys = groups.map((g) => g.key)
    expect(keys).toContain('$0 – $0.50')
    expect(keys).toContain('$5 – $10')
    expect(keys).toContain('$100+')
  })

  test('sorts price groups in ascending bracket order', () => {
    const cards = [
      makeCard({ name: 'Expensive', price: 150 }),
      makeCard({ name: 'Cheap', price: 0.25 }),
      makeCard({ name: 'Mid', price: 7.5 }),
    ]
    const groups = groupAndSortCards(cards, 'price', 'name', false, [], 'archidekt')
    const keys = groups.map((g) => g.key)
    expect(keys.indexOf('$0 – $0.50')).toBeLessThan(keys.indexOf('$5 – $10'))
    expect(keys.indexOf('$5 – $10')).toBeLessThan(keys.indexOf('$100+'))
  })

  test('No Price Data group sorts after all price brackets', () => {
    const cards = [
      makeCard({ name: 'No Price', price: 0 }),
      makeCard({ name: 'Cheap', price: 0.25 }),
      makeCard({ name: 'Expensive', price: 150 }),
    ]
    const groups = groupAndSortCards(cards, 'price', 'name', false, [], 'archidekt')
    const keys = groups.map((g) => g.key)
    expect(keys[keys.length - 1]).toBe('No Price Data')
  })
})

describe('groupTotalPrice', () => {
  test('sums prices of all cards', () => {
    const cards = [makeCard({ price: 1.5, quantity: 2 }), makeCard({ price: 3.0, quantity: 1 })]
    expect(groupTotalPrice(cards)).toBeCloseTo(6.0)
  })

  test('returns 0 for empty array', () => {
    expect(groupTotalPrice([])).toBe(0)
  })
})
