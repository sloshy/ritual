import { afterEach, describe, expect, test } from 'bun:test'
import {
  compareData,
  compareDataNumeric,
  compareDisplay,
  compareDisplayNumeric,
} from '../../../src/i18n/collate'
import { resetI18nRuntime, setLocale, type LocaleOverride } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'

const overrideHost = globalThis as unknown as LocaleOverride

afterEach(() => {
  delete overrideHost.__ritualLocale__
  resetI18nRuntime()
})

describe('compareData', () => {
  test('orders ASCII case-insensitively, like the collator English users expect', () => {
    expect(compareData('apple', 'Banana')).toBeLessThan(0)
  })

  test('is unaffected by the active UI locale', () => {
    // The point of the split: ~375 CLI stdout ordering assertions must not move
    // when a user switches interface language. In Swedish collation "ä" sorts
    // after "z"; pinned English collation must not follow.
    const english = compareData('ä', 'z')
    setLocale(localeTag('sv'))
    expect(compareData('ä', 'z')).toBe(english)
    expect(compareData('ä', 'z')).toBeLessThan(0)
  })

  test('is unaffected by the test-seam override', () => {
    overrideHost.__ritualLocale__ = 'sv'
    expect(compareData('ä', 'z')).toBeLessThan(0)
  })

  test('sorts a list stably regardless of locale', () => {
    const input = ['zebra', 'Ärger', 'apple', 'Banana']
    const expected = [...input].sort(compareData)
    setLocale(localeTag('sv'))
    expect([...input].sort(compareData)).toEqual(expected)
  })

  test('compareDataNumeric orders digit runs numerically', () => {
    expect(compareDataNumeric('card2', 'card10')).toBeLessThan(0)
    // Without the numeric option, lexicographic order puts 10 first.
    expect(compareData('card2', 'card10')).toBeGreaterThan(0)
  })
})

describe('compareDisplay', () => {
  test('follows the active UI locale', () => {
    setLocale(localeTag('de'))
    expect(compareDisplay('ä', 'z')).toBeLessThan(0)
    setLocale(localeTag('sv'))
    expect(compareDisplay('ä', 'z')).toBeGreaterThan(0)
  })

  test('follows the test-seam override', () => {
    overrideHost.__ritualLocale__ = 'sv'
    expect(compareDisplay('ä', 'z')).toBeGreaterThan(0)
  })

  test('defaults to English when no locale has been applied', () => {
    // Asserted directly rather than against `compareData`: comparing one half of
    // the system to the other would still pass if both regressed to the host
    // locale together. English collation puts 'ä' before 'z'.
    expect(compareDisplay('ä', 'z')).toBeLessThan(0)
  })

  test('compareDisplayNumeric orders digit runs numerically', () => {
    setLocale(localeTag('de'))
    expect(compareDisplayNumeric('Deck 2', 'Deck 10')).toBeLessThan(0)
  })
})
