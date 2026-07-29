import { describe, expect, test } from 'bun:test'
import {
  filterCardIndex,
  parseCardIndexFilters,
  type CardIndexFilters,
} from '../../../src/admin/api/card-index'
import type { MovePhysicalCard } from '../../../src/admin/api/move'

/**
 * `GET /api/card-index`'s filter parsing and matching. Both halves are pure, so
 * the semantics (term matching for names, lowercase set codes, exact slugs) are
 * pinned here rather than through the handler.
 */

function card(overrides: Partial<MovePhysicalCard>): MovePhysicalCard {
  return {
    key: 'collection:binder:1:0',
    listType: 'collection',
    listSlug: 'binder',
    name: 'Sol Ring',
    ...overrides,
  }
}

const INDEX: MovePhysicalCard[] = [
  card({ key: 'a', name: 'In the Trenches', set: 'lea' }),
  card({ key: 'b', name: 'Arctic Treeline', set: 'khm' }),
  card({ key: 'c', name: "Jace's Archivist", listType: 'deck', listSlug: 'my-deck', set: 'lea' }),
  card({ key: 'd', name: 'Sol Ring', listType: 'wanted', listSlug: 'needs' }),
]

function names(filters: CardIndexFilters): string[] {
  return filterCardIndex(INDEX, filters).map((c) => c.name)
}

describe('parseCardIndexFilters', () => {
  test('an empty query string filters nothing', () => {
    expect(parseCardIndexFilters(new URLSearchParams(''))).toEqual({})
  })

  test('blank values are treated as absent, not as "match nothing"', () => {
    expect(parseCardIndexFilters(new URLSearchParams('name=%20&set=%20&slug=%20'))).toEqual({})
  })

  test('a name becomes its search terms', () => {
    expect(parseCardIndexFilters(new URLSearchParams('name=in%20tre'))).toEqual({
      nameTerms: ['in', 'tre'],
    })
  })

  test('a set code is normalized to the internal lowercase representation', () => {
    expect(parseCardIndexFilters(new URLSearchParams('set=LEA'))).toEqual({ set: 'lea' })
  })

  test('an unknown list type is refused', () => {
    expect(parseCardIndexFilters(new URLSearchParams('listType=binder'))).toBe(
      "Invalid list type 'binder'. Use one of: deck, collection, wanted.",
    )
  })

  test('a slug carrying a path separator is refused', () => {
    expect(parseCardIndexFilters(new URLSearchParams('slug=..%2Fetc'))).toBe(
      "Invalid list slug '../etc'.",
    )
  })
})

describe('filterCardIndex', () => {
  test('no filters returns the whole index', () => {
    expect(filterCardIndex(INDEX, {})).toHaveLength(4)
  })

  test('name terms match the way autocomplete matches, not by raw substring', () => {
    // No name contains "in tre" contiguously; both of these match term-by-term.
    expect(names({ nameTerms: ['in', 'tre'] })).toEqual(['In the Trenches', 'Arctic Treeline'])
  })

  test('name matching ignores punctuation', () => {
    expect(names({ nameTerms: ['jaces'] })).toEqual(["Jace's Archivist"])
  })

  test('a set filter compares lowercase on both sides', () => {
    expect(names({ set: 'lea' })).toEqual(['In the Trenches', "Jace's Archivist"])
  })

  test('a slug filter is an exact match', () => {
    expect(names({ slug: 'my-deck' })).toEqual(["Jace's Archivist"])
  })

  test('filters intersect rather than union', () => {
    expect(names({ set: 'lea', listType: 'deck' })).toEqual(["Jace's Archivist"])
  })
})
