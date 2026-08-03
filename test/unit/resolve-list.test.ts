import { describe, expect, it } from 'bun:test'
import {
  matchList,
  listTypeFromFlags,
  formatResolveListError,
  isListArgumentConflict,
  isResolveListError,
  normalizeListName,
  parseListArgument,
  resolveListArgument,
  RESOLVE_HINTS,
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

  it('folds hyphens and underscores to spaces, in both directions', () => {
    // A list file is named as its list is named, but a name may be typed the way
    // it reads — and a file left over from when deck files were kebab-cased must
    // still be found by its display name.
    const spaced = loc('deck', 'Winota Stax')
    expect(matchList([spaced], 'winota-stax')).toBe(spaced)
    expect(matchList([spaced], 'winota_stax')).toBe(spaced)

    const kebab = loc('deck', 'black-panther')
    expect(matchList([kebab], 'Black Panther')).toBe(kebab)
  })

  it('takes a byte-exact name over a folded collision', () => {
    // The trap this tier exists for: two decks that fold to the same name. Each
    // is still addressable by its own exact spelling.
    const titled = loc('deck', 'Atraxa Superfriends')
    const lower = loc('deck', 'atraxa superfriends')
    expect(matchList([titled, lower], 'Atraxa Superfriends')).toBe(titled)
    expect(matchList([titled, lower], 'atraxa superfriends')).toBe(lower)
    // Anything that is neither spelling stays ambiguous.
    expect(isResolveListError(matchList([titled, lower], 'ATRAXA SUPERFRIENDS'))).toBe(true)
  })

  it('applies the byte-exact tier after the .md/whitespace clean-up only', () => {
    const exact = loc('deck', 'Burn')
    const folded = loc('deck', 'burn')
    expect(matchList([exact, folded], '  Burn.md  ')).toBe(exact)
  })

  it('lets a byte-exact match beat a folded-exact match on another list', () => {
    const kebab = loc('deck', 'mono-red')
    const spaced = loc('deck', 'Mono Red')
    expect(matchList([kebab, spaced], 'mono-red')).toBe(kebab)
  })

  it('lets a byte-exact match win over candidates it is a substring of', () => {
    // Discriminating: `Burn` and `burn` fold together, so without the byte-exact
    // tier this is ambiguous rather than a hit.
    const short = loc('deck', 'Burn')
    const lower = loc('deck', 'burn')
    const longer = loc('deck', 'Burn Incremental')
    expect(matchList([short, lower, longer], 'Burn')).toBe(short)
  })

  it('is ambiguous when byte-identical names exist in two types', () => {
    const deck = loc('deck', 'Staples')
    const collection = loc('collection', 'Staples')
    expect(matchList([deck, collection], 'Staples')).toEqual({
      kind: 'ambiguous',
      query: 'Staples',
      matches: [deck, collection],
    })
  })

  it('resolves a display name whose filename-illegal punctuation was stripped', () => {
    // `new deck "Atraxa: Praetors' Voice"` writes this file; the name the user
    // typed has to find it again.
    const list = loc('deck', "Atraxa Praetors' Voice")
    expect(matchList([list], "Atraxa: Praetors' Voice")).toBe(list)
    expect(matchList([list], 'Atraxa Praetors Voice')).toBe(list)
    expect(matchList([list], "atraxa: praetors' voice")).toBe(list)
  })

  it('reports a hyphen/space collision as ambiguous rather than guessing', () => {
    const spaced = loc('deck', 'Mono Red')
    const kebab = loc('deck', 'mono-red')
    const result = matchList([spaced, kebab], 'mono red')
    expect(isResolveListError(result) && result.kind).toBe('ambiguous')
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
  function ambiguous(query: string, matches: ListLocation[]): ResolveListError {
    return { kind: 'ambiguous', query, matches }
  }

  it('formats no-lists with and without a type', () => {
    expect(formatResolveListError({ kind: 'no-lists' }, 'type-flags')).toBe(
      'No decks, collections, or wanted lists found.',
    )
    expect(formatResolveListError({ kind: 'no-lists', type: 'wanted' }, 'type-flags')).toBe(
      'No wanted lists found.',
    )
  })

  it('formats not-found with the query name', () => {
    const err: ResolveListError = { kind: 'not-found', query: 'Goblins', type: 'deck' }
    expect(formatResolveListError(err, 'type-flags')).toBe("No deck named 'Goblins' found.")
  })

  it('names all three types in a not-found from an untyped search', () => {
    const err: ResolveListError = { kind: 'not-found', query: 'Goblins' }
    expect(formatResolveListError(err, 'type-flags')).toBe(
      "No deck, collection, or wanted list named 'Goblins' found.",
    )
  })

  it('lists every match and suggests the type flags for cross-type ambiguity', () => {
    const err = ambiguous('Staples', [loc('deck', 'Staples'), loc('collection', 'Staples')])
    const message = formatResolveListError(err, 'type-flags')
    expect(message).toContain('Deck: Staples')
    expect(message).toContain('Collection: Staples')
    expect(message).toEndWith('Disambiguate with --deck, --collection, or --wanted.')
  })

  it('advises typing more of the name when every match shares a type', () => {
    const err = ambiguous('bur', [loc('deck', 'burn'), loc('deck', 'burn-red')])
    for (const hint of RESOLVE_HINTS) {
      const message = formatResolveListError(err, hint)
      expect(message).toEndWith("Type more of the name to narrow the match (e.g. 'burn').")
      expect(message).not.toContain('--deck')
      expect(message).not.toContain('type prefix')
      expect(message).not.toContain("Set the list's type")
    }
  })

  it('advises typing more of the name for cross-type ambiguity with no type selector', () => {
    const err = ambiguous('Staple', [loc('deck', 'Staples'), loc('collection', 'Staple Binder')])
    const message = formatResolveListError(err, 'none')
    expect(message).toEndWith("Type more of the name to narrow the match (e.g. 'Staples').")
  })

  it('suggests one type prefix per type, only for types with a single match', () => {
    const err = ambiguous('Storm', [
      loc('deck', 'Storm'),
      loc('deck', 'Storm Crow'),
      loc('wanted', 'Storm'),
    ])
    const message = formatResolveListError(err, 'type-prefix')
    expect(message).toContain('Wanted List: Storm')
    expect(message).toEndWith("Disambiguate with a type prefix, e.g. 'wanted:Storm'.")
  })

  it('quotes the suggested prefix so a name with a space stays copy-pasteable', () => {
    const err = ambiguous('high priority', [
      loc('deck', 'High Priority'),
      loc('wanted', 'High Priority'),
    ])
    expect(formatResolveListError(err, 'type-prefix')).toEndWith(
      "Disambiguate with a type prefix, e.g. 'deck:high priority' or 'wanted:high priority'.",
    )
  })

  it('suggests every qualifying type prefix without repeating a type', () => {
    const err = ambiguous('b', [loc('deck', 'Burn'), loc('collection', 'Binder')])
    expect(formatResolveListError(err, 'type-prefix')).toEndWith(
      "Disambiguate with a type prefix, e.g. 'deck:b' or 'collection:b'.",
    )
  })

  it('joins all three qualifying type prefixes', () => {
    const err = ambiguous('b', [
      loc('deck', 'Burn'),
      loc('collection', 'Binder'),
      loc('wanted', 'Buylist'),
    ])
    expect(formatResolveListError(err, 'type-prefix')).toEndWith(
      "Disambiguate with a type prefix, e.g. 'deck:b' or 'collection:b' or 'wanted:b'.",
    )
  })

  it('advises setting the request type field for a structured caller', () => {
    const err = ambiguous('Staples', [loc('deck', 'Staples'), loc('collection', 'Staples')])
    expect(formatResolveListError(err, 'type-field')).toEndWith(
      "Set the list's type to 'deck' or 'collection'.",
    )
  })

  it('falls back to name advice for a structured caller when no type resolves it', () => {
    const err = ambiguous('b', [
      loc('deck', 'Burn'),
      loc('deck', 'Binder'),
      loc('collection', 'Bulk'),
      loc('collection', 'Boxes'),
    ])
    expect(formatResolveListError(err, 'type-field')).toEndWith(
      "Type more of the name to narrow the match (e.g. 'Burn').",
    )
  })

  it('asks for an exact full name when every match folds to the query', () => {
    // `Storm Crow.md` and `storm-crow.md` fold identically, so a longer name
    // cannot help — but either spelled exactly resolves via the byte-exact tier.
    const err = ambiguous('Storm Crow', [loc('deck', 'Storm Crow'), loc('deck', 'storm-crow')])
    for (const hint of RESOLVE_HINTS) {
      expect(formatResolveListError(err, hint)).toEndWith(
        "Type one list's exact full name, spelled and capitalized as its file is (e.g. 'Storm Crow').",
      )
    }
  })

  it('offers no example name when the matches are byte-identical', () => {
    // The same file name under two list types: no name breaks this tie.
    const err = ambiguous('Staples', [loc('deck', 'Staples'), loc('collection', 'Staples')])
    expect(formatResolveListError(err, 'none')).toEndWith(
      'Type more of the name to narrow the match.',
    )
  })

  it('skips a self-referential example in favor of one that would resolve', () => {
    const err = ambiguous('storm', [
      loc('deck', 'Storm Crow'),
      loc('deck', 'storm-crow'),
      loc('deck', 'Storm Kiln'),
    ])
    expect(formatResolveListError(err, 'type-flags')).toEndWith(
      "Type more of the name to narrow the match (e.g. 'Storm Kiln').",
    )
  })

  it('falls back to name advice when no type prefix would resolve the ambiguity', () => {
    const err = ambiguous('b', [
      loc('deck', 'Burn'),
      loc('deck', 'Burning Vengeance'),
      loc('collection', 'Binder'),
      loc('collection', 'Binder2'),
    ])
    expect(formatResolveListError(err, 'type-prefix')).toEndWith(
      "Type more of the name to narrow the match (e.g. 'Burn').",
    )
  })
})

describe('normalizeListName', () => {
  const cases: [string, string][] = [
    ['Goblins', 'goblins'],
    ['Café Standard', 'cafe standard'],
    ['winota-stax', 'winota stax'],
    ['winota_stax', 'winota stax'],
    ['  Mono   Red  ', 'mono red'],
    ["Atraxa: Praetors' Voice", 'atraxa praetors voice'],
    ['Atraxa Praetors Voice', 'atraxa praetors voice'],
    ['Jace’s Archive', 'jaces archive'],
    ['What? Why* "Now"', 'what why now'],
    ['A/B<C>D|E', 'abcde'],
    ['A\\B', 'ab'],
    // The sanitizer collapses dot runs and trims edge dots, so the fold must too
    // — `new deck "Mono-U Tron... Redux"` writes `Mono-U Tron. Redux.md`.
    ['Mono-U Tron... Redux', 'mono u tron. redux'],
    ['.Hidden.', 'hidden'],
  ]
  for (const [input, expected] of cases) {
    it(`folds ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizeListName(input)).toBe(expected)
    })
  }
})

describe('resolveListArgument', () => {
  it('takes the prefix when no type flag is set', () => {
    expect(resolveListArgument('deck:Burn', undefined)).toEqual({ type: 'deck', name: 'Burn' })
  })

  it('takes the flag when the name has no prefix', () => {
    expect(resolveListArgument('Burn', 'collection')).toEqual({
      type: 'collection',
      name: 'Burn',
    })
  })

  it('accepts a prefix that agrees with the flag', () => {
    expect(resolveListArgument('deck:Burn', 'deck')).toEqual({ type: 'deck', name: 'Burn' })
  })

  it('refuses a prefix that contradicts the flag, naming both', () => {
    const result = resolveListArgument('deck:Trade Binder', 'collection')
    expect(isListArgumentConflict(result)).toBe(true)
    if (!isListArgumentConflict(result)) throw new Error('expected a conflict')
    expect(result.message).toContain("'deck:Trade Binder'")
    expect(result.message).toContain('--collection')
  })

  it('treats an unknown prefix as part of the name, flag intact', () => {
    expect(resolveListArgument('binder:Trades', 'collection')).toEqual({
      type: 'collection',
      name: 'binder:Trades',
    })
  })
})

describe('parseListArgument', () => {
  it('splits a type prefix off', () => {
    expect(parseListArgument('deck:Burn')).toEqual({ type: 'deck', name: 'Burn' })
    expect(parseListArgument('wanted:High Priority')).toEqual({
      type: 'wanted',
      name: 'High Priority',
    })
  })

  it('leaves unprefixed names and unknown prefixes alone', () => {
    expect(parseListArgument('Burn')).toEqual({ name: 'Burn' })
    expect(parseListArgument('binder:Trades')).toEqual({ name: 'binder:Trades' })
  })
})
