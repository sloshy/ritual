import { describe, expect, test } from 'bun:test'
import {
  countDeck,
  countEntries,
  filterDeck,
  filterEntries,
  isNarrowedLoad,
  parseListLoadParams,
  toCountParams,
  type ListLoadParams,
} from '../../../src/admin/api/list-load-params'
import type { DeckData } from '../../../src/types'

/**
 * The list load routes' query parameters and the filtering they drive. Pure, so
 * pinned here rather than through the three handlers; the handler tests only
 * prove that a view actually short-circuits the expensive card-data load.
 */

function parse(query: string): ReturnType<typeof parseListLoadParams> {
  return parseListLoadParams(new URLSearchParams(query))
}

/** Params with everything defaulted, so a test only states what it varies. */
function params(overrides: Partial<ListLoadParams> = {}): ListLoadParams {
  return { view: 'cards', offset: 0, ...overrides }
}

const DECK: DeckData = {
  name: 'Burn',
  sections: [
    {
      name: 'Main',
      cards: [
        { name: 'Lightning Bolt', quantity: 4 },
        { name: 'Lava Spike', quantity: 3 },
        { name: 'Goblin Guide', quantity: 4 },
      ],
    },
    {
      name: 'Sideboard',
      cards: [
        { name: 'Smash to Smithereens', quantity: 2 },
        { name: 'Lightning Helix', quantity: 1 },
      ],
    },
  ],
}

type FlatEntry = { name: string; section?: string }

// "Zany Artifacts" first, so first-appearance order is not also alphabetical —
// otherwise the section-order assertion below would pass either way.
const ENTRIES: FlatEntry[] = [
  { name: 'Sol Ring', section: 'Zany Artifacts' },
  { name: 'Arcane Signet', section: 'Zany Artifacts' },
  { name: 'Lightning Bolt', section: 'Burn' },
  { name: 'Lightning Helix' },
]

describe('parseListLoadParams', () => {
  test('an empty query is the full view with no filters', () => {
    expect(parse('')).toEqual({ view: 'full', offset: 0 })
  })

  test.each(['full', 'cards', 'summary'] as const)('accepts view=%s', (view) => {
    expect(parse(`view=${view}`)).toEqual({ view, offset: 0 })
  })

  test('an unknown view is refused, naming the choices', () => {
    expect(parse('view=everything')).toBe(
      "Invalid view 'everything'. Use one of: full, cards, summary.",
    )
  })

  test('blank filters read as absent rather than as "match nothing"', () => {
    const parsed = parse('section=%20&nameContains=%20&limit=&offset=')
    expect(parsed).toEqual({ view: 'full', offset: 0 })
  })

  test('section is taken verbatim — it is a markdown heading', () => {
    expect(parse('section=Sideboard')).toEqual({ view: 'full', offset: 0, section: 'Sideboard' })
  })

  test('nameContains splits into terms the way autocomplete does', () => {
    expect(parse('nameContains=lightning%20bolt')).toEqual({
      view: 'full',
      offset: 0,
      nameTerms: ['lightning', 'bolt'],
    })
  })

  test('limit must be a positive integer', () => {
    expect(parse('limit=5')).toEqual({ view: 'full', offset: 0, limit: 5 })
    expect(parse('limit=0')).toBe("Invalid limit '0'. Use a positive integer.")
    expect(parse('limit=-1')).toBe("Invalid limit '-1'. Use a positive integer.")
    expect(parse('limit=1.5')).toBe("Invalid limit '1.5'. Use a positive integer.")
  })

  test('offset accepts 0 — the ordinary "start at the beginning" value', () => {
    expect(parse('offset=0')).toEqual({ view: 'full', offset: 0 })
    expect(parse('offset=7')).toEqual({ view: 'full', offset: 7 })
    expect(parse('offset=-1')).toBe("Invalid offset '-1'. Use a non-negative integer.")
    expect(parse('offset=01')).toBe("Invalid offset '01'. Use a non-negative integer.")
  })
})

