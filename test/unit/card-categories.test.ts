import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CARD_CATEGORIES,
  foldCategoryCardName,
  formatCardCategories,
  invalidCardCategoryMessage,
  isCardCategoryShaped,
  normalizeCardCategories,
  normalizeCardCategory,
  parseCardCategoriesInput,
  parseCardCategoriesValue,
  parseCardCategory,
  parseDefaultCategories,
  primaryCardCategory,
  sameCardCategories,
} from '../../src/card/card-categories'
import { isConfigParseError } from '../../src/config/ritual-config'

describe('isCardCategoryShaped / invalidCardCategoryMessage', () => {
  test('accepts ordinary category names, including punctuation the card line does not use', () => {
    for (const value of ['Ramp', 'Board Wipes', 'Draw/Filter', 'Ramp: fast', "Ryan's Picks"]) {
      expect(isCardCategoryShaped(value)).toBe(true)
    }
  })

  test('refuses empty text and every character the card line reserves', () => {
    for (const value of [
      '',
      '   ',
      'a,b',
      'R&D',
      '#Ramp',
      '[x]',
      '(x)',
      '{x}',
      'say "hi"',
      'a*b',
    ]) {
      expect(isCardCategoryShaped(value)).toBe(false)
    }
    // A control character, written as an escape so the source stays plain text.
    expect(isCardCategoryShaped('a\u0001b')).toBe(false)
  })

  test('the refusal names the raw input and states the shape rule', () => {
    const message = invalidCardCategoryMessage('a,b')
    expect(message).toStartWith('Invalid category "a,b":')
    expect(message).toEndWith('braces or parentheses.')
  })
})

describe('parseCardCategory / normalizeCardCategory', () => {
  test('trims and folds inner whitespace, keeping case', () => {
    expect(normalizeCardCategory('  Board   Wipes ')).toBe('Board Wipes')
    const parsed = parseCardCategory('  card  Draw ')
    expect(parsed).toEqual({ ok: true, category: 'card Draw' })
  })

  test('a leading # is refused rather than stripped — categories have no sigil', () => {
    const parsed = parseCardCategory('#Ramp')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.message).toContain('#Ramp')
  })
})

describe('normalizeCardCategories', () => {
  test('preserves order and drops later case-insensitive duplicates, first spelling wins', () => {
    expect(normalizeCardCategories(['Ramp', 'Draw', 'ramp'])).toEqual(['Ramp', 'Draw'])
  })

  test('does not sort — the first entry is the primary category', () => {
    expect(normalizeCardCategories(['Removal', 'Draw', 'Ramp'])).toEqual([
      'Removal',
      'Draw',
      'Ramp',
    ])
  })
})

describe('parseCardCategoriesValue', () => {
  test('refuses a non-array and a non-string element, naming the field', () => {
    const notArray = parseCardCategoriesValue('Ramp', '"categories"')
    expect(notArray).toEqual({
      ok: false,
      message: '"categories" must be an array of categories.',
    })
    const notStrings = parseCardCategoriesValue(['Ramp', 7], '"categories"')
    expect(notStrings.ok).toBe(false)
  })

  test('an empty array is ok — an empty category list is a meaningful clear', () => {
    expect(parseCardCategoriesValue([], '"categories"')).toEqual({ ok: true, categories: [] })
  })

  test('returns canonical output', () => {
    expect(parseCardCategoriesValue([' Ramp ', 'ramp', 'Card  Draw'], '"categories"')).toEqual({
      ok: true,
      categories: ['Ramp', 'Card Draw'],
    })
  })
})

describe('parseCardCategoriesInput', () => {
  test('splits on commas and keeps the typed order', () => {
    expect(parseCardCategoriesInput('Ramp, Artifacts')).toEqual({
      ok: true,
      categories: ['Ramp', 'Artifacts'],
    })
  })

  test('skips an empty part between two commas and reads empty input as a clear', () => {
    expect(parseCardCategoriesInput('Ramp,,Artifacts')).toEqual({
      ok: true,
      categories: ['Ramp', 'Artifacts'],
    })
    expect(parseCardCategoriesInput('')).toEqual({ ok: true, categories: [] })
  })

  test('a malformed part refuses the whole input', () => {
    expect(parseCardCategoriesInput('Ramp, R&D').ok).toBe(false)
  })
})

describe('formatCardCategories / sameCardCategories / primaryCardCategory', () => {
  test('formats in stored order, primary first', () => {
    expect(formatCardCategories(['Removal', 'Ramp'])).toBe('Removal, Ramp')
    expect(formatCardCategories(undefined)).toBe('')
  })

  test('equality is order-SENSITIVE — the difference from tags', () => {
    expect(sameCardCategories(['Ramp', 'Draw'], ['Draw', 'Ramp'])).toBe(false)
    expect(sameCardCategories(['Ramp', 'Draw'], ['ramp', 'DRAW'])).toBe(true)
  })

  test('absent is equal to empty', () => {
    expect(sameCardCategories(undefined, [])).toBe(true)
    expect(sameCardCategories([], undefined)).toBe(true)
    expect(sameCardCategories(undefined, ['Ramp'])).toBe(false)
  })

  test('the primary category is the first entry', () => {
    expect(primaryCardCategory([' Ramp ', 'Draw'])).toBe('Ramp')
    expect(primaryCardCategory([])).toBeUndefined()
    expect(primaryCardCategory(undefined)).toBeUndefined()
  })
})

describe('foldCategoryCardName', () => {
  test('trims, folds whitespace and lowercases', () => {
    expect(foldCategoryCardName('  Sol   Ring ')).toBe('sol ring')
  })

  test('keeps the // of a double-faced name — unlike normalizeCardName', () => {
    expect(foldCategoryCardName('Fire // Ice')).toBe('fire // ice')
  })
})

describe('parseDefaultCategories', () => {
  test('absent means the shipped vocabulary', () => {
    expect(parseDefaultCategories(undefined)).toEqual([...DEFAULT_CARD_CATEGORIES])
  })

  test('a valid array round-trips canonically', () => {
    expect(parseDefaultCategories([' Ramp ', 'Card  Draw', 'ramp'])).toEqual(['Ramp', 'Card Draw'])
  })

  test('an explicit empty array is legal — no suggestions', () => {
    expect(parseDefaultCategories([])).toEqual([])
  })

  test('a non-array and a malformed name each return a config parse error', () => {
    const notArray = parseDefaultCategories('Ramp')
    expect(isConfigParseError(notArray)).toBe(true)
    const malformed = parseDefaultCategories(['Ramp', 'a,b'])
    expect(isConfigParseError(malformed)).toBe(true)
    if (isConfigParseError(malformed)) expect(malformed.error).toContain('a,b')
  })
})
