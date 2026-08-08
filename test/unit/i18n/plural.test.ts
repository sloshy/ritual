import { afterEach, describe, expect, test } from 'bun:test'
import { tIn } from '../../../src/i18n/t'
import { loadDictionary, resetI18nRuntime } from '../../../src/i18n/runtime'
import { localeTag } from '../../../src/i18n/locale-tag'
import { withoutStrict } from './strict'

// Synthetic catalogs only: these assert the CLDR category machinery, not the
// wording of any shipped translation.
const RU_COPIES = {
  'domain.count.copies': {
    $plural: 'count',
    one: '{count} копия',
    few: '{count} копии',
    many: '{count} копий',
    other: '{count} копии',
  },
} as const

const PL_COPIES = {
  'domain.count.copies': {
    $plural: 'count',
    one: '{count} kopia',
    few: '{count} kopie',
    many: '{count} kopii',
    other: '{count} kopii',
  },
} as const

const JA_COPIES = {
  'domain.count.copies': { $plural: 'count', other: '{count}枚' },
} as const

afterEach(() => {
  resetI18nRuntime()
})

describe('English plural selection', () => {
  test('one vs other', () => {
    expect(tIn(localeTag('en'), 'domain.count.copies', { count: 1 })).toBe('1 copy')
    expect(tIn(localeTag('en'), 'domain.count.copies', { count: 0 })).toBe('0 copies')
    expect(tIn(localeTag('en'), 'domain.count.copies', { count: 2 })).toBe('2 copies')
  })
})

describe('Russian plural selection', () => {
  test('picks one, few and many by CLDR category', () => {
    loadDictionary(localeTag('ru'), RU_COPIES)
    expect(tIn(localeTag('ru'), 'domain.count.copies', { count: 1 })).toBe('1 копия')
    expect(tIn(localeTag('ru'), 'domain.count.copies', { count: 2 })).toBe('2 копии')
    expect(tIn(localeTag('ru'), 'domain.count.copies', { count: 5 })).toBe('5 копий')
    expect(tIn(localeTag('ru'), 'domain.count.copies', { count: 21 })).toBe('21 копия')
  })

  test('a category the catalog omits falls through to other', () => {
    // A partially filled plural table still renders — the catalog validator is
    // where a missing category is reported, not the render path.
    loadDictionary(localeTag('ru'), {
      'domain.count.copies': { $plural: 'count', one: '{count} копия', other: '{count} копии' },
    })
    expect(tIn(localeTag('ru'), 'domain.count.copies', { count: 5 })).toBe('5 копии')
  })
})

describe('Polish plural selection', () => {
  test('picks one, few and many by CLDR category', () => {
    loadDictionary(localeTag('pl'), PL_COPIES)
    expect(tIn(localeTag('pl'), 'domain.count.copies', { count: 1 })).toBe('1 kopia')
    expect(tIn(localeTag('pl'), 'domain.count.copies', { count: 3 })).toBe('3 kopie')
    expect(tIn(localeTag('pl'), 'domain.count.copies', { count: 5 })).toBe('5 kopii')
  })
})

describe('Japanese plural selection', () => {
  test('an other-only catalog is complete', () => {
    loadDictionary(localeTag('ja'), JA_COPIES)
    for (const count of [0, 1, 2, 5, 100]) {
      expect(tIn(localeTag('ja'), 'domain.count.copies', { count })).toBe(`${count}枚`)
    }
  })
})

describe('non-numeric counts', () => {
  test('a numeric string still selects a category', () => {
    expect(tIn(localeTag('en'), 'domain.count.copies', { count: '1' })).toBe('1 copy')
  })

  test('an unusable count degrades to other instead of throwing', () => {
    withoutStrict(() => {
      expect(tIn(localeTag('en'), 'domain.count.copies', { count: 'many' })).toBe('many copies')
    })
  })
})
