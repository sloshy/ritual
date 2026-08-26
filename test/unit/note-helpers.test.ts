import { describe, expect, test } from 'bun:test'
import { normalizeNote, noteOrUndefined } from '../../src/card/note-helpers'

describe('normalizeNote', () => {
  test('returns the trimmed text for a clean note', () => {
    const result = normalizeNote('starts the engine')
    expect(result).toEqual({ ok: true, note: 'starts the engine' })
  })

  test('trims leading and trailing whitespace', () => {
    expect(normalizeNote('  hello  ')).toEqual({ ok: true, note: 'hello' })
  })

  test('whitespace-only input becomes the empty string (the clear sentinel)', () => {
    expect(normalizeNote('   ')).toEqual({ ok: true, note: '' })
  })

  test('empty string is allowed (clears the note)', () => {
    expect(normalizeNote('')).toEqual({ ok: true, note: '' })
  })

  test('preserves printable punctuation including quotes', () => {
    expect(normalizeNote(`"foo" bar's baz`)).toEqual({ ok: true, note: `"foo" bar's baz` })
  })

  test('rejects newlines', () => {
    const result = normalizeNote('line one\nline two')
    expect(result.ok).toBe(false)
  })

  test('rejects tabs', () => {
    const result = normalizeNote('a\tb')
    expect(result.ok).toBe(false)
  })

  test('rejects carriage returns', () => {
    expect(normalizeNote('a\rb').ok).toBe(false)
  })

  test('rejects DEL (0x7F)', () => {
    expect(normalizeNote('a\x7fb').ok).toBe(false)
  })

  test('rejects NUL', () => {
    expect(normalizeNote('a\x00b').ok).toBe(false)
  })
})

describe('noteOrUndefined', () => {
  test('passes through undefined', () => {
    expect(noteOrUndefined(undefined)).toBeUndefined()
  })

  test('coerces empty string to undefined', () => {
    expect(noteOrUndefined('')).toBeUndefined()
  })

  test('preserves a non-empty string', () => {
    expect(noteOrUndefined('hello')).toBe('hello')
  })
})
