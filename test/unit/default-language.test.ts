import { afterEach, describe, expect, test } from 'bun:test'
import {
  defaultLanguage,
  resetDefaultLanguage,
  setDefaultLanguage,
  type DefaultLanguageOverride,
} from '../../src/editor/default-language'
import { DEFAULT_CARD_LANGUAGE } from '../../src/card-language'

const overrideHost = globalThis as unknown as DefaultLanguageOverride

describe('defaultLanguage resolution', () => {
  afterEach(() => {
    delete overrideHost.__ritualDefaultLanguage__
    resetDefaultLanguage()
  })

  test('falls back to en when nothing is set', () => {
    expect(defaultLanguage()).toBe(DEFAULT_CARD_LANGUAGE)
  })

  test('uses the configured value once applied', () => {
    setDefaultLanguage('ja')
    expect(defaultLanguage()).toBe('ja')
    setDefaultLanguage('en')
    expect(defaultLanguage()).toBe('en')
  })

  test('the global test-seam override beats the configured value', () => {
    // Mirrors the search-debounce seam: an e2e run pins the language before the
    // app boots, and the config arriving later must not change it.
    overrideHost.__ritualDefaultLanguage__ = 'de'
    setDefaultLanguage('ja')
    expect(defaultLanguage()).toBe('de')
  })

  test('an override that is not a known language code is ignored', () => {
    overrideHost.__ritualDefaultLanguage__ = 'klingon'
    expect(defaultLanguage()).toBe(DEFAULT_CARD_LANGUAGE)
    setDefaultLanguage('ja')
    expect(defaultLanguage()).toBe('ja')
  })
})
