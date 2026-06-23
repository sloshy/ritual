import { describe, expect, it } from 'bun:test'
import {
  matchList,
  listTypeFromFlags,
  formatResolveListError,
  isResolveListError,
  type ListLocation,
  type ResolveListError,
} from '../../src/resolve-list'

function loc(type: ListLocation['type'], name: string): ListLocation {
  return { type, name, filePath: `/${type}/${name}.md` }
}

describe('matchList', () => {
  it('reports no-lists when there are no candidates', () => {
    const result = matchList([], 'anything')
    expect(result).toEqual({ kind: 'no-lists', type: undefined })
  })

  it('carries the searched type into the no-lists error', () => {
    expect(matchList([], 'anything', 'collection')).toEqual({
      kind: 'no-lists',
      type: 'collection',
    })
  })

  it('matches a name case-insensitively', () => {
    const goblins = loc('deck', 'Goblins')
    expect(matchList([goblins, loc('deck', 'Elves')], 'goblins')).toBe(goblins)
    expect(matchList([goblins, loc('deck', 'Elves')], 'GOBLINS')).toBe(goblins)
  })

  it('ignores a trailing .md in the query', () => {
    const goblins = loc('deck', 'Goblins')
    expect(matchList([goblins], 'Goblins.md')).toBe(goblins)
  })

  it('matches a name diacritic-insensitively in both directions', () => {
    const accented = loc('deck', 'Café Standard')
    // Plain query exactly matches an accented list name (exact-match tier).
    expect(matchList([accented], 'cafe standard')).toBe(accented)
    // Accented query exactly matches a plain list name (exact-match tier).
    const plain = loc('deck', 'Cafe Standard')
    expect(matchList([plain], 'Café Standard')).toBe(plain)
  })

  it('prefers an exact match over a substring match', () => {
    const burn = loc('deck', 'Burn')
    const burnIncremental = loc('deck', 'Burn Incremental')
    // "Burn" is a substring of both, but exactly equals one — the exact wins.
    expect(matchList([burn, burnIncremental], 'Burn')).toBe(burn)
  })

  it('falls back to a unique substring match when no exact match exists', () => {
    const burn = loc('deck', 'Mono Red Burn')
    expect(matchList([burn, loc('deck', 'Elves')], 'burn')).toBe(burn)
  })

  it('is ambiguous when an exact name exists in multiple types', () => {
    const deck = loc('deck', 'Staples')
    const collection = loc('collection', 'Staples')
    const result = matchList([deck, collection], 'staples')
    expect(isResolveListError(result)).toBe(true)
    expect(result).toEqual({ kind: 'ambiguous', query: 'staples', matches: [deck, collection] })
  })

  it('is ambiguous when multiple substrings match and none is exact', () => {
    const a = loc('deck', 'Goblin Aggro')
    const b = loc('deck', 'Goblin Combo')
    const result = matchList([a, b], 'goblin')
    expect(result).toEqual({ kind: 'ambiguous', query: 'goblin', matches: [a, b] })
  })

  it('does not treat a substring collision as ambiguous when one candidate matches exactly', () => {
    const exact = loc('deck', 'Goblin')
    const longer = loc('deck', 'Goblin Combo')
    expect(matchList([exact, longer], 'Goblin')).toBe(exact)
  })

  it('reports not-found when nothing matches', () => {
    const result = matchList([loc('deck', 'Elves')], 'dragons', 'deck')
    expect(result).toEqual({ kind: 'not-found', query: 'dragons', type: 'deck' })
  })

  it('reports not-found with no type when searching across all types', () => {
    const result = matchList([loc('deck', 'Elves'), loc('collection', 'Staples')], 'dragons')
    expect(result).toEqual({ kind: 'not-found', query: 'dragons', type: undefined })
  })
})

describe('listTypeFromFlags', () => {
  it('returns undefined when no flag is set', () => {
    expect(listTypeFromFlags({})).toBeUndefined()
  })

  it('returns the single selected type', () => {
    expect(listTypeFromFlags({ deck: true })).toBe('deck')
    expect(listTypeFromFlags({ collection: true })).toBe('collection')
    expect(listTypeFromFlags({ wanted: true })).toBe('wanted')
  })

  it('returns conflict when more than one flag is set', () => {
    expect(listTypeFromFlags({ deck: true, wanted: true })).toBe('conflict')
  })
})

describe('formatResolveListError', () => {
  it('formats no-lists with and without a type', () => {
    expect(formatResolveListError({ kind: 'no-lists' })).toBe(
      'No decks, collections, or wanted lists found.',
    )
    expect(formatResolveListError({ kind: 'no-lists', type: 'wanted' })).toBe(
      'No wanted lists found.',
    )
  })

  it('formats not-found with the query name', () => {
    const err: ResolveListError = { kind: 'not-found', query: 'Goblins', type: 'deck' }
    expect(formatResolveListError(err)).toBe("No deck named 'Goblins' found.")
  })

  it('lists every match and suggests the disambiguating flags for ambiguity', () => {
    const err: ResolveListError = {
      kind: 'ambiguous',
      query: 'Staples',
      matches: [loc('deck', 'Staples'), loc('collection', 'Staples')],
    }
    const message = formatResolveListError(err)
    expect(message).toContain('Deck: Staples')
    expect(message).toContain('Collection: Staples')
    expect(message).toContain('--deck, --collection, or --wanted')
  })
})
