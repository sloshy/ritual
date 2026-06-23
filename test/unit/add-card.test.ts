import { describe, test, expect } from 'bun:test'
import { normalizeCardName } from '../../src/commands/add-card'

describe('normalizeCardName', () => {
  test('lowercases input', () => {
    expect(normalizeCardName('Sol Ring')).toBe('sol ring')
  })

  test('strips punctuation', () => {
    expect(normalizeCardName('Ach! Hans, Run!')).toBe('ach hans run')
  })

  test('handles apostrophes', () => {
    expect(normalizeCardName("Frodo, Sauron's Bane")).toBe('frodo saurons bane')
  })

  test('collapses whitespace', () => {
    expect(normalizeCardName('Sol   Ring')).toBe('sol ring')
  })

  test('strips hyphens and folds diacritics to base letters', () => {
    // The accented û folds to a plain u rather than being dropped, so an
    // accent-free query ("lim dul ...") still matches.
    expect(normalizeCardName('Lim-Dûl the Necromancer')).toBe('limdul the necromancer')
  })

  test('folds diacritics so accented names match plain queries', () => {
    expect(normalizeCardName('Séance')).toBe('seance')
    expect(normalizeCardName('Jötun Grunt')).toBe('jotun grunt')
  })

  test('handles empty string', () => {
    expect(normalizeCardName('')).toBe('')
  })

  test('preserves numbers', () => {
    expect(normalizeCardName('1996 World Champion')).toBe('1996 world champion')
  })

  test('handles double-faced card names', () => {
    expect(normalizeCardName('Delver of Secrets // Insectile Aberration')).toBe(
      'delver of secrets insectile aberration',
    )
  })
})
