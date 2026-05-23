import { describe, test, expect } from 'bun:test'
import { findPrinting } from '../../src/card-printing'
import type { ScryfallCard } from '../../src/types'

function printing(set: string, collectorNumber: string): ScryfallCard {
  return {
    id: `${set}-${collectorNumber}`,
    name: 'Lightning Bolt',
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    cmc: 1,
    type_line: 'Instant',
    rarity: 'common',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil'],
    games: ['paper'],
    color_identity: ['R'],
  }
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
