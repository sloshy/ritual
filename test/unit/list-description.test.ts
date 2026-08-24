import { describe, expect, test } from 'bun:test'
import {
  isListDescriptionError,
  parseListDescription,
  readListDescription,
} from '../../src/list-description'

/**
 * The `description:` grammar every list type shares: text in, `null` for the
 * three ways of saying "no description", and a refusal for anything that is not
 * text at all.
 */

describe('parseListDescription', () => {
  test('returns the text, trimmed of surrounding whitespace only', () => {
    expect(parseListDescription('  Burn, but cheap.\n')).toBe('Burn, but cheap.')
    expect(parseListDescription('Line one\n\nLine two')).toBe('Line one\n\nLine two')
  })

  test('absent, null and blank all read as no description', () => {
    expect(parseListDescription(undefined)).toBeNull()
    expect(parseListDescription(null)).toBeNull()
    expect(parseListDescription('   \n ')).toBeNull()
  })

  test('a non-string value is refused rather than coerced', () => {
    const parsed = parseListDescription({ text: 'nope' })
    expect(isListDescriptionError(parsed)).toBeTrue()
    expect(isListDescriptionError(parsed) ? parsed.error : '').toContain('must be text')
    expect(isListDescriptionError(parseListDescription(12))).toBeTrue()
  })
})

describe('readListDescription', () => {
  test('reads the key off a front-matter mapping', () => {
    expect(readListDescription({ description: 'My binder', labels: ['sale'] })).toEqual({
      description: 'My binder',
    })
  })

  test('an absent or blank key yields nothing at all — no advisory', () => {
    expect(readListDescription({ labels: ['sale'] })).toEqual({})
    expect(readListDescription({ description: '  ' })).toEqual({})
  })

  test('an unusable value degrades to an advisory, never a throw', () => {
    const read = readListDescription({ description: ['a', 'b'] })
    expect(read.description).toBeUndefined()
    expect(read.advisory).toContain('must be text')
  })
})
