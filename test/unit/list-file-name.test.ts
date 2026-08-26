import { describe, test, expect } from 'bun:test'
import {
  isUsableFileName,
  listFileName,
  sanitizeListFileName,
  sameListName,
} from '../../src/list/list-file-name'

describe('sanitizeListFileName', () => {
  test('keeps the name as entered', () => {
    // Case, spaces, and punctuation survive — a list is not lowercased or kebab-cased.
    expect(sanitizeListFileName('My Cool Deck')).toBe('My Cool Deck')
    expect(sanitizeListFileName("Atraxa's Praetorian!! ++Stax++")).toBe(
      "Atraxa's Praetorian!! ++Stax++",
    )
    expect(sanitizeListFileName('Café')).toBe('Café')
  })

  test('strips characters no file system accepts', () => {
    expect(sanitizeListFileName("Atraxa: Praetors' Voice")).toBe("Atraxa Praetors' Voice")
    expect(sanitizeListFileName('Burn/Sligh')).toBe('BurnSligh')
    expect(sanitizeListFileName('What? <Now> | "Really"*')).toBe('What Now  Really')
    expect(sanitizeListFileName('null\x00byte')).toBe('nullbyte')
  })

  test('trims surrounding whitespace', () => {
    expect(sanitizeListFileName('  Spaced Out  ')).toBe('Spaced Out')
  })

  test('defuses path traversal and leading/trailing dots', () => {
    expect(sanitizeListFileName('../../etc/passwd')).toBe('etcpasswd')
    expect(sanitizeListFileName('.hidden')).toBe('hidden')
    expect(sanitizeListFileName('trailing.')).toBe('trailing')
    // An interior single dot is legal and kept.
    expect(sanitizeListFileName('Vol.2 Brews')).toBe('Vol.2 Brews')
  })

  test('returns null when nothing usable is left', () => {
    // Null rather than '' so strictNullChecks forces callers to handle it, instead
    // of quietly interpolating an empty name into a path.
    expect(sanitizeListFileName('???')).toBeNull()
    expect(sanitizeListFileName('   ')).toBeNull()
    expect(sanitizeListFileName('')).toBeNull()
    expect(sanitizeListFileName('...')).toBeNull()
  })
})

describe('isUsableFileName', () => {
  test('rejects exactly the names that sanitize to nothing', () => {
    expect(isUsableFileName('Winota Stax')).toBe(true)
    expect(isUsableFileName('?')).toBe(false)
    expect(isUsableFileName('  ')).toBe(false)
  })
})

describe('listFileName', () => {
  test('appends the .md extension to the sanitized name', () => {
    expect(listFileName('My Cool Deck')).toBe('My Cool Deck.md')
  })

  test('is null for an unusable name, so no file is ever named ".md"', () => {
    expect(listFileName('???')).toBeNull()
  })
})

describe('sameListName', () => {
  test('matches exact names and names that fold to the same form', () => {
    expect(sameListName('My Deck', 'My Deck')).toBe(true)
    expect(sameListName('Café', 'Cafe')).toBe(true)
    expect(sameListName('winota-stax', 'Winota Stax')).toBe(true)
    expect(sameListName('My Deck', 'Other')).toBe(false)
  })

  test('an empty or unfoldable name never matches, not even itself', () => {
    expect(sameListName('', '')).toBe(false)
    expect(sameListName('???', '!!!')).toBe(false)
  })
})
