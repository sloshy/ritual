import { describe, test, expect } from 'bun:test'
import { findPrinting, hasSpecificPrinting } from '../../src/card-printing'
import type { ScryfallCard } from '../../src/types'
import { makeScryfallCard } from '../test-utils'

function printing(set: string, collectorNumber: string): ScryfallCard {
  return makeScryfallCard({
    id: `${set}-${collectorNumber}`,
    name: 'Lightning Bolt',
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
  })
}

const LEA = printing('lea', '161')
const M10 = printing('m10', '146')
const PRINTINGS = [LEA, M10, printing('2x2', '117')]

describe('findPrinting', () => {
  test('matches by set (case-insensitive) and collector number', () => {
    expect(findPrinting(PRINTINGS, 'M10', '146')).toBe(M10)
    expect(findPrinting(PRINTINGS, 'lea', '161')).toBe(LEA)
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
