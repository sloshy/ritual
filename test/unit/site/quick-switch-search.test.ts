import { describe, expect, test } from 'bun:test'
import { scoreMatch } from '../../../src/site/quick-switch-search'

describe('scoreMatch', () => {
  test('empty query returns zero (no filtering)', () => {
    expect(scoreMatch('Anything', '')).toBe(0)
    expect(scoreMatch('Anything', '   ')).toBe(0)
  })

  test('exact match scores highest', () => {
    expect(scoreMatch('Karlach', 'Karlach')).toBeGreaterThan(scoreMatch('Karlach Risen', 'karl'))
  })

  test('prefix match outranks mid-string match for same name length tier', () => {
    const prefixScore = scoreMatch('Karlach Risen', 'karl')
    const midStringScore = scoreMatch('Captain Karlach', 'karl')
    expect(prefixScore).toBeGreaterThan(midStringScore)
  })

  test('strict substring: "karl" must NOT match "Klauth, Unrivaled Ancient"', () => {
    expect(scoreMatch('Klauth, Unrivaled Ancient', 'karl')).toBe(-1)
  })

  test('strict substring: "karl" matches "Karlach"', () => {
    expect(scoreMatch('Karlach', 'karl')).toBeGreaterThan(0)
  })

  // Casing/diacritic folding itself is normalizeForSearch's job (pinned in
  // term-match.test.ts); this proves scoreMatch normalizes both name and query.
  test('diacritic-insensitive matching', () => {
    expect(scoreMatch('Téferi, Hero of Dominaria', 'teferi')).toBeGreaterThan(0)
    expect(scoreMatch('Teferi, Hero of Dominaria', 'téferi')).toBeGreaterThan(0)
    // An accented query still fails against an unrelated name (no false positives).
    expect(scoreMatch('Klauth, Unrivaled Ancient', 'téferi')).toBe(-1)
  })

  test('multi-word query: each whitespace-separated term must match as a substring (AND)', () => {
    expect(scoreMatch('Lightning Bolt', 'lightning bolt')).toBeGreaterThan(0)
    expect(scoreMatch('Bolt of Lightning', 'lightning bolt')).toBeGreaterThan(0)
    // Both terms appear as substrings, even if not contiguous in the source name
    expect(scoreMatch('Karlach, Fury of Avernus', 'karl avernus')).toBeGreaterThan(0)
  })

  test('multi-word query: missing any single term means no match', () => {
    expect(scoreMatch('Lightning Bolt', 'lightning fireball')).toBe(-1)
    expect(scoreMatch('Karlach Risen', 'karl bolt')).toBe(-1)
  })

  test('repeated whitespace and surrounding whitespace are tolerated', () => {
    expect(scoreMatch('Lightning Bolt', '  lightning   bolt  ')).toBeGreaterThan(0)
  })

  test('hyphenated query term is not split and matches as a literal substring', () => {
    expect(scoreMatch('Mind-Numbing Terror', 'mind-numbing')).toBeGreaterThan(0)
  })
})
