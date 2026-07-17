import { describe, expect, test } from 'bun:test'
import {
  matchByNormalizedName,
  matchesAllNameTerms,
  matchesAllTerms,
  normalizeCardName,
  normalizeForSearch,
  promoteFullNameMatches,
} from '../../src/term-match'

describe('normalizeForSearch', () => {
  test('lowercases ASCII', () => {
    expect(normalizeForSearch('Lightning Bolt')).toBe('lightning bolt')
  })

  test('strips diacritics', () => {
    expect(normalizeForSearch('Téferi')).toBe('teferi')
    expect(normalizeForSearch('Jötun Grunt')).toBe('jotun grunt')
    expect(normalizeForSearch('Séance')).toBe('seance')
  })
})

describe('matchesAllTerms', () => {
  test('empty query matches everything', () => {
    expect(matchesAllTerms('Anything', '')).toBe(true)
    expect(matchesAllTerms('Anything', '   ')).toBe(true)
  })

  test('every whitespace-separated term must appear (AND)', () => {
    expect(matchesAllTerms('Lightning Bolt', 'lightning bolt')).toBe(true)
    expect(matchesAllTerms('Bolt of Lightning', 'lightning bolt')).toBe(true)
    expect(matchesAllTerms('Lightning Bolt', 'lightning fireball')).toBe(false)
  })

  test('case-insensitive', () => {
    expect(matchesAllTerms('LIGHTNING BOLT', 'lightning')).toBe(true)
    expect(matchesAllTerms('lightning bolt', 'BOLT')).toBe(true)
  })

  test('diacritic-insensitive in both directions', () => {
    // Accented card name, plain query
    expect(matchesAllTerms('Jötun Grunt', 'jotun')).toBe(true)
    expect(matchesAllTerms('Séance', 'seance')).toBe(true)
    // Plain card name, accented query
    expect(matchesAllTerms('Teferi, Hero of Dominaria', 'téferi')).toBe(true)
  })
})

describe('matchesAllNameTerms', () => {
  test('punctuation may be skipped, unlike matchesAllTerms', () => {
    expect(matchesAllNameTerms("Jace's Archivist", 'jaces archivist')).toBe(true)
    expect(matchesAllTerms("Jace's Archivist", 'jaces archivist')).toBe(false)
  })

  test('still requires every term to appear', () => {
    expect(matchesAllNameTerms("Jace's Archivist", 'jaces bolt')).toBe(false)
  })
})

type NormalizeCase = [label: string, input: string, expected: string]

const normalizeCardNameCases: NormalizeCase[] = [
  ['strips punctuation', 'Ach! Hans, Run!', 'ach hans run'],
  ['handles apostrophes', "Frodo, Sauron's Bane", 'frodo saurons bane'],
  ['collapses whitespace', 'Sol   Ring', 'sol ring'],
  // The accented û folds to a plain u rather than being dropped, so an
  // accent-free query ("lim dul ...") still matches. This pins the
  // fold-before-punctuation-strip ordering that is normalizeCardName's own contract.
  [
    'strips hyphens and folds diacritics to base letters',
    'Lim-Dûl the Necromancer',
    'limdul the necromancer',
  ],
  ['handles empty string', '', ''],
  ['preserves numbers', '1996 World Champion', '1996 world champion'],
  [
    'handles double-faced card names',
    'Delver of Secrets // Insectile Aberration',
    'delver of secrets insectile aberration',
  ],
]

describe('normalizeCardName', () => {
  test.each(normalizeCardNameCases)('%s', (_label, input, expected) => {
    expect(normalizeCardName(input)).toBe(expected)
  })
})

