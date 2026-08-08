import { describe, expect, test } from 'bun:test'
import {
  isLocaleTag,
  isLocaleTagError,
  localeLanguage,
  localeTag,
  parseLocaleTag,
} from '../../../src/i18n/locale-tag'

describe('parseLocaleTag', () => {
  test('accepts a bare language', () => {
    expect(parseLocaleTag('ja')).toBe(localeTag('ja'))
  })

  test('canonicalizes region and script casing', () => {
    expect(parseLocaleTag('de-at')).toBe(localeTag('de-AT'))
    expect(parseLocaleTag('sr-latn-rs')).toBe(localeTag('sr-Latn-RS'))
  })

  test('trims surrounding whitespace', () => {
    expect(parseLocaleTag('  pt-BR  ')).toBe(localeTag('pt-BR'))
  })

  test('rejects a malformed tag with a message naming the value', () => {
    const result = parseLocaleTag('not a tag')
    expect(isLocaleTagError(result)).toBe(true)
    if (isLocaleTagError(result)) expect(result.error).toContain('not a tag')
  })

  test('rejects a non-string', () => {
    expect(isLocaleTagError(parseLocaleTag(42))).toBe(true)
    expect(isLocaleTagError(parseLocaleTag(undefined))).toBe(true)
    expect(isLocaleTagError(parseLocaleTag(null))).toBe(true)
  })

  test('rejects the empty string', () => {
    expect(isLocaleTagError(parseLocaleTag('   '))).toBe(true)
  })

  test('rejects the POSIX C locale, which names no language', () => {
    expect(isLocaleTagError(parseLocaleTag('C'))).toBe(true)
  })
})

describe('isLocaleTag', () => {
  test('agrees with parseLocaleTag', () => {
    expect(isLocaleTag('en-GB')).toBe(true)
    expect(isLocaleTag('!!!')).toBe(false)
  })
})

describe('localeLanguage', () => {
  test('extracts the primary language subtag', () => {
    expect(localeLanguage('de-AT')).toBe('de')
    expect(localeLanguage('sr-Latn-RS')).toBe('sr')
    expect(localeLanguage('JA')).toBe('ja')
  })

  test('degrades to the leading segment for an unparseable tag', () => {
    expect(localeLanguage('not a tag')).toBe('not a tag')
  })
})