describe('filterDeck', () => {
  test('an unfiltered deck comes back whole, with every line counted', () => {
    const { deck, totalCount } = filterDeck(DECK, params())
    expect(deck.sections.map((s) => s.cards.length)).toEqual([3, 2])
    expect(totalCount).toBe(5)
  })

  test('section is exact, and a section that does not exist matches nothing', () => {
    expect(filterDeck(DECK, params({ section: 'Sideboard' })).deck.sections).toHaveLength(1)
    const missing = filterDeck(DECK, params({ section: 'sideboard' }))
    expect(missing.deck.sections).toEqual([])
    expect(missing.totalCount).toBe(0)
  })

  test('name terms match across sections', () => {
    const { deck, totalCount } = filterDeck(DECK, params({ nameTerms: ['lightning'] }))
    expect(totalCount).toBe(2)
    expect(deck.sections.map((s) => s.name)).toEqual(['Main', 'Sideboard'])
    expect(deck.sections.flatMap((s) => s.cards.map((c) => c.name))).toEqual([
      'Lightning Bolt',
      'Lightning Helix',
    ])
  })

  test('a section left with no matching lines is dropped, not returned empty', () => {
    // Deliberate: the result should read like a small deck, not like a deck of
    // empty sections a client then has to filter out itself.
    const { deck } = filterDeck(DECK, params({ nameTerms: ['spike'] }))
    expect(deck.sections.map((s) => s.name)).toEqual(['Main'])
  })

  test('offset and limit page lines across sections in order', () => {
    const { deck, totalCount } = filterDeck(DECK, params({ offset: 2, limit: 2 }))
    expect(totalCount).toBe(5)
    expect(deck.sections.flatMap((s) => s.cards.map((c) => c.name))).toEqual([
      'Goblin Guide',
      'Smash to Smithereens',
    ])
  })

  test('a limit never splits a line — quantity travels whole', () => {
    const { deck } = filterDeck(DECK, params({ limit: 1 }))
    expect(deck.sections[0]?.cards[0]?.quantity).toBe(4)
  })

  test('totalCount reports matches before paging, not after', () => {
    expect(filterDeck(DECK, params({ nameTerms: ['lightning'], limit: 1 })).totalCount).toBe(2)
  })

  test('the source deck is not mutated', () => {
    filterDeck(DECK, params({ section: 'Main', limit: 1 }))
    expect(DECK.sections).toHaveLength(2)
    expect(DECK.sections[0]?.cards).toHaveLength(3)
  })
})

describe('filterEntries', () => {
  const nameOf = (entry: FlatEntry): string => entry.name
  const sectionOf = (entry: FlatEntry): string | undefined => entry.section

  test('filters by section, defaulting a section-less entry to Main', () => {
    expect(
      filterEntries(ENTRIES, params({ section: 'Zany Artifacts' }), nameOf, sectionOf).entries,
    ).toHaveLength(2)
    expect(
      filterEntries(ENTRIES, params({ section: 'Main' }), nameOf, sectionOf).entries.map(nameOf),
    ).toEqual(['Lightning Helix'])
  })

  test('filters by name terms and pages the survivors', () => {
    const filtered = filterEntries(
      ENTRIES,
      params({ nameTerms: ['lightning'], limit: 1 }),
      nameOf,
      sectionOf,
    )
    expect(filtered.entries.map(nameOf)).toEqual(['Lightning Bolt'])
    expect(filtered.totalCount).toBe(2)
  })
})

describe('isNarrowedLoad', () => {
  test('an unfiltered, unpaged request is not narrowed', () => {
    expect(isNarrowedLoad(params())).toBeFalse()
  })

  test.each([
    ['a section filter', { section: 'Main' }],
    ['a name filter', { nameTerms: ['bolt'] }],
    ['a limit', { limit: 5 }],
    ['an offset', { offset: 1 }],
  ])('%s narrows the request', (_label, overrides: Partial<ListLoadParams>) => {
    expect(isNarrowedLoad(params(overrides))).toBeTrue()
  })
})

describe('toCountParams', () => {
  test('drops paging and keeps the filters', () => {
    expect(
      toCountParams(params({ section: 'Main', nameTerms: ['bolt'], limit: 5, offset: 10 })),
    ).toEqual({ view: 'cards', offset: 0, section: 'Main', nameTerms: ['bolt'] })
  })

  test('counting a paged request counts the whole filtered set', () => {
    const paged = params({ nameTerms: ['lightning'], limit: 1 })
    expect(filterDeck(DECK, paged).deck.sections.flatMap((s) => s.cards)).toHaveLength(1)
    expect(
      filterDeck(DECK, toCountParams(paged)).deck.sections.flatMap((s) => s.cards),
    ).toHaveLength(2)
  })
})

describe('countDeck / countEntries', () => {
  test('countDeck reports lines, copies, and the per-section breakdown', () => {
    expect(countDeck(DECK)).toEqual({
      entryCount: 5,
      cardCount: 14,
      sections: [
        { name: 'Main', entryCount: 3, cardCount: 11 },
        { name: 'Sideboard', entryCount: 2, cardCount: 3 },
      ],
    })
  })

  test('countEntries treats one line as one card, in first-appearance order', () => {
    expect(countEntries(ENTRIES, (entry) => entry.section)).toEqual({
      entryCount: 4,
      cardCount: 4,
      sections: [
        { name: 'Zany Artifacts', entryCount: 2, cardCount: 2 },
        { name: 'Burn', entryCount: 1, cardCount: 1 },
        { name: 'Main', entryCount: 1, cardCount: 1 },
      ],
    })
  })
})
