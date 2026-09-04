import { describe, expect, test } from 'bun:test'
import {
  compareBySortLayers,
  groupAndSortCards,
  getCardTypeCategory,
  colorIdentityKey,
  colorIdentityName,
  getPriceGroupKey,
  groupTotalPrice,
  sortByOptions,
  type SortBy,
  type SortLayer,
} from '../../../src/list-view/card-sorting'
import { makeCardData as makeCard } from '../../test-utils'
import { t } from '../../../src/i18n/t'

/** Build a single-layer sort, the common case in these tests. */
function sl(sortBy: SortBy, reverse = false): SortLayer[] {
  return [{ sortBy, reverse }]
}

describe('compareBySortLayers', () => {
  test('sorts by name ascending', () => {
    const a = makeCard({ name: 'Alpha' })
    const b = makeCard({ name: 'Beta' })
    expect(compareBySortLayers(a, b, sl('name'))).toBeLessThan(0)
    expect(compareBySortLayers(b, a, sl('name'))).toBeGreaterThan(0)
  })

  test('sorts by name descending when reversed', () => {
    const a = makeCard({ name: 'Alpha' })
    const b = makeCard({ name: 'Beta' })
    expect(compareBySortLayers(a, b, sl('name', true))).toBeGreaterThan(0)
  })

  test('sorts by cmc', () => {
    const a = makeCard({ cmc: 2 })
    const b = makeCard({ cmc: 5 })
    expect(compareBySortLayers(a, b, sl('cmc'))).toBeLessThan(0)
    expect(compareBySortLayers(a, b, sl('cmc', true))).toBeGreaterThan(0)
  })

  test('sorts by price', () => {
    const a = makeCard({ price: 0.5 })
    const b = makeCard({ price: 10.0 })
    expect(compareBySortLayers(a, b, sl('price'))).toBeLessThan(0)
  })

  test('sorts by file-order', () => {
    const a = makeCard({ fileOrder: 0 })
    const b = makeCard({ fileOrder: 5 })
    expect(compareBySortLayers(a, b, sl('file-order'))).toBeLessThan(0)
    expect(compareBySortLayers(a, b, sl('file-order', true))).toBeGreaterThan(0)
  })

  test('sorts by set-code, breaking ties by name', () => {
    const a = makeCard({ setCode: 'AAA', name: 'Beta' })
    const b = makeCard({ setCode: 'BBB', name: 'Alpha' })
    expect(compareBySortLayers(a, b, sl('set-code'))).toBeLessThan(0)

    // Same set code falls back to the always-ascending name tiebreaker.
    const c = makeCard({ setCode: 'AAA', name: 'Alpha' })
    const d = makeCard({ setCode: 'AAA', name: 'Beta' })
    expect(compareBySortLayers(c, d, sl('set-code'))).toBeLessThan(0)
  })

  test('sorts by edhrec rank', () => {
    const a = makeCard({ edhrec: 100 })
    const b = makeCard({ edhrec: 5000 })
    expect(compareBySortLayers(a, b, sl('edhrec'))).toBeLessThan(0)
  })

  test('sorts by color identity in WUBRG order', () => {
    const white = makeCard({ name: 'White Card', colorIdentity: ['W'] })
    const blue = makeCard({ name: 'Blue Card', colorIdentity: ['U'] })
    const black = makeCard({ name: 'Black Card', colorIdentity: ['B'] })
    const red = makeCard({ name: 'Red Card', colorIdentity: ['R'] })
    const green = makeCard({ name: 'Green Card', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Colorless Card', colorIdentity: [] })

    expect(compareBySortLayers(colorless, white, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(white, blue, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(blue, black, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(black, red, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(red, green, sl('color-identity'))).toBeLessThan(0)
  })

  test('sorts multicolor by first then second color', () => {
    const wu = makeCard({ name: 'WU Card', colorIdentity: ['W', 'U'] })
    const wb = makeCard({ name: 'WB Card', colorIdentity: ['W', 'B'] })
    const ur = makeCard({ name: 'UR Card', colorIdentity: ['U', 'R'] })

    expect(compareBySortLayers(wu, wb, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(wb, ur, sl('color-identity'))).toBeLessThan(0)
  })

  test('sorts mono before multicolor', () => {
    const mono = makeCard({ name: 'Mono', colorIdentity: ['G'] })
    const multi = makeCard({ name: 'Multi', colorIdentity: ['W', 'U'] })
    expect(compareBySortLayers(mono, multi, sl('color-identity'))).toBeLessThan(0)
  })

  test('falls through to name tiebreaker when color identity is identical', () => {
    const a = makeCard({ name: 'Alpha', colorIdentity: ['W'] })
    const b = makeCard({ name: 'Beta', colorIdentity: ['W'] })
    expect(compareBySortLayers(a, b, sl('color-identity'))).toBeLessThan(0)
    expect(compareBySortLayers(b, a, sl('color-identity'))).toBeGreaterThan(0)
  })

  test('empty layer list sorts purely by name', () => {
    const a = makeCard({ name: 'Alpha', price: 100 })
    const b = makeCard({ name: 'Beta', price: 1 })
    expect(compareBySortLayers(a, b, [])).toBeLessThan(0)
  })

  describe('multiple layers', () => {
    test('later layers break ties within the earlier one', () => {
      // Same name, different price → the second (price) layer decides.
      const cheap = makeCard({ name: 'Forest', price: 0.1 })
      const pricey = makeCard({ name: 'Forest', price: 20 })
      const layers: SortLayer[] = [
        { sortBy: 'name', reverse: false },
        { sortBy: 'price', reverse: false },
      ]
      expect(compareBySortLayers(cheap, pricey, layers)).toBeLessThan(0)
      expect(compareBySortLayers(pricey, cheap, layers)).toBeGreaterThan(0)
    })

    test('the primary layer wins when it is decisive', () => {
      // Different names → the price layer never gets consulted.
      const a = makeCard({ name: 'Alpha', price: 100 })
      const b = makeCard({ name: 'Beta', price: 1 })
      const layers: SortLayer[] = [
        { sortBy: 'name', reverse: false },
        { sortBy: 'price', reverse: false },
      ]
      expect(compareBySortLayers(a, b, layers)).toBeLessThan(0)
    })

    test('each layer honors its own reverse flag independently', () => {
      // Sort by name ascending, then price descending within a name.
      const cheap = makeCard({ name: 'Forest', price: 0.1 })
      const pricey = makeCard({ name: 'Forest', price: 20 })
      const layers: SortLayer[] = [
        { sortBy: 'name', reverse: false },
        { sortBy: 'price', reverse: true },
      ]
      expect(compareBySortLayers(pricey, cheap, layers)).toBeLessThan(0)
    })

    test('a reversed primary layer does not reverse the secondary layer', () => {
      // set-code descending, then cmc ascending within the same set. The two cards
      // share a set, so the primary layer ties and never applies its reverse — this
      // guards against a naive implementation that reverses the whole accumulated
      // result by the primary flag instead of reversing each layer independently.
      const lowCmc = makeCard({ setCode: 'AAA', name: 'X', cmc: 1 })
      const highCmc = makeCard({ setCode: 'AAA', name: 'Y', cmc: 5 })
      const layers: SortLayer[] = [
        { sortBy: 'set-code', reverse: true },
        { sortBy: 'cmc', reverse: false },
      ]
      expect(compareBySortLayers(lowCmc, highCmc, layers)).toBeLessThan(0)
    })

    test('a third layer breaks ties the first two leave equal', () => {
      // Same set and same cmc → only the third (price) layer decides.
      const cheap = makeCard({ setCode: 'AAA', cmc: 2, price: 1, name: 'A' })
      const pricey = makeCard({ setCode: 'AAA', cmc: 2, price: 9, name: 'A' })
      const layers: SortLayer[] = [
        { sortBy: 'set-code', reverse: false },
        { sortBy: 'cmc', reverse: false },
        { sortBy: 'price', reverse: false },
      ]
      expect(compareBySortLayers(cheap, pricey, layers)).toBeLessThan(0)
      expect(compareBySortLayers(pricey, cheap, layers)).toBeGreaterThan(0)
    })
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
    // Double-faced / multi-faced cards categorize by the front face only.
    ['Creature — Elf Druid // Land', 'Creature'],
    ['Land // Sorcery', 'Land'],
    ['Instant // Instant', 'Instant'],
    ['Enchantment — Saga // Creature — Avatar', 'Enchantment'],
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
    const groups = groupAndSortCards(cards, 'none', sl('name'), [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.key).toBe('All Cards')
    expect(groups[0]!.cards).toHaveLength(3)
  })

  test('groups by type', () => {
    const groups = groupAndSortCards(cards, 'type', sl('name'), [])
    const keys = groups.map((g) => g.key)
    expect(keys).toContain('Creature')
    expect(keys).toContain('Instant')
    expect(keys).toContain('Artifact')
  })

  test('groups by cmc', () => {
    const groups = groupAndSortCards(cards, 'cmc', sl('name'), [])
    const keys = groups.map((g) => g.key)
    expect(keys).toContain('1')
    expect(keys).toContain('2')
  })

  test('sorts within groups', () => {
    const groups = groupAndSortCards(cards, 'none', sl('file-order'), [])
    expect(groups[0]!.cards[0]!.name).toBe('Sol Ring')
    expect(groups[0]!.cards[1]!.name).toBe('Grizzly Bears')
    expect(groups[0]!.cards[2]!.name).toBe('Bolt')
  })

  test('respects reverse flag', () => {
    const groups = groupAndSortCards(cards, 'none', sl('file-order', true), [])
    expect(groups[0]!.cards[0]!.name).toBe('Bolt')
    expect(groups[0]!.cards[2]!.name).toBe('Sol Ring')
  })

  test('sorts within groups by multiple layers', () => {
    // Two cards share a name; the second (cmc) layer orders them.
    const dupes = [
      makeCard({ name: 'Ajani', cmc: 5, type: 'Planeswalker' }),
      makeCard({ name: 'Ajani', cmc: 2, type: 'Planeswalker' }),
      makeCard({ name: 'Bolt', cmc: 1, type: 'Planeswalker' }),
    ]
    const layers: SortLayer[] = [
      { sortBy: 'name', reverse: false },
      { sortBy: 'cmc', reverse: false },
    ]
    const groups = groupAndSortCards(dupes, 'none', layers, [])
    expect(groups[0]!.cards.map((c) => c.cmc)).toEqual([2, 5, 1])
  })

  test('groups by section with section order', () => {
    const sectionCards = [
      makeCard({ name: 'A', section: 'Sideboard' }),
      makeCard({ name: 'B', section: 'Main' }),
    ]
    const groups = groupAndSortCards(sectionCards, 'section', sl('name'), ['Main', 'Sideboard'])
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
    const groups = groupAndSortCards(colorCards, 'color-identity', sl('name'), [])
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
    const groups = groupAndSortCards(printingCards, 'printing', sl('name'), [])
    expect(groups.map((g) => g.key)).toEqual(['Specific Printing', 'Any Printing'])
    expect(groups[0]!.cards.map((c) => c.name)).toEqual(['Specific A'])
    expect(groups[1]!.cards.map((c) => c.name)).toEqual(['Any A', 'Any B'])
  })

  test('omits a printing group when no cards fall into it', () => {
    const allSpecific = [
      makeCard({ name: 'A', hasPrinting: true }),
      makeCard({ name: 'B', hasPrinting: true }),
    ]
    const groups = groupAndSortCards(allSpecific, 'printing', sl('name'), [])
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
    const normal = groupAndSortCards(cards, 'type', sl('name'), [], undefined, 'usd', false)
    const reversed = groupAndSortCards(cards, 'type', sl('name'), [], undefined, 'usd', true)
    expect(normal.map((g) => g.key)).toEqual(['Creature', 'Instant', 'Artifact'])
    expect(reversed.map((g) => g.key)).toEqual(['Artifact', 'Instant', 'Creature'])
  })

  test('reverseGroups reverses section group order', () => {
    const sectionCards = [
      makeCard({ name: 'A', section: 'Sideboard' }),
      makeCard({ name: 'B', section: 'Main' }),
    ]
    const reversed = groupAndSortCards(
      sectionCards,
      'section',
      sl('name'),
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
    const reversed = groupAndSortCards(cards, 'type', sl('name'), [], undefined, 'usd', true)
    const creatureGroup = reversed.find((g) => g.key === 'Creature')!
    expect(creatureGroup.cards[0]!.name).toBe('Beta')
    expect(creatureGroup.cards[1]!.name).toBe('Charlie')
  })

  test('reverseGroups is independent of the sort reverse flag', () => {
    const cards = [
      makeCard({ name: 'Charlie', type: 'Creature — Bear' }),
      makeCard({ name: 'Alpha', type: 'Instant' }),
      makeCard({ name: 'Beta', type: 'Creature — Bear' }),
    ]
    const normalSections = groupAndSortCards(cards, 'type', sl('name'), [], undefined, 'usd', false)
    // Both reversed: sections reversed, cards reversed within sections
    const bothReversed = groupAndSortCards(
      cards,
      'type',
      sl('name', true),
      [],
      undefined,
      'usd',
      true,
    )

    // Canonical type order is Creature, Instant; reversed is Instant, Creature.
    expect(normalSections.map((g) => g.key)).toEqual(['Creature', 'Instant'])
    expect(bothReversed.map((g) => g.key)).toEqual(['Instant', 'Creature'])

    // Cards within creature group should be reverse-alphabetical
    const creatureGroup = bothReversed.find((g) => g.key === 'Creature')!
    expect(creatureGroup.cards[0]!.name).toBe('Charlie')
    expect(creatureGroup.cards[1]!.name).toBe('Beta')
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
    const groups = groupAndSortCards(cards, 'price', sl('name'), [], 'archidekt')
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
    const groups = groupAndSortCards(cards, 'price', sl('name'), [], 'archidekt')
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
    const groups = groupAndSortCards(cards, 'price', sl('name'), [], 'archidekt')
    const keys = groups.map((g) => g.key)
    expect(keys[keys.length - 1]).toBe('No Price Data')
  })
})

describe('sortByOptions', () => {
  test('labels each field from SORT_BY_LABELS, preserving the given order', () => {
    expect(sortByOptions(['price', 'name'])).toEqual([
      { value: 'price', label: 'Price' },
      { value: 'name', label: 'Name' },
    ])
  })

  test('applies per-field label overrides', () => {
    // The combined view relabels 'file-order' as "List Order".
    expect(sortByOptions(['file-order'], { 'file-order': 'domain.sortBy.listOrder' })).toEqual([
      { value: 'file-order', label: 'List Order' },
    ])
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

describe('buylist grouping and sorting', () => {
  const listed = makeCard({ name: 'Listed', buylistPrice: 7.5, onBuylist: true })
  const unlisted = makeCard({ name: 'Unlisted', buylistPrice: 0, onBuylist: false })

  test('on-buylist grouping puts the cards the buyer will take first', () => {
    const groups = groupAndSortCards([unlisted, listed], 'on-buylist', sl('name'), [])
    expect(groups.map((g) => [g.key, g.cards.map((c) => c.name)])).toEqual([
      ['On Buylist', ['Listed']],
      ['Not on Buylist', ['Unlisted']],
    ])
  })

  test('buylist-price grouping buckets by the same brackets as price grouping', () => {
    const groups = groupAndSortCards(
      [listed, unlisted],
      'buylist-price',
      sl('name'),
      [],
      'archidekt',
    )
    expect(groups.map((g) => g.key)).toEqual(['$5 – $10', 'No Price Data'])
  })

  test('buylist-price bucket labels stay USD even on a EUR page', () => {
    // Buylist quotes are the buyer's own currency, never the page's.
    const groups = groupAndSortCards([listed], 'buylist-price', sl('name'), [], 'archidekt', 'eur')
    expect(groups[0]!.key).toBe('$5 – $10')
  })

  test('sorts by buylist price ascending, unsold cards first', () => {
    const sorted = [listed, unlisted].sort((a, b) => compareBySortLayers(a, b, sl('buylist-price')))
    expect(sorted.map((c) => c.name)).toEqual(['Unlisted', 'Listed'])
  })
})

describe('buylist spread sorting', () => {
  // Spread is the buyer's offer minus USD retail: 0 means they pay retail.
  // A nonzero spread implies an offer, so each carries the price that produced
  // it: `onBuylist` is true exactly when `buylistPrice > 0`.
  const overRetail = makeCard({
    name: 'Over',
    buylistPrice: 11.5,
    buylistSpread: 1.5,
    onBuylist: true,
  })
  const nearRetail = makeCard({
    name: 'Near',
    buylistPrice: 9.75,
    buylistSpread: -0.25,
    onBuylist: true,
  })
  const wellUnder = makeCard({ name: 'Under', buylistPrice: 1, buylistSpread: -9, onBuylist: true })
  const atRetail = makeCard({ name: 'Even', buylistSpread: 0 })

  test('sorts ascending, with a zero spread landing where its arithmetic puts it', () => {
    // Nothing is pinned to either end — a spread of 0 is an ordinary value, not
    // a "no data" sentinel. Alphabetical order would be Even, Near, Over, Under.
    const sorted = [overRetail, atRetail, wellUnder, nearRetail].sort((a, b) =>
      compareBySortLayers(a, b, sl('buylist-spread')),
    )
    expect(sorted.map((c) => c.name)).toEqual(['Under', 'Near', 'Even', 'Over'])
  })

  test('reversing the layer puts the best offers first', () => {
    // Three cards, not two: with only Over and Under the name tiebreaker alone
    // would produce the expected order whatever the comparator did.
    const sorted = [wellUnder, overRetail, nearRetail].sort((a, b) =>
      compareBySortLayers(a, b, [{ sortBy: 'buylist-spread', reverse: true }]),
    )
    expect(sorted.map((c) => c.name)).toEqual(['Over', 'Near', 'Under'])
  })

  test('equal spreads fall through to the name tiebreaker', () => {
    // Fed in reverse name order deliberately: `Array.sort` is stable, so an
    // already-sorted input would pass with no name tiebreaker at all.
    const other = makeCard({ name: 'Other', buylistSpread: 0 })
    const sorted = [other, atRetail].sort((a, b) => compareBySortLayers(a, b, sl('buylist-spread')))
    expect(sorted.map((c) => c.name)).toEqual(['Even', 'Other'])
  })
})

// Tags group by the whole *set*, one group per distinct set: a card lands in
// exactly one group like every other grouping, so a two-tag card is never
// counted in two groups' totals. The key is the canonical `a, b` string, so
// two spellings of one set share a group, and untagged cards gather last.
describe('groupAndSortCards — tags', () => {
  const untagged = t('site.groupBy.untagged')
  const cards = [
    makeCard({ name: 'Plain' }),
    makeCard({ name: 'Ramp Rock', tags: ['ramp'] }),
    makeCard({ name: 'Staple Rock', tags: ['staple', 'ramp'] }),
    makeCard({ name: 'Other Rock', tags: ['ramp', 'staple'] }),
    makeCard({ name: 'Draw Spell', tags: ['draw'] }),
    makeCard({ name: 'Empty Set', tags: [] }),
  ]

  test('one group per distinct tag set, in display order, untagged last', () => {
    const groups = groupAndSortCards(cards, 'tags', sl('name'), [])
    expect(groups.map((g) => g.key)).toEqual(['draw', 'ramp', 'ramp, staple', untagged])
    expect(groups.find((g) => g.key === 'ramp, staple')!.cards.map((c) => c.name)).toEqual([
      'Other Rock',
      'Staple Rock',
    ])
    // An empty set is "no tags", exactly as a missing one is.
    expect(groups.at(-1)!.cards.map((c) => c.name)).toEqual(['Empty Set', 'Plain'])
  })

  test('reverse groups puts untagged first', () => {
    const groups = groupAndSortCards(cards, 'tags', sl('name'), [], undefined, 'usd', true)
    expect(groups[0]!.key).toBe(untagged)
  })

  test('sorting by tags orders sets by their canonical string, untagged last', () => {
    const [group] = groupAndSortCards(cards, 'none', sl('tags'), [])
    expect(group!.cards.map((c) => c.name)).toEqual([
      'Draw Spell',
      'Ramp Rock',
      'Other Rock',
      'Staple Rock',
      'Empty Set',
      'Plain',
    ])
  })

  test('reversed tag sort puts untagged first and keeps name as the final tiebreaker', () => {
    const [group] = groupAndSortCards(cards, 'none', sl('tags', true), [])
    expect(group!.cards.map((c) => c.name)).toEqual([
      'Empty Set',
      'Plain',
      'Other Rock',
      'Staple Rock',
      'Ramp Rock',
      'Draw Spell',
    ])
  })
})

// Categories are name-keyed, ordered (the first is primary) and case-kept with a
// fold. The two groupings differ in exactly one way: `'category'` places a card
// under its primary only, `'categories'` under every category it holds — which
// deliberately breaks the one-card-one-group invariant, so group totals overlap.
describe('groupAndSortCards — categories', () => {
  const uncategorized = t('site.groupBy.uncategorized')
  const order = ['Ramp', 'Draw', 'Artifacts']
  const cards = [
    makeCard({ name: 'Sol Ring', categories: ['Ramp', 'Artifacts'] }),
    makeCard({ name: 'Rhystic Study', categories: ['Draw'] }),
    makeCard({ name: 'Arcane Signet', categories: ['Ramp'] }),
    makeCard({ name: 'Plain Card' }),
  ]

  test('primary grouping puts each card under its first category, uncategorized last', () => {
    const groups = groupAndSortCards(
      cards,
      'category',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    expect(groups.map((g) => g.key)).toEqual(['Ramp', 'Draw', uncategorized])
    expect(groups[0]!.cards.map((c) => c.name)).toEqual(['Arcane Signet', 'Sol Ring'])
    expect(groups.at(-1)!.cards.map((c) => c.name)).toEqual(['Plain Card'])
  })

  test("headings follow the list's vocabulary order, not the alphabet", () => {
    // Alphabetically Artifacts < Draw < Ramp; the sidecar says otherwise.
    const groups = groupAndSortCards(
      [makeCard({ name: 'A', categories: ['Artifacts'] }), ...cards],
      'category',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    expect(groups.map((g) => g.key)).toEqual(['Ramp', 'Draw', 'Artifacts', uncategorized])
  })

  test('a category the vocabulary does not name comes after the named ones', () => {
    const groups = groupAndSortCards(
      [makeCard({ name: 'Zed', categories: ['Combo'] }), ...cards],
      'category',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    expect(groups.map((g) => g.key)).toEqual(['Ramp', 'Draw', 'Combo', uncategorized])
  })

  test('the all-categories grouping puts a two-category card in both groups', () => {
    const groups = groupAndSortCards(
      cards,
      'categories',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    expect(groups.map((g) => g.key)).toEqual(['Ramp', 'Draw', 'Artifacts', uncategorized])
    expect(groups[0]!.cards.map((c) => c.name)).toEqual(['Arcane Signet', 'Sol Ring'])
    expect(groups[2]!.cards.map((c) => c.name)).toEqual(['Sol Ring'])
  })

  test('each non-uncategorized group carries its own category; the others carry no key at all', () => {
    const groups = groupAndSortCards(
      cards,
      'categories',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    expect(groups[0]!.category).toBe('Ramp')
    expect(groups[2]!.category).toBe('Artifacts')
    // bun's toEqual ignores undefined-valued keys, so assert presence.
    expect(groups.at(-1)!).not.toHaveProperty('category')
  })

  test('the primary grouping tags no group with a category', () => {
    const groups = groupAndSortCards(
      cards,
      'category',
      sl('name'),
      [],
      undefined,
      'usd',
      false,
      order,
    )
    for (const group of groups) expect(group).not.toHaveProperty('category')
  })

  test("two spellings of one category are one group, headed by the vocabulary's spelling", () => {
    const mixed = [
      makeCard({ name: 'One', categories: ['Ramp'] }),
      makeCard({ name: 'Two', categories: ['ramp'] }),
      makeCard({ name: 'Three', categories: ['RAMP'] }),
    ]
    const groups = groupAndSortCards(mixed, 'category', sl('name'), [], undefined, 'usd', false, [
      'Ramp',
    ])
    expect(groups.map((g) => g.key)).toEqual(['Ramp'])
    expect(groups[0]!.cards.map((c) => c.name)).toEqual(['One', 'Three', 'Two'])
  })

  test('a category no vocabulary names is headed by the first spelling seen', () => {
    const mixed = [
      makeCard({ name: 'One', categories: ['combo'] }),
      makeCard({ name: 'Two', categories: ['Combo'] }),
    ]
    const groups = groupAndSortCards(mixed, 'category', sl('name'), [], undefined, 'usd', false, [])
    expect(groups.map((g) => g.key)).toEqual(['combo'])
    expect(groups[0]!.cards).toHaveLength(2)
  })

  test('reverseGroups still reverses', () => {
    const groups = groupAndSortCards(
      cards,
      'category',
      sl('name'),
      [],
      undefined,
      'usd',
      true,
      order,
    )
    expect(groups[0]!.key).toBe(uncategorized)
  })
})

describe('compareBySortLayers — category', () => {
  test('orders by primary category with display collation, uncategorized last', () => {
    const cards = [
      makeCard({ name: 'None' }),
      makeCard({ name: 'Ramp Rock', categories: ['Ramp'] }),
      makeCard({ name: 'Draw Spell', categories: ['Draw', 'Ramp'] }),
      makeCard({ name: 'Empty List', categories: [] }),
    ]
    const sorted = [...cards].sort((a, b) => compareBySortLayers(a, b, sl('category')))
    expect(sorted.map((c) => c.name)).toEqual(['Draw Spell', 'Ramp Rock', 'Empty List', 'None'])
  })

  test('reversing the layer puts uncategorized first', () => {
    const cards = [
      makeCard({ name: 'None' }),
      makeCard({ name: 'Ramp Rock', categories: ['Ramp'] }),
    ]
    const sorted = [...cards].sort((a, b) => compareBySortLayers(a, b, sl('category', true)))
    expect(sorted.map((c) => c.name)).toEqual(['None', 'Ramp Rock'])
  })
})