describe('matchByNormalizedName', () => {
  type Entry = { name: string }
  const nameOf = (e: Entry) => e.name
  const entries: Entry[] = [
    { name: 'Bolt' },
    { name: 'Lightning Bolt' },
    { name: 'Lightning Bolt' },
    { name: 'Sol Ring' },
  ]

  test('an exact normalized match wins over substring matches', () => {
    // 'Bolt' is a substring of both Lightning Bolts, but the exact tier
    // resolves it to the card literally named 'Bolt'.
    expect(matchByNormalizedName(entries, 'Bolt', nameOf)).toEqual([{ name: 'Bolt' }])
  })

  test('falls back to substring matches when nothing matches exactly', () => {
    expect(matchByNormalizedName(entries, 'Lightning', nameOf)).toEqual([
      { name: 'Lightning Bolt' },
      { name: 'Lightning Bolt' },
    ])
  })

  test('an empty or punctuation-only query matches nothing', () => {
    expect(matchByNormalizedName(entries, '', nameOf)).toEqual([])
    expect(matchByNormalizedName(entries, '  !!  ', nameOf)).toEqual([])
  })

  test('no matches yields an empty array', () => {
    expect(matchByNormalizedName(entries, 'Black Lotus', nameOf)).toEqual([])
  })

  test('matching ignores case, punctuation, and diacritics', () => {
    const fancy: Entry[] = [{ name: "Jace's Archivist" }, { name: 'Séance' }]
    expect(matchByNormalizedName(fancy, 'jaces archivist', nameOf)).toEqual([
      { name: "Jace's Archivist" },
    ])
    expect(matchByNormalizedName(fancy, 'seance', nameOf)).toEqual([{ name: 'Séance' }])
  })
})

describe('promoteFullNameMatches', () => {
  // Card search results arrive in EDHRec-popularity order; "The End" is an
  // unpopular card whose name every one of these contains.
  const byPopularity = ['The Enduring Renown', 'The Endless Swarm', 'The End', 'The Ends of Empire']
  const identity = (name: string): string => name

  test('a query spelling out a whole name beats more popular partial matches', () => {
    expect(promoteFullNameMatches(byPopularity, 'The End', identity)).toEqual([
      'The End',
      'The Enduring Renown',
      'The Endless Swarm',
      'The Ends of Empire',
    ])
  })

  test('a partially typed query leaves the popularity order alone', () => {
    expect(promoteFullNameMatches(byPopularity, 'The En', identity)).toEqual(byPopularity)
  })

  test('an empty query leaves the popularity order alone', () => {
    expect(promoteFullNameMatches(byPopularity, '  ', identity)).toEqual(byPopularity)
  })

  test('matching ignores case, punctuation, and diacritics', () => {
    const names = ["Jace's Archivist", 'Lim-Dûl the Necromancer']
    // Both sides are normalized, so the apostrophe and the accent can be skipped.
    expect(promoteFullNameMatches(names, 'JACES ARCHIVIST', identity)[0]).toBe("Jace's Archivist")
    expect(promoteFullNameMatches(names, 'lim-dul the necromancer', identity)[0]).toBe(
      'Lim-Dûl the Necromancer',
    )
  })

  test('spelling out a double-faced front face promotes that card', () => {
    // Nobody types the back half, so a front-face match counts as spelling out the name.
    const names = ['Delver of Secrets Deluxe', 'Delver of Secrets // Insectile Aberration']
    expect(promoteFullNameMatches(names, 'delver of secrets', identity)).toEqual([
      'Delver of Secrets // Insectile Aberration',
      'Delver of Secrets Deluxe',
    ])
  })

  test('a whole-name match outranks a front-face match', () => {
    const names = ['Fire // Ice', 'Fire']
    expect(promoteFullNameMatches(names, 'fire', identity)).toEqual(['Fire', 'Fire // Ice'])
  })

  test('promotes every whole-name match, keeping their incoming order', () => {
    // Same name, different printings — the caller's ordering still decides between them.
    type Printing = { name: string; set: string }
    const printings: Printing[] = [
      { name: 'The Enduring Renown', set: 'mkm' },
      { name: 'The End', set: 'dsk' },
      { name: 'The End', set: 'plst' },
    ]
    expect(promoteFullNameMatches(printings, 'the end', (p) => p.name).map((p) => p.set)).toEqual([
      'dsk',
      'plst',
      'mkm',
    ])
  })
})
