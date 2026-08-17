import { describe, expect, test } from 'bun:test'
import {
  collectArtTags,
  collectCardTypes,
  collectOracleTags,
  collectSetCodes,
  countActiveFilters,
  countNarrowingFilters,
  createDefaultCardFilters,
  filterCards,
  isTagFilterActive,
  parseCopiesFilter,
  parseManaValueFilter,
  parseNonNegativeInteger,
  parsePriceAmount,
  parseLabelsParam,
  parsePriceFilter,
  toggleColorSelection,
  toggleBuylistFilterOption,
  toggleLabelFilterOption,
  parseBuylistParam,
  untaggedAddedCardNames,
  type CardFilters,
  type CopiesMatchMode,
} from '../../../src/site/card-filters'
import type { CardData } from '../../../src/site/card-sorting'
import type { Finish } from '../../../src/types'
import { makeCardData as makeCard, makeScryfallCard } from '../../test-utils'

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

  test('exact color filter matches only the identical color identity', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const result = filterCards(
      [golgari, mono, colorless],
      makeFilters({ colors: ['B', 'G'], colorMode: 'exact' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Golgari'])
  })

  test('exact color match ignores identity ordering', () => {
    const card = makeCard({ colorIdentity: ['G', 'B'] })
    expect(
      filterCards([card], makeFilters({ colors: ['B', 'G'], colorMode: 'exact' })),
    ).toHaveLength(1)
  })

  test('subset color filter matches any card playable in the selected colors', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const boros = makeCard({ name: 'Boros', colorIdentity: ['R', 'W'] })
    const result = filterCards(
      [golgari, mono, colorless, boros],
      makeFilters({ colors: ['B', 'G'], colorMode: 'subset' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Golgari', 'Mono Green', 'Rock'])
  })

  // 'include' is any-of, matching its meaning on every other filter: a partial
  // overlap counts, and (unlike 'subset') a colorless card never does.
  test('include color filter matches cards using at least one selected color', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const jund = makeCard({ name: 'Jund', colorIdentity: ['B', 'G', 'R'] })
    const boros = makeCard({ name: 'Boros', colorIdentity: ['R', 'W'] })
    const result = filterCards(
      [golgari, mono, colorless, jund, boros],
      makeFilters({ colors: ['B', 'G'], colorMode: 'include' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Golgari', 'Mono Green', 'Jund'])
  })

  test('exclude color filter drops cards using any selected color, keeping colorless', () => {
    const golgari = makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] })
    const mono = makeCard({ name: 'Mono Green', colorIdentity: ['G'] })
    const colorless = makeCard({ name: 'Rock', colorIdentity: [] })
    const boros = makeCard({ name: 'Boros', colorIdentity: ['R', 'W'] })
    const result = filterCards(
      [golgari, mono, colorless, boros],
      makeFilters({ colors: ['B', 'G'], colorMode: 'exclude' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Rock', 'Boros'])
  })

  // Colorless contributes no color to the selection, so each mode reads it a bit
  // differently — these pin all four against the same card set.
  describe('colorless selection', () => {
    const cards = [
      makeCard({ name: 'Golgari', colorIdentity: ['B', 'G'] }),
      makeCard({ name: 'Mono Green', colorIdentity: ['G'] }),
      makeCard({ name: 'Rock', colorIdentity: [] }),
      makeCard({ name: 'Boros', colorIdentity: ['R', 'W'] }),
    ]
    const names = (filters: Partial<CardFilters>): string[] =>
      filterCards(cards, makeFilters(filters)).map((c) => c.name)

    test('colorless alone selects only cards with an empty identity', () => {
      // The default mode ('subset') is the one a user lands on by just clicking C.
      expect(names({ colorless: true })).toEqual(['Rock'])
      expect(names({ colorless: true, colorMode: 'include' })).toEqual(['Rock'])
      expect(names({ colorless: true, colorMode: 'exact' })).toEqual(['Rock'])
    })

    test('colorless alone under exclude hides exactly the colorless cards', () => {
      expect(names({ colorless: true, colorMode: 'exclude' })).toEqual([
        'Golgari',
        'Mono Green',
        'Boros',
      ])
    })

    test('colorless combines with colors as one more thing a card may match', () => {
      expect(names({ colors: ['G'], colorless: true, colorMode: 'include' })).toEqual([
        'Golgari',
        'Mono Green',
        'Rock',
      ])
      expect(names({ colors: ['G'], colorless: true, colorMode: 'exact' })).toEqual([
        'Mono Green',
        'Rock',
      ])
    })

    test('colorless is redundant under subset, which already admits colorless cards', () => {
      const withFlag = names({ colors: ['B', 'G'], colorless: true })
      expect(withFlag).toEqual(names({ colors: ['B', 'G'] }))
      expect(withFlag).toContain('Rock')
    })

    test('exclude with colors and colorless drops both', () => {
      expect(names({ colors: ['G'], colorless: true, colorMode: 'exclude' })).toEqual(['Boros'])
    })
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

  test('set code exclude mode drops cards from the selected sets and keeps the rest', () => {
    const a = makeCard({ name: 'A', setCode: 'mkm' })
    const b = makeCard({ name: 'B', setCode: 'lea' })
    const c = makeCard({ name: 'C', setCode: '2xm' })
    const result = filterCards(
      [a, b, c],
      makeFilters({ setCodes: ['mkm', '2xm'], setCodeMode: 'exclude' }),
    )
    expect(result.map((card) => card.name)).toEqual(['B'])
  })

  test('set code exclude mode with no set code keeps the card (empty set never matches)', () => {
    const noSet = makeCard({ setCode: '' })
    expect(
      filterCards([noSet], makeFilters({ setCodes: ['mkm'], setCodeMode: 'exclude' })),
    ).toHaveLength(1)
  })

  test('card type filter (include) keeps cards with any selected type or subtype', () => {
    const robot = makeCard({ name: 'Robot', type: 'Artifact Creature — Robot' })
    const elf = makeCard({ name: 'Elf', type: 'Creature — Elf Druid' })
    const land = makeCard({ name: 'Land', type: 'Basic Land — Forest' })
    const result = filterCards(
      [robot, elf, land],
      makeFilters({ cardTypes: ['artifact', 'elf'], cardTypeMode: 'include' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Robot', 'Elf'])
  })

  test('card type filter (exact) requires every selected type', () => {
    const artifactCreature = makeCard({ name: 'Robot', type: 'Artifact Creature — Robot' })
    const plainCreature = makeCard({ name: 'Elf', type: 'Creature — Elf' })
    const result = filterCards(
      [artifactCreature, plainCreature],
      makeFilters({ cardTypes: ['artifact', 'creature'], cardTypeMode: 'exact' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Robot'])
  })

  test('card type filter (exclude) drops matching cards and keeps the rest', () => {
    const creature = makeCard({ name: 'Elf', type: 'Creature — Elf' })
    const artifact = makeCard({ name: 'Rock', type: 'Artifact' })
    const result = filterCards(
      [creature, artifact],
      makeFilters({ cardTypes: ['creature'], cardTypeMode: 'exclude' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Rock'])
  })

  test('oracle tag filter (include) keeps cards with any selected tag', () => {
    const ramp = makeCard({ name: 'Ramp', oracleTags: ['mana-rock', 'ramp'] })
    const draw = makeCard({ name: 'Draw', oracleTags: ['card-draw'] })
    const none = makeCard({ name: 'None', oracleTags: [] })
    const result = filterCards(
      [ramp, draw, none],
      makeFilters({ oracleTags: ['ramp', 'flying'], oracleTagMode: 'include' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Ramp'])
  })

  test('oracle tag filter (exact) requires every selected tag', () => {
    const both = makeCard({ name: 'Both', oracleTags: ['ramp', 'artifact'] })
    const one = makeCard({ name: 'One', oracleTags: ['ramp'] })
    const result = filterCards(
      [both, one],
      makeFilters({ oracleTags: ['ramp', 'artifact'], oracleTagMode: 'exact' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Both'])
  })

  test('oracle tag filter (exclude) drops matching cards and keeps untagged ones', () => {
    const ramp = makeCard({ name: 'Ramp', oracleTags: ['ramp'] })
    const none = makeCard({ name: 'None', oracleTags: [] })
    const result = filterCards(
      [ramp, none],
      makeFilters({ oracleTags: ['ramp'], oracleTagMode: 'exclude' }),
    )
    expect(result.map((c) => c.name)).toEqual(['None'])
  })

  test('art tag filter matches a printing’s art tags independently of oracle tags', () => {
    const dragon = makeCard({ name: 'Dragon', oracleTags: ['flying'], artTags: ['dragon', 'fire'] })
    const plains = makeCard({ name: 'Plains', oracleTags: ['flying'], artTags: ['mountains'] })
    const result = filterCards([dragon, plains], makeFilters({ artTags: ['dragon'] }))
    expect(result.map((c) => c.name)).toEqual(['Dragon'])
  })

  test('oracle and art tag filters combine independently', () => {
    const match = makeCard({ name: 'Match', oracleTags: ['ramp'], artTags: ['dragon'] })
    const wrongArt = makeCard({ name: 'WrongArt', oracleTags: ['ramp'], artTags: ['forest'] })
    const result = filterCards(
      [match, wrongArt],
      makeFilters({ oracleTags: ['ramp'], artTags: ['dragon'] }),
    )
    expect(result.map((c) => c.name)).toEqual(['Match'])
  })

  // Distinct modes on the two tag filters, so swapping the mode fields between the
  // oracle and art `matchesTags` calls would change the result rather than pass.
  test('the oracle and art tag filters apply their own modes, not each other’s', () => {
    const cards = [
      makeCard({ name: 'Both', oracleTags: ['ramp', 'removal'], artTags: ['dragon'] }),
      makeCard({ name: 'OneTag', oracleTags: ['ramp'], artTags: ['dragon'] }),
      makeCard({ name: 'BadArt', oracleTags: ['ramp', 'removal'], artTags: ['forest'] }),
    ]
    const result = filterCards(
      cards,
      makeFilters({
        // 'exact' needs both oracle tags; 'include' needs only one of the art tags.
        oracleTags: ['ramp', 'removal'],
        oracleTagMode: 'exact',
        artTags: ['dragon', 'zombie'],
        artTagMode: 'include',
      }),
    )
    expect(result.map((c) => c.name)).toEqual(['Both'])
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

  test.each([
    ['<' as const, ['0.50', '2.00']],
    ['<=' as const, ['0.50', '2.00', '5.00']],
    ['>' as const, ['10.00', '25.00']],
    ['>=' as const, ['5.00', '10.00', '25.00']],
    ['=' as const, ['5.00']],
  ])('price comparator %s 5 keeps the expected cards (active currency)', (op, expected) => {
    const cards = [0.5, 2, 5, 10, 25].map((price) => makeCard({ name: price.toFixed(2), price }))
    const result = filterCards(cards, makeFilters({ price: 5, priceOp: op }))
    expect(result.map((c) => c.name)).toEqual(expected)
  })

  test('price filter never matches cards with no price data, even for < or =', () => {
    const unpriced = makeCard({ name: 'Unpriced', price: 0 })
    const cheap = makeCard({ name: 'Cheap', price: 1 })
    expect(
      filterCards([unpriced, cheap], makeFilters({ price: 5, priceOp: '<' })).map((c) => c.name),
    ).toEqual(['Cheap'])
    expect(filterCards([unpriced], makeFilters({ price: 0, priceOp: '=' }))).toHaveLength(0)
  })

  test('price filter compares decimal thresholds', () => {
    const cards = [makeCard({ name: 'A', price: 0.24 }), makeCard({ name: 'B', price: 0.26 })]
    expect(
      filterCards(cards, makeFilters({ price: 0.25, priceOp: '<' })).map((c) => c.name),
    ).toEqual(['A'])
  })

  test('copies filter compares total quantity summed across every entry sharing the name', () => {
    const boltA = makeCard({ name: 'Lightning Bolt', setCode: 'lea', quantity: 1 })
    const boltB = makeCard({ name: 'Lightning Bolt', setCode: 'm10', quantity: 1 })
    const forest = makeCard({ name: 'Forest', quantity: 1 })
    const cards = [boltA, boltB, forest]

    // Both Bolt entries share a total of 2 copies; Forest is a true one-of.
    expect(
      filterCards(cards, makeFilters({ copies: 1, copiesOp: '=' })).map((c) => c.name),
    ).toEqual(['Forest'])
    expect(
      filterCards(cards, makeFilters({ copies: 1, copiesOp: '>=' })).map((c) => c.name),
    ).toEqual(['Lightning Bolt', 'Lightning Bolt', 'Forest'])
    expect(
      filterCards(cards, makeFilters({ copies: 2, copiesOp: '=' })).map((c) => c.name),
    ).toEqual(['Lightning Bolt', 'Lightning Bolt'])
  })

  test('copies filter matching is case-insensitive and quantities on a single line count too', () => {
    const stacked = makeCard({ name: 'Sol Ring', quantity: 2 })
    const otherPrinting = makeCard({ name: 'sol ring', quantity: 1 })
    expect(
      filterCards([stacked, otherPrinting], makeFilters({ copies: 3, copiesOp: '=' })).map(
        (c) => c.quantity,
      ),
    ).toEqual([2, 1])
  })

  test('copies filter groups a double-faced printing with its single-sided counterpart by front face', () => {
    // A double-faced "Steam Vents // Steam Vents" is the same card as a
    // single-sided "Steam Vents" printing — both should count toward the same total.
    const dfc = makeCard({ name: 'Steam Vents // Steam Vents', quantity: 1 })
    const singleSided = makeCard({ name: 'Steam Vents', quantity: 1 })
    const unrelated = makeCard({ name: 'Forest', quantity: 1 })
    const result = filterCards(
      [dfc, singleSided, unrelated],
      makeFilters({ copies: 2, copiesOp: '=' }),
    )
    expect(result.map((c) => c.name)).toEqual(['Steam Vents // Steam Vents', 'Steam Vents'])
  })

  describe('copies match modes', () => {
    /** A Bolt tile on one printing, with an optional stated finish. */
    function bolt(set: string, collectorNumber: string, finish?: Finish): CardData {
      return makeCard({
        name: 'Lightning Bolt',
        setCode: set,
        finish,
        card: makeScryfallCard({
          name: 'Lightning Bolt',
          set,
          collector_number: collectorNumber,
          finishes: ['nonfoil', 'foil'],
        }),
      })
    }

    // Five one-of Bolts: two of the same printing (one of each finish), one of a
    // different collector number in the same set, and two more sharing a set with
    // neither. m10:161 repeats lea:161's collector number under a different set,
    // so a key that dropped the set code would over-count it.
    const leaFoil = bolt('lea', '161', 'foil')
    const leaNonfoil = bolt('lea', '161', 'nonfoil')
    const leaOther = bolt('lea', '162', 'nonfoil')
    const m10 = bolt('m10', '146', 'nonfoil')
    const m10Clash = bolt('m10', '161', 'nonfoil')
    const cards = [leaFoil, leaNonfoil, leaOther, m10, m10Clash]

    function matching(mode: CopiesMatchMode, copies: number): CardData[] {
      return filterCards(cards, makeFilters({ copies, copiesOp: '=', copiesMode: mode }))
    }

    test("'name' counts every printing and finish of the name together", () => {
      expect(matching('name', 5)).toEqual(cards)
    })

    test("'printing' counts one set code and collector number, across finishes", () => {
      expect(matching('printing', 2)).toEqual([leaFoil, leaNonfoil])
      expect(matching('printing', 1)).toEqual([leaOther, m10, m10Clash])
    })

    test("'finish' counts one printing in one finish", () => {
      expect(matching('finish', 1)).toEqual(cards)
      expect(matching('finish', 2)).toEqual([])
    })

    test("'printing' separates language variants of one set:cn, folding en", () => {
      // Two English copies (one with no language field, one explicit 'en' — the
      // same thing) and one Japanese copy of the same printing: the ja copy must
      // not add into the English total. The language comes from the ENTRY, not
      // the resolved card — all three resolve to the same default (English)
      // Scryfall object, exactly what a default_cards cache bakes for a [ja]
      // line.
      const bare = bolt('lea', '161', 'nonfoil')
      const explicitEn = makeCard({
        name: 'Lightning Bolt',
        setCode: 'lea',
        finish: 'nonfoil',
        language: 'en',
        card: makeScryfallCard({
          name: 'Lightning Bolt',
          set: 'lea',
          collector_number: '161',
          finishes: ['nonfoil', 'foil'],
        }),
      })
      const ja = makeCard({
        name: 'Lightning Bolt',
        setCode: 'lea',
        finish: 'nonfoil',
        language: 'ja',
        card: makeScryfallCard({
          name: 'Lightning Bolt',
          set: 'lea',
          collector_number: '161',
          finishes: ['nonfoil', 'foil'],
        }),
      })
      const trio = [bare, explicitEn, ja]
      expect(filterCards(trio, makeFilters({ copies: 2, copiesMode: 'printing' }))).toEqual([
        bare,
        explicitEn,
      ])
      expect(filterCards(trio, makeFilters({ copies: 1, copiesMode: 'printing' }))).toEqual([ja])
      // 'finish' inherits the language dimension through the same key.
      expect(filterCards(trio, makeFilters({ copies: 1, copiesMode: 'finish' }))).toEqual([ja])
    })

    test("'finish' treats an unstated finish as the printing's default finish", () => {
      // Foil-only, so the default finish is foil rather than the blanket nonfoil:
      // an entry that states 'foil' is the same copy as one that states nothing.
      const foilOnly = (finish?: Finish): CardData =>
        makeCard({
          name: 'Lightning Bolt',
          setCode: 'sld',
          finish,
          card: makeScryfallCard({ set: 'sld', collector_number: '1', finishes: ['foil'] }),
        })
      const pair = [foilOnly(), foilOnly('foil')]
      expect(filterCards(pair, makeFilters({ copies: 2, copiesMode: 'finish' }))).toEqual(pair)
    })

    test("'printing' and 'finish' still key an unpinned entry by the printing it shows", () => {
      // A deck line with no pinned set code, resolved to a printing for display:
      // the two finishes of it are separate copies under 'finish', together under 'printing'.
      const unpinned = (finish: Finish): CardData =>
        makeCard({
          name: 'Lightning Bolt',
          setCode: '',
          finish,
          card: makeScryfallCard({
            set: 'lea',
            collector_number: '161',
            finishes: ['nonfoil', 'foil'],
          }),
        })
      const pair = [unpinned('foil'), unpinned('nonfoil')]
      expect(filterCards(pair, makeFilters({ copies: 1, copiesMode: 'finish' }))).toEqual(pair)
      expect(filterCards(pair, makeFilters({ copies: 2, copiesMode: 'printing' }))).toEqual(pair)
    })

    test('tiles with no resolved printing fall back to counting by name', () => {
      // No `card`, so there is no printing to key on. Under 'exact' the two still
      // count as a pair rather than dropping out of the totals entirely.
      const unresolved = [
        makeCard({ name: 'Lightning Bolt', card: null }),
        makeCard({ name: 'Lightning Bolt', card: null }),
      ]
      expect(
        filterCards([...cards, ...unresolved], makeFilters({ copies: 2, copiesMode: 'finish' })),
      ).toEqual(unresolved)
    })

    test('the printing is taken from the resolved card, not the entry set code', () => {
      // An entry pinned to a set whose printing missed the cache and fell back to
      // another one: it counts as the printing actually shown, so it groups with
      // that printing rather than under a set/number pair that names neither.
      const missed = makeCard({
        name: 'Lightning Bolt',
        setCode: 'm10',
        finish: 'nonfoil',
        card: makeScryfallCard({ name: 'Lightning Bolt', set: 'lea', collector_number: '162' }),
      })
      expect(
        filterCards([...cards, missed], makeFilters({ copies: 2, copiesMode: 'printing' })),
      ).toEqual([leaFoil, leaNonfoil, leaOther, missed])
    })
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

  test('price 0 counts as active', () => {
    expect(countActiveFilters(makeFilters({ price: 0 }))).toBe(1)
  })

  test('copies 0 counts as active', () => {
    expect(countActiveFilters(makeFilters({ copies: 0 }))).toBe(1)
  })

  test('each filter contributes one to the count', () => {
    const filters = makeFilters({
      hideLands: true,
      hideUnpriced: true,
      hideExtras: true,
      name: 'bolt',
      colors: ['R'],
      setCodes: ['lea'],
      cardTypes: ['creature'],
      oracleTags: ['ramp'],
      artTags: ['dragon'],
      manaValue: 1,
      price: 5,
      copies: 2,
    })
    expect(countActiveFilters(filters)).toBe(12)
  })

  // Colors and colorless are one control in the UI, so they contribute one count.
  test('colorless counts as an active filter, and not twice alongside colors', () => {
    expect(countActiveFilters(makeFilters({ colorless: true }))).toBe(1)
    expect(countActiveFilters(makeFilters({ colors: ['G'], colorless: true }))).toBe(1)
  })

  test('a match mode alone does not count as active', () => {
    expect(
      countActiveFilters(
        makeFilters({
          colorMode: 'include',
          setCodeMode: 'exclude',
          cardTypeMode: 'exclude',
          oracleTagMode: 'exclude',
          artTagMode: 'include',
          copiesMode: 'finish',
        }),
      ),
    ).toBe(0)
  })

  test('a non-default comparator alone does not count as active', () => {
    expect(countActiveFilters(makeFilters({ manaValueOp: '>=' }))).toBe(0)
    expect(countActiveFilters(makeFilters({ priceOp: '>=' }))).toBe(0)
    expect(countActiveFilters(makeFilters({ copiesOp: '>=' }))).toBe(0)
  })
})

describe('countNarrowingFilters', () => {
  test('defaults count as zero', () => {
    expect(countNarrowingFilters(createDefaultCardFilters())).toBe(0)
  })

  // hideExtras is a section-level toggle deck pages apply themselves — filterCards
  // ignores it — so on its own it must not register as narrowing the result set.
  test('hideExtras alone does not count, unlike countActiveFilters', () => {
    const filters = makeFilters({ hideExtras: true })
    expect(countActiveFilters(filters)).toBe(1)
    expect(countNarrowingFilters(filters)).toBe(0)
  })

  test('hideExtras alongside a real filter only subtracts its own contribution', () => {
    const filters = makeFilters({ hideExtras: true, name: 'bolt' })
    expect(countActiveFilters(filters)).toBe(2)
    expect(countNarrowingFilters(filters)).toBe(1)
  })
})

// parseManaValueFilter and parseCopiesFilter are the same non-negative-integer
// filter parser (differing only in error message), so one table covers both.
describe.each([
  ['parseManaValueFilter', parseManaValueFilter],
  ['parseCopiesFilter', parseCopiesFilter],
])('%s', (_name, parse) => {
  test('empty input clears the filter', () => {
    expect(parse('')).toEqual({ ok: true, value: null })
    expect(parse('   ')).toEqual({ ok: true, value: null })
  })

  test('parses non-negative integers including 0', () => {
    expect(parse('0')).toEqual({ ok: true, value: 0 })
    expect(parse('12')).toEqual({ ok: true, value: 12 })
  })

  test.each(['-1', '1.5', 'abc', '1e3'])('rejects %p', (input) => {
    expect(parse(input).ok).toBe(false)
  })
})

describe('parsePriceFilter', () => {
  test('empty input clears the filter', () => {
    expect(parsePriceFilter('')).toEqual({ ok: true, value: null })
    expect(parsePriceFilter('   ')).toEqual({ ok: true, value: null })
  })

  test('parses non-negative amounts with up to two decimals', () => {
    expect(parsePriceFilter('0')).toEqual({ ok: true, value: 0 })
    expect(parsePriceFilter('5')).toEqual({ ok: true, value: 5 })
    expect(parsePriceFilter('0.25')).toEqual({ ok: true, value: 0.25 })
    expect(parsePriceFilter('12.9')).toEqual({ ok: true, value: 12.9 })
  })

  test.each(['-1', '1.234', 'abc', '1e3', '.5', '5.'])('rejects %p', (input) => {
    expect(parsePriceFilter(input).ok).toBe(false)
  })
})

// The raw amount parsers are the single source of truth for the numeric formats,
// shared by both the filter inputs above and the lenient URL-param parsers.
// parseNonNegativeInteger backs both the mana value and copies filters.
describe('parseNonNegativeInteger / parsePriceAmount', () => {
  test('parse valid tokens, tolerating surrounding whitespace', () => {
    expect(parseNonNegativeInteger(' 3 ')).toBe(3)
    expect(parseNonNegativeInteger('0')).toBe(0)
    expect(parsePriceAmount(' 5.25 ')).toBe(5.25)
    expect(parsePriceAmount('0')).toBe(0)
  })

  test('return undefined for malformed or empty tokens', () => {
    expect(parseNonNegativeInteger('')).toBeUndefined()
    expect(parseNonNegativeInteger('2.5')).toBeUndefined()
    expect(parsePriceAmount('')).toBeUndefined()
    expect(parsePriceAmount('1.234')).toBeUndefined()
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

describe('collectCardTypes', () => {
  test('returns unique lowercase type tags across all cards, sorted', () => {
    const cards = [
      makeCard({ type: 'Artifact Creature — Robot' }),
      makeCard({ type: 'Creature — Elf Druid' }),
      makeCard({ type: 'Legendary Creature — Time Lord' }),
    ]
    expect(collectCardTypes(cards)).toEqual([
      'artifact',
      'creature',
      'druid',
      'elf',
      'legendary',
      'robot',
      'time lord',
    ])
  })
})

describe('collectOracleTags', () => {
  test('returns unique oracle tag slugs across all cards, sorted', () => {
    const cards = [
      makeCard({ oracleTags: ['ramp', 'mana-rock'] }),
      makeCard({ oracleTags: ['ramp', 'card-draw'] }),
      makeCard({ oracleTags: [] }),
    ]
    expect(collectOracleTags(cards)).toEqual(['card-draw', 'mana-rock', 'ramp'])
  })
})

describe('collectArtTags', () => {
  test('returns unique art tag slugs across all cards, sorted', () => {
    const cards = [
      makeCard({ artTags: ['dragon', 'fire'] }),
      makeCard({ artTags: ['mountains', 'dragon'] }),
    ]
    expect(collectArtTags(cards)).toEqual(['dragon', 'fire', 'mountains'])
  })
})

describe('isTagFilterActive', () => {
  test('true when an oracle or art tag is selected', () => {
    expect(isTagFilterActive(makeFilters({ oracleTags: ['ramp'] }))).toBe(true)
    expect(isTagFilterActive(makeFilters({ artTags: ['dragon'] }))).toBe(true)
  })

  test('false when no tag filter is selected (other filters do not count)', () => {
    expect(isTagFilterActive(makeFilters())).toBe(false)
    expect(isTagFilterActive(makeFilters({ cardTypes: ['creature'], name: 'bolt' }))).toBe(false)
  })
})

describe('untaggedAddedCardNames', () => {
  test('returns only added cards that have no tag data', () => {
    const cards = [
      makeCard({ name: 'Tagged Added', oracleTags: ['ramp'] }),
      makeCard({ name: 'Untagged Added' }),
      makeCard({ name: 'Untagged Not Added' }),
    ]
    expect(untaggedAddedCardNames(cards, ['Tagged Added', 'Untagged Added'])).toEqual([
      'Untagged Added',
    ])
  })

  test('excludes added cards that carry tags (e.g. moved from a tagged list)', () => {
    const cards = [makeCard({ name: 'Has Art', artTags: ['dragon'] })]
    expect(untaggedAddedCardNames(cards, ['Has Art'])).toEqual([])
  })

  test('excludes added cards with oracle tags but no art tags (guards && vs ||)', () => {
    const cards = [makeCard({ name: 'Has Oracle', oracleTags: ['ramp'] })]
    expect(untaggedAddedCardNames(cards, ['Has Oracle'])).toEqual([])
  })

  test('returns names in cards-list order, not added-set order', () => {
    const cards = [makeCard({ name: 'B' }), makeCard({ name: 'A' })]
    expect(untaggedAddedCardNames(cards, ['A', 'B'])).toEqual(['B', 'A'])
  })

  test('returns empty when nothing was added this session', () => {
    expect(untaggedAddedCardNames([makeCard({ name: 'X' })], [])).toEqual([])
  })

  test('dedupes repeated card names', () => {
    const cards = [makeCard({ name: 'Dup' }), makeCard({ name: 'Dup' })]
    expect(untaggedAddedCardNames(cards, ['Dup'])).toEqual(['Dup'])
  })
})

describe('labels filter', () => {
  const sale = makeCard({ name: 'Sale Card', labels: ['sale'] })
  const saleTrade = makeCard({ name: 'Both Card', labels: ['sale', 'trade'] })
  const keep = makeCard({ name: 'Keep Card', labels: ['keep'] })
  const plain = makeCard({ name: 'Plain Card' })
  const all = [sale, saleTrade, keep, plain]

  test('inactive when no chips are selected', () => {
    expect(filterCards(all, makeFilters())).toEqual(all)
  })

  test('a single label keeps every card whose effective set includes it', () => {
    const result = filterCards(all, makeFilters({ labels: ['trade'] }))
    expect(result.map((c) => c.name)).toEqual(['Both Card'])
  })

  test('sale + trade is an OR', () => {
    const result = filterCards(all, makeFilters({ labels: ['sale', 'trade'] }))
    expect(result.map((c) => c.name)).toEqual(['Sale Card', 'Both Card'])
  })

  test('keep matches only keep-labeled cards', () => {
    const result = filterCards(all, makeFilters({ labels: ['keep'] }))
    expect(result.map((c) => c.name)).toEqual(['Keep Card'])
  })

  test('none matches only unlabeled cards', () => {
    const result = filterCards(all, makeFilters({ labels: ['none'] }))
    expect(result.map((c) => c.name)).toEqual(['Plain Card'])
  })

  test('counts as one active filter', () => {
    expect(countActiveFilters(makeFilters({ labels: ['sale', 'trade'] }))).toBe(1)
  })
})

describe('toggleLabelFilterOption', () => {
  test('sale and trade combine in canonical order', () => {
    expect(toggleLabelFilterOption([], 'trade')).toEqual(['trade'])
    expect(toggleLabelFilterOption(['trade'], 'sale')).toEqual(['sale', 'trade'])
  })

  test('re-picking a chip deselects it', () => {
    expect(toggleLabelFilterOption(['sale', 'trade'], 'sale')).toEqual(['trade'])
  })

  test('keep replaces the whole selection', () => {
    expect(toggleLabelFilterOption(['sale', 'trade'], 'keep')).toEqual(['keep'])
  })

  test('none replaces the whole selection', () => {
    expect(toggleLabelFilterOption(['sale'], 'none')).toEqual(['none'])
  })

  test('picking sale while keep is selected drops keep', () => {
    expect(toggleLabelFilterOption(['keep'], 'sale')).toEqual(['sale'])
    expect(toggleLabelFilterOption(['none'], 'trade')).toEqual(['trade'])
  })

  test('proxy replaces the whole selection and is replaced in turn', () => {
    expect(toggleLabelFilterOption(['sale', 'trade'], 'proxy')).toEqual(['proxy'])
    expect(toggleLabelFilterOption(['keep'], 'proxy')).toEqual(['proxy'])
    expect(toggleLabelFilterOption(['proxy'], 'sale')).toEqual(['sale'])
    expect(toggleLabelFilterOption(['proxy'], 'proxy')).toEqual([])
  })
})

describe('parseLabelsParam', () => {
  test('parses valid combos, deduped into canonical order', () => {
    expect(parseLabelsParam('trade,sale,trade')).toEqual(['sale', 'trade'])
    expect(parseLabelsParam('KEEP')).toEqual(['keep'])
    expect(parseLabelsParam('none')).toEqual(['none'])
  })

  test('drops junk tokens', () => {
    expect(parseLabelsParam('sale,bogus')).toEqual(['sale'])
  })

  test('trims and lowercases tokens before matching', () => {
    expect(parseLabelsParam(' Sale , TRADE ')).toEqual(['sale', 'trade'])
  })

  test('a combination the chips cannot produce invalidates the whole param', () => {
    expect(parseLabelsParam('keep,sale')).toBeUndefined()
    expect(parseLabelsParam('none,trade')).toBeUndefined()
    expect(parseLabelsParam('proxy,sale')).toBeUndefined()
    expect(parseLabelsParam('keep,proxy')).toBeUndefined()
  })

  test('proxy parses on its own', () => {
    expect(parseLabelsParam('PROXY')).toEqual(['proxy'])
  })

  test('null and empty-ish values parse to undefined', () => {
    expect(parseLabelsParam(null)).toBeUndefined()
    expect(parseLabelsParam('')).toBeUndefined()
    expect(parseLabelsParam('bogus')).toBeUndefined()
  })
})

describe('buylist filter', () => {
  const listed = makeCard({ name: 'Listed', onBuylist: true })
  const unlisted = makeCard({ name: 'Unlisted', onBuylist: false })
  const all = [listed, unlisted]

  test('inactive when no chips are selected', () => {
    expect(filterCards(all, makeFilters())).toEqual(all)
  })

  test.each([
    ['on' as const, ['Listed']],
    ['off' as const, ['Unlisted']],
  ])('%s keeps only the matching cards', (option, expected) => {
    const result = filterCards(all, makeFilters({ onBuylist: [option] }))
    expect(result.map((c) => c.name)).toEqual(expected)
  })

  test('both chips match everything, since together they cover every card', () => {
    expect(filterCards(all, makeFilters({ onBuylist: ['on', 'off'] }))).toEqual(all)
  })

  test('counts as one active filter', () => {
    expect(countActiveFilters(makeFilters({ onBuylist: ['on'] }))).toBe(1)
  })
})

describe('toggleBuylistFilterOption', () => {
  test('the two chips combine, in canonical order', () => {
    expect(toggleBuylistFilterOption(['off'], 'on')).toEqual(['on', 'off'])
  })

  test('re-picking a chip clears it', () => {
    expect(toggleBuylistFilterOption(['on', 'off'], 'on')).toEqual(['off'])
  })
})

describe('parseBuylistParam', () => {
  test.each([
    [null, undefined],
    ['', undefined],
    ['nonsense', undefined],
    ['off,on', ['on', 'off']],
    ['ON , off', ['on', 'off']],
    ['on,on', ['on']],
  ])('parses %p', (input, expected) => {
    expect(parseBuylistParam(input)).toEqual(expected as never)
  })
})

describe('buylist price filter', () => {
  const cheap = makeCard({ name: 'Cheap', buylistPrice: 0.5, onBuylist: true })
  const dear = makeCard({ name: 'Dear', buylistPrice: 8, onBuylist: true })
  // `onBuylist` is true exactly when `buylistPrice > 0`, so a card with no
  // active offer is off the buylist by construction.
  const noOffer = makeCard({ name: 'No Offer', buylistPrice: 0, onBuylist: false })
  const all = [cheap, dear, noOffer]

  test('inactive when null', () => {
    expect(filterCards(all, makeFilters())).toEqual(all)
  })

  test('compares the buyer’s per-copy offer', () => {
    const result = filterCards(all, makeFilters({ buylistPrice: 1, buylistPriceOp: '>=' }))
    expect(result.map((c) => c.name)).toEqual(['Dear'])
  })

  test('a card with no active offer never matches, whatever the comparator', () => {
    // Mirrors the retail price filter: 0 is "no price", not a price of zero, so
    // even `<= 5` must not sweep unsellable cards in.
    const result = filterCards(all, makeFilters({ buylistPrice: 5, buylistPriceOp: '<=' }))
    expect(result.map((c) => c.name)).toEqual(['Cheap'])
  })

  test('counts as one active filter, independently of the chips', () => {
    expect(countActiveFilters(makeFilters({ buylistPrice: 1 }))).toBe(1)
    expect(countActiveFilters(makeFilters({ buylistPrice: 1, onBuylist: ['on'] }))).toBe(2)
    // A comparator with no threshold is inert, like the other numeric filters.
    expect(countActiveFilters(makeFilters({ buylistPriceOp: '>=' }))).toBe(0)
  })
})
