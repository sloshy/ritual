import { afterEach, describe, expect, test } from 'bun:test'
import { t, tIn, tSegments, isMessageKey } from '../../../src/i18n/t'
import type { MessageSegment } from '../../../src/i18n/types'
import { localeTag } from '../../../src/i18n/locale-tag-message'
import {
  currentLocale,
  loadDictionary,
  resetI18nRuntime,
  setLocale,
  type LocaleOverride,
} from '../../../src/i18n/runtime'
import { withoutStrict, withStrict } from './strict'
const overrideHost = globalThis as unknown as LocaleOverride

/**
 * A key that deliberately does not exist, for the end of the fallback chain.
 * Typed as a real params-free key so `t()`'s arity checking still applies —
 * `MessageKey` itself would widen to "some message needs params".
 */
const MISSING_KEY = 'cli.doesNot.exist' as unknown as 'ui.dialog.cancel'

/**
 * A synthetic three-parameter plural, for the `tSegments` ordering cases.
 *
 * Deliberately not a shipped key: those tests pin exact English word order, and
 * borrowing a real message would make an ordinary catalog edit fail them.
 * `loadDictionary` supplies the text; the cast only satisfies `t()`'s
 * parameter checking, which keys off the literal.
 */
const SEGMENT_KEY = 'cli.fixture.added' as unknown as 'cli.addCard.matchCount'
const SEGMENT_FORMS = {
  $plural: 'count',
  one: 'Added {count} copy of {name} to {list}.',
  other: 'Added {count} copies of {name} to {list}.',
} as const
type SegmentParams = { count: number; name: string; list: string }

afterEach(() => {
  delete overrideHost.__ritualLocale__
  resetI18nRuntime()
})

describe('interpolation', () => {
  test('renders a message with no parameters verbatim', () => {
    expect(t('ui.dialog.cancel')).toBe('Cancel')
  })

  test('substitutes named parameters', () => {
    expect(t('ui.quantity.ofTotal', { total: 4 })).toBe('of 4')
  })

  test('coerces numeric parameters to strings without formatting them', () => {
    // Locale-aware number formatting is `format.ts`'s job and must be applied by
    // the caller, so a raw number never picks up a thousands separator here.
    expect(t('domain.count.copies', { count: 1000 })).toBe('1000 copies')
  })

  test('substitutes a repeated placeholder at every occurrence', () => {
    loadDictionary(localeTag('zz'), { 'ui.quantity.ofTotal': '{total} / {total}' })
    expect(tIn(localeTag('zz'), 'ui.quantity.ofTotal', { total: 4 })).toBe('4 / 4')
  })

  test('leaves an unmatched placeholder visible rather than rendering undefined', () => {
    // Only reachable from a translation carrying a placeholder English does not
    // (the catalog validator rejects that); degrading must never print "undefined".
    loadDictionary(localeTag('zz'), { 'ui.dialog.cancel': 'Cancel {unexpected}' })
    withoutStrict(() => {
      expect(tIn(localeTag('zz'), 'ui.dialog.cancel')).toBe('Cancel {unexpected}')
    })
  })
})

describe('the fallback chain', () => {
  test('prefers the active locale', () => {
    loadDictionary(localeTag('zz'), { 'ui.dialog.cancel': 'Abbrechen' })
    setLocale(localeTag('zz'))
    expect(currentLocale()).toBe(localeTag('zz'))
    expect(t('ui.dialog.cancel')).toBe('Abbrechen')
  })

  test('falls back to English for a key the locale does not translate', () => {
    // A partially translated locale must stay shippable: gaps render English,
    // never a raw key.
    loadDictionary(localeTag('zz'), { 'ui.dialog.done': 'Fertig' })
    setLocale(localeTag('zz'))
    expect(t('ui.dialog.cancel')).toBe('Cancel')
    expect(t('ui.dialog.done')).toBe('Fertig')
  })

  test('falls back to the key itself when nothing has it', () => {
    withoutStrict(() => {
      expect(t(MISSING_KEY)).toBe(MISSING_KEY)
    })
  })

  test('English fallback text uses English plural rules', () => {
    // The resolving locale drives plural selection, so English fallback text
    // under a locale with different categories still selects sensibly.
    loadDictionary(localeTag('ru'), {})
    setLocale(localeTag('ru'))
    expect(t('domain.count.copies', { count: 1 })).toBe('1 copy')
    expect(t('domain.count.copies', { count: 5 })).toBe('5 copies')
    // 21 is the count that actually discriminates: Russian's rules select
    // `one` for it (giving the ungrammatical "21 copy"), English's select
    // `other`. The two rows above agree either way, so this is what pins the
    // property — `resolve()` returning the *resolving* locale, not the active
    // one, is what `selectForm` keys off.
    expect(t('domain.count.copies', { count: 21 })).toBe('21 copies')
  })

  test('the global test seam beats the applied locale', () => {
    loadDictionary(localeTag('zz'), { 'ui.dialog.cancel': 'Abbrechen' })
    setLocale(localeTag('zz'))
    overrideHost.__ritualLocale__ = 'en'
    expect(t('ui.dialog.cancel')).toBe('Cancel')
  })
})

