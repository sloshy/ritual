import { describe, expect, test } from 'bun:test'
import {
  isLocaleTag,
  isLocaleTagError,
  localeLanguage,
  parseLocaleTag,
} from '../../../src/i18n/locale-tag'
import {
  describeLocaleTagError,
  localeTag,
  localeTagErrorRef,
} from '../../../src/i18n/locale-tag-message'
import { DEFAULT_LOCALE } from '../../../src/i18n/runtime'
import type { LocaleTag } from '../../../src/i18n/types'
import { withSyntheticLocale } from '../../helpers/sync-text'

describe('parseLocaleTag', () => {
  test('accepts a bare language', () => {
    expect(parseLocaleTag('ja')).toBe('ja' as LocaleTag)
  })

  test('canonicalizes region and script casing', () => {
    expect(parseLocaleTag('de-at')).toBe('de-AT' as LocaleTag)
    expect(parseLocaleTag('sr-latn-rs')).toBe('sr-Latn-RS' as LocaleTag)
  })

  test('trims surrounding whitespace', () => {
    expect(parseLocaleTag('  pt-BR  ')).toBe('pt-BR' as LocaleTag)
  })

  test('rejects a malformed tag with a code naming the trimmed value', () => {
    expect(parseLocaleTag(' not a tag ')).toEqual({ problem: 'invalid', value: 'not a tag' })
  })

  test('rejects a non-string', () => {
    for (const value of [42, undefined, null]) {
      expect(parseLocaleTag(value)).toEqual({ problem: 'notAString' })
    }
  })

  test('rejects the empty string', () => {
    expect(parseLocaleTag('   ')).toEqual({ problem: 'empty' })
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

describe('wording a locale-tag refusal', () => {
  test('each code nests as its errors.i18n.localeTag key, the bad value as data', () => {
    expect(localeTagErrorRef({ problem: 'notAString' })).toEqual({
      messageKey: 'errors.i18n.localeTag.notAString',
    })
    expect(localeTagErrorRef({ problem: 'empty' })).toEqual({
      messageKey: 'errors.i18n.localeTag.empty',
    })
    expect(localeTagErrorRef({ problem: 'invalid', value: 'de_DE' })).toEqual({
      messageKey: 'errors.i18n.localeTag.invalid',
      messageParams: { value: 'de_DE' },
    })
  })

  test('the English is what the parser used to say', () => {
    expect(describeLocaleTagError({ problem: 'notAString' }, DEFAULT_LOCALE)).toBe(
      'locale must be a BCP-47 language tag string (e.g. "en", "de-AT")',
    )
    expect(describeLocaleTagError({ problem: 'empty' }, DEFAULT_LOCALE)).toBe(
      'locale must not be empty',
    )
    expect(describeLocaleTagError({ problem: 'invalid', value: 'de_DE' }, DEFAULT_LOCALE)).toBe(
      'invalid locale tag: de_DE',
    )
  })

  test('renders in the UI language in force', () => {
    const text = withSyntheticLocale(
      'xx',
      { 'errors.i18n.localeTag.invalid': 'KEIN TAG: {value}' },
      () => [
        describeLocaleTagError({ problem: 'invalid', value: 'de_DE' }),
        // An explicit locale wins over the one in force — the scripts pin English.
        describeLocaleTagError({ problem: 'invalid', value: 'de_DE' }, DEFAULT_LOCALE),
      ],
    )
    expect(text).toEqual(['KEIN TAG: de_DE', 'invalid locale tag: de_DE'])
  })
})

describe('localeTag', () => {
  test('mints a canonical tag from a well-formed literal', () => {
    expect(String(localeTag('de-at'))).toBe('de-AT')
  })

  test('a malformed literal throws an internal-error sentence naming it and why', () => {
    expect(() => localeTag('de_DE')).toThrow(
      'Internal error: the locale literal "de_DE" is not a locale tag (invalid locale tag: de_DE). This is a bug in Ritual.',
    )
  })
})
