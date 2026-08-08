import { afterEach, describe, expect, test } from 'bun:test'
import { formatDateTime, formatNumber } from '../../../src/ui/format'
import { resetI18nRuntime, setLocale } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'

/** ICU uses narrow no-break spaces around the clock; normalize for readable assertions. */
function plainSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ')
}

const STAMP = '2026-08-07T15:04:05.000Z'

afterEach(() => {
  resetI18nRuntime()
})

describe('formatDateTime', () => {
  test('its default options reproduce `toLocaleString()` byte for byte', () => {
    // The whole point of the module: routing a bare `toLocaleString()` through
    // an explicit locale must not move any existing English output. Bun's
    // default resolved locale is en-US, which is what the old call produced.
    const date = new Date(STAMP)
    setLocale(localeTag('en-US'))
    // eslint-disable-next-line ritual/no-bare-intl-locale -- the bare call is the baseline under test
    expect(formatDateTime(date)).toBe(date.toLocaleString())
  })

  test('accepts a Date, epoch milliseconds, or an ISO string alike', () => {
    setLocale(localeTag('en'))
    const date = new Date(STAMP)
    const fromDate = formatDateTime(date)
    expect(formatDateTime(date.getTime())).toBe(fromDate)
    expect(formatDateTime(STAMP)).toBe(fromDate)
  })

  test('follows the active UI locale rather than the host', () => {
    setLocale(localeTag('en'))
    const english = formatDateTime(STAMP, { year: 'numeric', month: 'long', day: 'numeric' })
    setLocale(localeTag('de-DE'))
    const german = formatDateTime(STAMP, { year: 'numeric', month: 'long', day: 'numeric' })
    expect(english).toBe('August 7, 2026')
    expect(german).toBe('7. August 2026')
  })

  test('an unparseable date renders what `toLocaleString()` renders for one', () => {
    // `Intl.DateTimeFormat.format` throws on an invalid date where
    // `toLocaleString()` returns a sentinel; call sites keep the old behavior.
    // eslint-disable-next-line ritual/no-bare-intl-locale -- the bare call is the baseline under test
    expect(formatDateTime('not a date')).toBe(new Date('not a date').toLocaleString())
  })
})

describe('formatNumber', () => {
  test('groups digits in the active UI locale', () => {
    setLocale(localeTag('en'))
    expect(formatNumber(1234567)).toBe('1,234,567')
    setLocale(localeTag('de-DE'))
    expect(formatNumber(1234567)).toBe('1.234.567')
  })

  test('English grouping matches the `toLocaleString()` it replaced', () => {
    setLocale(localeTag('en-US'))
    // eslint-disable-next-line ritual/no-bare-intl-locale -- the bare call is the baseline under test
    expect(formatNumber(1234567)).toBe((1234567).toLocaleString())
  })

  test('passes options through to the memoized formatter', () => {
    setLocale(localeTag('de-DE'))
    expect(plainSpaces(formatNumber(1234.5, { style: 'currency', currency: 'EUR' }))).toBe(
      '1.234,50 €',
    )
  })
})
