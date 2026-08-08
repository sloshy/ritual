import { afterEach, describe, expect, test } from 'bun:test'
import { t, tIn, type MessageParams } from '../../../src/i18n/t'
import { loadDictionary, resetI18nRuntime } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'
import { withoutStrict, withStrict } from './strict'
/** Typed as a real params-free key so `t()`'s arity checking still applies. */
const MISSING_KEY = 'admin.doesNot.exist' as unknown as 'ui.dialog.cancel'

afterEach(() => {
  resetI18nRuntime()
})

describe('$select branches', () => {
  test('picks the branch named by the selector parameter', () => {
    expect(t('admin.list.createTitle', { listType: 'deck' })).toBe('Create New Deck')
    expect(t('admin.list.createTitle', { listType: 'collection' })).toBe('Create New Collection')
    expect(t('admin.list.createTitle', { listType: 'wanted' })).toBe('Create New Wanted List')
  })

  test('an unknown variant falls through to other', () => {
    expect(t('admin.list.createTitle', { listType: 'binder' })).toBe('Create New List')
  })

  test('a translation may supply a different branch set per language', () => {
    // The escape hatch the form exists for: a locale that needs different
    // wording per list type keeps that decision inside its own catalog.
    loadDictionary(localeTag('zz'), {
      'admin.list.createTitle': {
        $select: 'listType',
        deck: 'Neues Deck anlegen',
        other: 'Neue Liste anlegen',
      },
    })
    expect(tIn(localeTag('zz'), 'admin.list.createTitle', { listType: 'deck' })).toBe(
      'Neues Deck anlegen',
    )
    expect(tIn(localeTag('zz'), 'admin.list.createTitle', { listType: 'collection' })).toBe(
      'Neue Liste anlegen',
    )
  })

  test('branches may interpolate parameters', () => {
    loadDictionary(localeTag('zz'), {
      'admin.list.createTitle': {
        $select: 'listType',
        deck: 'New deck in {folder}',
        other: 'New list in {folder}',
      },
    })
    const params = { listType: 'deck', folder: 'decks' } as MessageParams<'admin.list.createTitle'>
    expect(tIn(localeTag('zz'), 'admin.list.createTitle', params)).toBe('New deck in decks')
  })

  test('a select table with neither the branch nor other degrades to the key', () => {
    loadDictionary(localeTag('zz'), {
      'admin.list.createTitle': { $select: 'listType', deck: 'Nur Decks' },
    })
    withoutStrict(() => {
      expect(tIn(localeTag('zz'), 'admin.list.createTitle', { listType: 'collection' })).toBe(
        'admin.list.createTitle',
      )
    })
  })

  test('a missing selector parameter falls through to other', () => {
    expect(t('admin.list.createTitle', { listType: '' })).toBe('Create New List')
  })
})

describe('strict mode', () => {
  test('an unmatched branch with no catch-all throws', () => {
    loadDictionary(localeTag('zz'), {
      'admin.list.createTitle': { $select: 'listType', deck: 'Nur Decks' },
    })
    withStrict(() => {
      expect(() => tIn(localeTag('zz'), 'admin.list.createTitle', { listType: 'binder' })).toThrow(
        /no "binder" branch/,
      )
    })
  })

  test('a deliberate other branch is not a gap', () => {
    withStrict(() => {
      expect(t('admin.list.createTitle', { listType: 'binder' })).toBe('Create New List')
    })
  })

  test('a missing key still throws first', () => {
    withStrict(() => {
      expect(() => t(MISSING_KEY)).toThrow(/missing message key/)
    })
  })
})
