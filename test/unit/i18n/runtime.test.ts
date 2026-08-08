import { afterEach, describe, expect, test } from 'bun:test'
import {
  currentLocale,
  DEFAULT_LOCALE,
  englishMessage,
  getDictionary,
  hasEnglishMessage,
  isStrictI18n,
  loadDictionary,
  loadedLocales,
  registeredMessageCount,
  registerMessages,
  resetI18nRuntime,
  resetLocale,
  setLocale,
  type LocaleOverride,
} from '../../../src/i18n/runtime'
import { en } from '../../../src/i18n/messages/en'
import { localeTag } from '../../../src/i18n/locale-tag'

const overrideHost = globalThis as unknown as LocaleOverride

/**
 * A key registered by `test/preload.ts` (which stands in for `main()`), used to
 * tell "English is present" from "English was replaced". Identity is not the
 * test any more: the runtime no longer imports the catalog, it accumulates one
 * through {@link registerMessages}, so the dictionary is its own object.
 */
const PROBE_KEY = 'ui.dialog.cancel'

afterEach(() => {
  delete overrideHost.__ritualLocale__
  resetI18nRuntime()
})

describe('locale resolution', () => {
  test('falls back to en when nothing is applied', () => {
    expect(currentLocale()).toBe(DEFAULT_LOCALE)
  })

  test('uses the applied locale', () => {
    setLocale(localeTag('de-AT'))
    expect(currentLocale()).toBe(localeTag('de-AT'))
  })

  test('resetLocale returns to the default', () => {
    setLocale(localeTag('de-AT'))
    resetLocale()
    expect(currentLocale()).toBe(DEFAULT_LOCALE)
  })

  test('the global test seam beats the applied locale', () => {
    // Mirrors the search-debounce and default-language seams: an e2e run pins
    // the locale before boot, and config arriving later must not change it.
    overrideHost.__ritualLocale__ = 'ja'
    setLocale(localeTag('de-AT'))
    expect(currentLocale()).toBe(localeTag('ja'))
  })

  test('an override that is not a valid tag is ignored', () => {
    overrideHost.__ritualLocale__ = 'not a tag'
    setLocale(localeTag('de-AT'))
    expect(currentLocale()).toBe(localeTag('de-AT'))
  })
})

describe('dictionaries', () => {
  test('English is always loaded', () => {
    expect(getDictionary(DEFAULT_LOCALE)?.[PROBE_KEY]).toBe(en[PROBE_KEY])
    expect(loadedLocales()).toContain(DEFAULT_LOCALE)
  })

  test('a loaded dictionary is retrievable', () => {
    const catalog = { 'ui.dialog.cancel': 'Abbrechen' }
    loadDictionary(localeTag('de'), catalog)
    expect(getDictionary(localeTag('de'))).toBe(catalog)
    expect(loadedLocales()).toContain(localeTag('de'))
  })

  test('a later load replaces an earlier one wholesale', () => {
    loadDictionary(localeTag('de'), { 'ui.dialog.cancel': 'Alt' })
    loadDictionary(localeTag('de'), { 'ui.dialog.cancel': 'Neu' })
    expect(getDictionary(localeTag('de'))).toEqual({ 'ui.dialog.cancel': 'Neu' })
  })

  test('English cannot be replaced', () => {
    // English is the type source and the last stop of the fallback chain; a
    // fetched dictionary must never shadow it.
    loadDictionary(DEFAULT_LOCALE, { [PROBE_KEY]: 'Nope' })
    expect(getDictionary(DEFAULT_LOCALE)?.[PROBE_KEY]).toBe(en[PROBE_KEY])
  })

  test('an unloaded locale has no dictionary', () => {
    expect(getDictionary(localeTag('fr'))).toBeUndefined()
  })

  test('resetting drops translations but keeps English', () => {
    loadDictionary(localeTag('de'), { 'ui.dialog.cancel': 'Abbrechen' })
    setLocale(localeTag('de'))
    resetI18nRuntime()
    expect(getDictionary(localeTag('de'))).toBeUndefined()
    expect(getDictionary(DEFAULT_LOCALE)?.[PROBE_KEY]).toBe(en[PROBE_KEY])
    expect(currentLocale()).toBe(DEFAULT_LOCALE)
  })
})

describe('message registration', () => {
  /**
   * The namespace boundary is only real because the runtime holds a
   * *registered* catalog rather than importing the barrel: `t()`'s English
   * fallback reads whatever the surface entry point handed over, which is how
   * `cli.*` and `help.*` stay out of the SPA bundles.
   *
   * The probe keys are deliberately in a namespace that does not exist, so the
   * entries these tests leave behind are unreachable by any `t()` call site and
   * invisible to the catalog validator (which reads `en`, not the registry).
   */
  test('a registered fragment becomes the English fallback', () => {
    const key = 'zzz.registration.probe'
    expect(englishMessage(key)).toBeUndefined()
    expect(hasEnglishMessage(key)).toBe(false)

    const before = registeredMessageCount()
    registerMessages({ [key]: 'Probe' })

    expect(englishMessage(key)).toBe('Probe')
    expect(hasEnglishMessage(key)).toBe(true)
    expect(registeredMessageCount()).toBe(before + 1)
    // The dictionary map holds the same object, so a later registration is
    // visible to everything already holding the English catalog.
    expect(getDictionary(DEFAULT_LOCALE)?.[key]).toBe('Probe')
  })

  test('registering is additive across fragments and survives a runtime reset', () => {
    registerMessages({ 'zzz.registration.first': 'First' }, { 'zzz.registration.second': 'Second' })
    resetI18nRuntime()
    expect(englishMessage('zzz.registration.first')).toBe('First')
    expect(englishMessage('zzz.registration.second')).toBe('Second')
  })
})

describe('strict mode', () => {
  test('is off unless RITUAL_I18N_STRICT is exactly 1', () => {
    const previous = process.env.RITUAL_I18N_STRICT
    try {
      delete process.env.RITUAL_I18N_STRICT
      expect(isStrictI18n()).toBe(false)
      process.env.RITUAL_I18N_STRICT = '0'
      expect(isStrictI18n()).toBe(false)
      process.env.RITUAL_I18N_STRICT = 'true'
      expect(isStrictI18n()).toBe(false)
      process.env.RITUAL_I18N_STRICT = '1'
      expect(isStrictI18n()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.RITUAL_I18N_STRICT
      else process.env.RITUAL_I18N_STRICT = previous
    }
  })
})
