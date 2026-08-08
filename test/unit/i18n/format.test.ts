import { describe, expect, test } from 'bun:test'
import { localeTag } from '../../../src/i18n/locale-tag'
import {
  collator,
  dateTimeFormat,
  listFormat,
  numberFormat,
  pluralRules,
  relativeTimeFormat,
  resetFormatCaches,
  segmenter,
} from '../../../src/i18n/format'

/** ICU puts U+00A0 before the euro sign; normalize so the assertion reads plainly. */
function plainSpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ')
}

describe('numberFormat', () => {
  test('formats currency in the requested locale, not the host locale', () => {
    // Bun resolves no locale from the environment, so a bare constructor would
    // silently render en-US here regardless of LANG.
    const formatted = numberFormat(localeTag('de-DE'), {
      style: 'currency',
      currency: 'EUR',
    }).format(1234.5)
    expect(plainSpaces(formatted)).toBe('1.234,50 €')
  })

  test('the same value formats differently per locale', () => {
    const options: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD' }
    expect(numberFormat(localeTag('en-US'), options).format(1234.5)).toBe('$1,234.50')
    expect(plainSpaces(numberFormat(localeTag('de-DE'), options).format(1234.5))).not.toBe(
      '$1,234.50',
    )
  })

  test('the explicit tag is what the formatter resolved with', () => {
    expect(numberFormat(localeTag('de-DE')).resolvedOptions().locale).toBe('de-DE')
  })

  test('English formatting keeps a dot decimal separator', () => {
    // What `formatPrice`'s `tix` branch rests on: `tix` is not an ISO 4217 code,
    // so it renders through `numberFormat` as a plain two-decimal number rather
    // than through `style: 'currency'`.
    const formatted = numberFormat(localeTag('en'), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(1234.5)
    expect(formatted).toBe('1234.50')
    expect(formatted).not.toContain(',')
  })
})

describe('memoization', () => {
  test('reuses a formatter for the same locale and options', () => {
    resetFormatCaches()
    const options: Intl.NumberFormatOptions = { style: 'currency', currency: 'EUR' }
    expect(numberFormat(localeTag('de-DE'), options)).toBe(
      numberFormat(localeTag('de-DE'), options),
    )
  })

  test('key order in the options object does not split the cache', () => {
    resetFormatCaches()
    const first = numberFormat(localeTag('de-DE'), { style: 'currency', currency: 'EUR' })
    const second = numberFormat(localeTag('de-DE'), { currency: 'EUR', style: 'currency' })
    expect(first).toBe(second)
  })

  test('different locales get different formatters', () => {
    expect(numberFormat(localeTag('de-DE'))).not.toBe(numberFormat(localeTag('fr-FR')))
  })

  test('different options get different formatters', () => {
    expect(numberFormat(localeTag('de-DE'))).not.toBe(
      numberFormat(localeTag('de-DE'), { style: 'percent' }),
    )
  })

  test('every formatter kind is cached independently', () => {
    resetFormatCaches()
    expect(dateTimeFormat(localeTag('de-DE'))).toBe(dateTimeFormat(localeTag('de-DE')))
    expect(relativeTimeFormat(localeTag('de-DE'))).toBe(relativeTimeFormat(localeTag('de-DE')))
    expect(listFormat(localeTag('de-DE'))).toBe(listFormat(localeTag('de-DE')))
    expect(collator(localeTag('de-DE'))).toBe(collator(localeTag('de-DE')))
    expect(pluralRules(localeTag('de-DE'))).toBe(pluralRules(localeTag('de-DE')))
    expect(segmenter(localeTag('de-DE'))).toBe(segmenter(localeTag('de-DE')))
  })

  test('resetFormatCaches drops the cache', () => {
    const before = numberFormat(localeTag('de-DE'))
    resetFormatCaches()
    expect(numberFormat(localeTag('de-DE'))).not.toBe(before)
  })
})

describe('other formatters honor the explicit tag', () => {
  test('listFormat joins with the locale conjunction', () => {
    expect(
      listFormat(localeTag('de-DE'), { style: 'long', type: 'conjunction' }).format([
        'a',
        'b',
        'c',
      ]),
    ).toBe('a, b und c')
    expect(
      listFormat(localeTag('en'), { style: 'long', type: 'conjunction' }).format(['a', 'b', 'c']),
    ).toBe('a, b, and c')
  })

  test('relativeTimeFormat renders in the locale', () => {
    expect(relativeTimeFormat(localeTag('de-DE'), { numeric: 'auto' }).format(-1, 'day')).toBe(
      'gestern',
    )
  })

  test('dateTimeFormat orders fields per the locale', () => {
    const date = new Date(Date.UTC(2026, 7, 7))
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }
    expect(dateTimeFormat(localeTag('en-US'), options).format(date)).toBe('08/07/2026')
    expect(dateTimeFormat(localeTag('de-DE'), options).format(date)).toBe('07.08.2026')
  })

  test('pluralRules exposes the locale categories', () => {
    expect(pluralRules(localeTag('ru')).resolvedOptions().pluralCategories.sort()).toEqual([
      'few',
      'many',
      'one',
      'other',
    ])
    expect(pluralRules(localeTag('ja')).resolvedOptions().pluralCategories).toEqual(['other'])
  })
})
