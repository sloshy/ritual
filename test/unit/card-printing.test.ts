import { describe, test, expect } from 'bun:test'
import {
  dedupePrintingsByKey,
  findPrinting,
  hasSpecificPrinting,
  printingLanguages,
  printingsAreComplete,
} from '../../src/card-printing'
import { makePrintingIn as printing } from '../test-utils'

const LEA = printing('lea', '161')
const M10 = printing('m10', '146')
const CLB_ETCHED = printing('clb', '507a')
const PRINTINGS = [LEA, M10, printing('2x2', '117'), CLB_ETCHED]

describe('findPrinting', () => {
  test('matches by set (case-insensitive) and collector number', () => {
    expect(findPrinting(PRINTINGS, 'M10', '146')).toBe(M10)
    expect(findPrinting(PRINTINGS, 'lea', '161')).toBe(LEA)
  })

  test('matches a collector number case-insensitively too', () => {
    // A collector number is a pinned identifier, not display text: a line written
    // `(CLB:507A)` names the printing the cache holds as `507a`. The collection
    // sync's own join key compares them the same way, so a stricter comparison
    // here would drop such a line out of a CSV upload and report it as missing
    // from a cache that holds it.
    expect(findPrinting(PRINTINGS, 'clb', '507A')).toBe(CLB_ETCHED)
    expect(findPrinting(PRINTINGS, 'CLB', '507a')).toBe(CLB_ETCHED)
  })

  test('returns undefined when no printing matches', () => {
    expect(findPrinting(PRINTINGS, 'lea', '999')).toBeUndefined()
    expect(findPrinting(PRINTINGS, 'xyz', '146')).toBeUndefined()
  })

  test('returns undefined when the printings list is missing', () => {
    expect(findPrinting(undefined, 'lea', '161')).toBeUndefined()
  })

  test('returns undefined when set or collector number is absent', () => {
    expect(findPrinting(PRINTINGS, undefined, '161')).toBeUndefined()
    expect(findPrinting(PRINTINGS, 'lea', undefined)).toBeUndefined()
  })
})

describe('findPrinting language awareness', () => {
  const NEO_EN = printing('neo', '234', 'en')
  const NEO_JA = printing('neo', '234', 'ja')
  const NEO_BARE = printing('neo', '235') // no lang field: treated as en
  const STA_JA_ONLY = printing('sta', '1', 'ja')
  const MULTILANG = [NEO_EN, NEO_JA, NEO_BARE, STA_JA_ONLY]

  test('selects the card object in the requested language', () => {
    expect(findPrinting(MULTILANG, 'neo', '234', 'ja')).toBe(NEO_JA)
    expect(findPrinting(MULTILANG, 'neo', '234', 'en')).toBe(NEO_EN)
  })

  test('a missing language means en, and a card object with no lang counts as en', () => {
    // Bare call (no language) keeps the pre-language behavior of picking the
    // English object, and a lang-less object satisfies an explicit en request.
    expect(findPrinting(MULTILANG, 'neo', '234')).toBe(NEO_EN)
    expect(findPrinting(MULTILANG, 'neo', '235', 'en')).toBe(NEO_BARE)
    expect(findPrinting(MULTILANG, 'neo', '235')).toBe(NEO_BARE)
  })

  test('falls back to the en object when the requested language is not cached', () => {
    // The English object is the printing's default one — prices and images
    // live there — so a [ko] line on an en-only cache still resolves.
    expect(findPrinting(MULTILANG, 'neo', '234', 'ko')).toBe(NEO_EN)
    expect(findPrinting(MULTILANG, 'neo', '235', 'ja')).toBe(NEO_BARE)
  })

  test('falls back to the only cached object when neither the requested language nor en exists', () => {
    expect(findPrinting(MULTILANG, 'sta', '1', 'ko')).toBe(STA_JA_ONLY)
    expect(findPrinting(MULTILANG, 'sta', '1')).toBe(STA_JA_ONLY)
  })
})

