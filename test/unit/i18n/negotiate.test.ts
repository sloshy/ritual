import { describe, expect, test } from 'bun:test'
import { negotiateLocale } from '../../../src/i18n/negotiate'
import { localeTag } from '../../../src/i18n/locale-tag'

describe('negotiateLocale', () => {
  test('prefers an exact tag match', () => {
    expect(negotiateLocale(['de-AT'], [localeTag('de'), localeTag('de-AT'), localeTag('fr')])).toBe(
      localeTag('de-AT'),
    )
  })

  test('matching is case-insensitive but returns the available spelling', () => {
    expect(negotiateLocale(['DE-at'], [localeTag('de-AT')])).toBe(localeTag('de-AT'))
  })

  test('falls back to the language subtag', () => {
    expect(negotiateLocale(['de-AT'], [localeTag('en'), localeTag('de')])).toBe(localeTag('de'))
  })

  test('matches a bare language against a regional catalog', () => {
    expect(negotiateLocale(['pt'], [localeTag('en'), localeTag('pt-BR')])).toBe(localeTag('pt-BR'))
  })

  test('honors request order over availability order', () => {
    // `de-AT` is the user's first preference, so its language-subtag match wins
    // over an exact match for a lower-priority request.
    expect(negotiateLocale(['de-AT', 'fr'], [localeTag('fr'), localeTag('de')])).toBe(
      localeTag('de'),
    )
  })

  test('falls through a request with no match at all', () => {
    expect(negotiateLocale(['is', 'fr-CA'], [localeTag('en'), localeTag('fr')])).toBe(
      localeTag('fr'),
    )
  })

  test('returns en when nothing matches', () => {
    expect(negotiateLocale(['is'], [localeTag('de'), localeTag('fr')])).toBe(localeTag('en'))
  })

  test('returns en for an empty request list', () => {
    expect(negotiateLocale([], [localeTag('de')])).toBe(localeTag('en'))
  })

  test('returns en when nothing is available', () => {
    expect(negotiateLocale(['de'], [])).toBe(localeTag('en'))
  })

  test('ignores blank entries in the request list', () => {
    expect(negotiateLocale(['', '   ', 'de'], [localeTag('en'), localeTag('de')])).toBe(
      localeTag('de'),
    )
  })

  test('a malformed request cannot match', () => {
    expect(negotiateLocale(['!!!'], [localeTag('en'), localeTag('de')])).toBe(localeTag('en'))
  })
})
