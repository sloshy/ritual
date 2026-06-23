import { describe, expect, test } from 'bun:test'
import { matchesAllTerms, normalizeForSearch } from '../../src/term-match'

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