describe('printingLanguages', () => {
  const MULTILANG = [
    printing('neo', '234', 'ja'),
    printing('neo', '234', 'en'),
    printing('neo', '234', 'ja'), // duplicate language: deduped
    printing('neo', '235'), // no lang: counts as en
    printing('m10', '146', 'de'),
  ]

  test('lists the languages cached for one set:cn, deduped, in canonical order', () => {
    // en before ja regardless of cache order (CARD_LANGUAGES order).
    expect(printingLanguages(MULTILANG, 'neo', '234')).toEqual(['en', 'ja'])
  })

  test('a card object with no lang counts as en', () => {
    expect(printingLanguages(MULTILANG, 'neo', '235')).toEqual(['en'])
  })

  test('matches set and collector number case-insensitively', () => {
    expect(printingLanguages(MULTILANG, 'NEO', '234')).toEqual(['en', 'ja'])
  })

  test('empty for an unknown printing or missing inputs', () => {
    expect(printingLanguages(MULTILANG, 'neo', '999')).toEqual([])
    expect(printingLanguages(undefined, 'neo', '234')).toEqual([])
    expect(printingLanguages(MULTILANG, undefined, '234')).toEqual([])
    expect(printingLanguages(MULTILANG, 'neo', undefined)).toEqual([])
  })
})

describe('dedupePrintingsByKey', () => {
  const STA_EN = printing('sta', '42', 'en')
  const STA_JA = printing('sta', '42', 'ja')
  const WAR_JA_ONLY = printing('war', '76★', 'ja')

  test('collapses per-language objects to one row per set:cn, preferring the en object', () => {
    // ja listed first: the en object must still win the slot.
    expect(dedupePrintingsByKey([STA_JA, STA_EN, LEA])).toEqual([STA_EN, LEA])
  })

  test('keeps one row per set:cn across several printings, en preferred', () => {
    expect(dedupePrintingsByKey([LEA, STA_JA, STA_EN, WAR_JA_ONLY])).toEqual([
      LEA,
      STA_EN,
      WAR_JA_ONLY,
    ])
  })

  test('keeps a printing that only exists in a non-en language', () => {
    expect(dedupePrintingsByKey([WAR_JA_ONLY])).toEqual([WAR_JA_ONLY])
  })

  test('preserves first-appearance order of printings (Map insertion order)', () => {
    expect(dedupePrintingsByKey([STA_JA, LEA, STA_EN])).toEqual([STA_EN, LEA])
  })
})

describe('hasSpecificPrinting', () => {
  test('true only when both set and collector number are present', () => {
    expect(hasSpecificPrinting({ set: 'lea', collectorNumber: '161' })).toBe(true)
    expect(hasSpecificPrinting({ set: 'lea' })).toBe(false)
    expect(hasSpecificPrinting({ collectorNumber: '161' })).toBe(false)
    expect(hasSpecificPrinting({})).toBe(false)
  })

  test('treats empty strings as not a specific printing', () => {
    expect(hasSpecificPrinting({ set: '', collectorNumber: '161' })).toBe(false)
    expect(hasSpecificPrinting({ set: 'lea', collectorNumber: '' })).toBe(false)
  })

  test('narrows set and collector number to defined when used as a type guard', () => {
    const entry: { set?: string; collectorNumber?: string } = { set: 'lea', collectorNumber: '161' }
    if (hasSpecificPrinting(entry)) {
      // Type guard narrows both fields to `string`; this must compile without `!`.
      const key: string = `${entry.set.toUpperCase()}:${entry.collectorNumber}`
      expect(key).toBe('LEA:161')
    } else {
      throw new Error('expected hasSpecificPrinting to be true')
    }
  })
})

describe('printingsAreComplete', () => {
  test('only a bulk-backed cache list may be read as the card\u2019s whole printing set', () => {
    const printings = [printing('lea', '161')]

    expect(printingsAreComplete({ printings, source: 'complete' })).toBe(true)
    // One printing from a fallback fetch is not "this card has one printing".
    expect(printingsAreComplete({ printings, source: 'partial' })).toBe(false)
    expect(printingsAreComplete({ printings: [], source: 'none' })).toBe(false)
  })
})