describe('strict mode', () => {
  test('each failure is worded through its errors.i18n.strict key, inside the frame', () => {
    loadDictionary(localeTag('zz'), {
      'ui.dialog.cancel': 'Cancel {unexpected}',
      'domain.count.copies': { $plural: 'count', other: '{count} Kopien' },
      'admin.list.createTitle': { $select: 'listType', deck: 'Nur Decks' },
    })
    withStrict(() => {
      expect(() => t(MISSING_KEY)).toThrow(
        `i18n: missing message key "${MISSING_KEY}" — is its namespace registered? (RITUAL_I18N_STRICT=1)`,
      )
      expect(() => tIn(localeTag('zz'), 'ui.dialog.cancel')).toThrow(
        'i18n: message "ui.dialog.cancel" is missing the "unexpected" param (RITUAL_I18N_STRICT=1)',
      )
      expect(() => tIn(localeTag('zz'), 'domain.count.copies', { count: 'many' })).toThrow(
        'i18n: message "domain.count.copies" needs a numeric "count" param (RITUAL_I18N_STRICT=1)',
      )
      expect(() => tIn(localeTag('zz'), 'admin.list.createTitle', { listType: 'binder' })).toThrow(
        'i18n: message "admin.list.createTitle" has no "binder" branch for "listType" (RITUAL_I18N_STRICT=1)',
      )
    })
  })

  test('the diagnostic is rendered in the failing render’s locale', () => {
    loadDictionary(localeTag('zz'), {
      'errors.i18n.strict.frame': 'STRENG: {reason}',
      'errors.i18n.strict.missingKey': 'kein Schlüssel {key}',
    })
    withStrict(() => {
      expect(() => tIn(localeTag('zz'), MISSING_KEY)).toThrow(
        `STRENG: kein Schlüssel ${MISSING_KEY}`,
      )
    })
  })

  test('a diagnostic that itself fails to render degrades instead of recursing', () => {
    // Every way a diagnostic could fail strict checks at once: a translated
    // reason with a placeholder no caller fills, and a frame with one too. With
    // strict checks re-applied to the diagnostic, rendering it would throw
    // again — from inside the throw — and never terminate.
    loadDictionary(localeTag('zz'), {
      'errors.i18n.strict.frame': '{reason} / {frameOnly}',
      'errors.i18n.strict.missingKey': 'kaputt {key} {nope}',
    })
    withStrict(() => {
      let thrown: unknown
      try {
        tIn(localeTag('zz'), MISSING_KEY)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(Error)
      // The gaps stay visible as tokens, exactly as a non-strict render leaves them.
      expect((thrown as Error).message).toBe(`kaputt ${MISSING_KEY} {nope} / {frameOnly}`)
    })
  })
})

/** {@link tSegments} against {@link SEGMENT_KEY}, whose params the cast erased. */
function segmentsFor(params: SegmentParams): MessageSegment[] {
  return tSegments(SEGMENT_KEY, params as never)
}

describe('tSegments', () => {
  test('keeps a parameter at the start of the sentence addressable', () => {
    loadDictionary(localeTag('zz'), { 'ui.quantity.ofTotal': '{total} total' })
    setLocale(localeTag('zz'))
    expect(tSegments('ui.quantity.ofTotal', { total: 4 })).toEqual([
      { kind: 'param', name: 'total', value: '4' },
      { kind: 'text', value: ' total' },
    ])
  })

  test('keeps a parameter in the middle addressable', () => {
    loadDictionary(localeTag('zz'), { [SEGMENT_KEY]: SEGMENT_FORMS })
    setLocale(localeTag('zz'))
    expect(segmentsFor({ count: 1, name: 'Sol Ring', list: 'Ramp' })).toEqual([
      { kind: 'text', value: 'Added ' },
      { kind: 'param', name: 'count', value: '1' },
      { kind: 'text', value: ' copy of ' },
      { kind: 'param', name: 'name', value: 'Sol Ring' },
      { kind: 'text', value: ' to ' },
      { kind: 'param', name: 'list', value: 'Ramp' },
      { kind: 'text', value: '.' },
    ])
  })

  test('keeps a parameter at the end addressable', () => {
    expect(tSegments('ui.quantity.ofTotal', { total: 4 })).toEqual([
      { kind: 'text', value: 'of ' },
      { kind: 'param', name: 'total', value: '4' },
    ])
  })

  test('the translator may reorder segments freely', () => {
    // Word order is the whole point of named placeholders: an SOV translation
    // moves the parameters and the renderer follows.
    loadDictionary(localeTag('zz'), { [SEGMENT_KEY]: '{list} ni {name} wo {count} tsuika.' })
    setLocale(localeTag('zz'))
    const segments = segmentsFor({ count: 1, name: 'Sol Ring', list: 'Ramp' })
    expect(segments.filter((s) => s.kind === 'param').map((s) => s.name)).toEqual([
      'list',
      'name',
      'count',
    ])
  })

  test('joining segments equals t()', () => {
    loadDictionary(localeTag('zz'), { [SEGMENT_KEY]: SEGMENT_FORMS })
    setLocale(localeTag('zz'))
    const params: SegmentParams = { count: 2, name: 'Sol Ring', list: 'Ramp' }
    const joined = segmentsFor(params)
      .map((segment) => segment.value)
      .join('')
    expect(joined).toBe(t(SEGMENT_KEY, params as never))
  })
})

describe('isMessageKey', () => {
  test('accepts a real key and rejects anything else', () => {
    expect(isMessageKey('ui.dialog.cancel')).toBe(true)
    expect(isMessageKey(MISSING_KEY)).toBe(false)
    expect(isMessageKey(undefined)).toBe(false)
    // Inherited Object.prototype members must not read as keys.
    expect(isMessageKey('toString')).toBe(false)
  })
})
