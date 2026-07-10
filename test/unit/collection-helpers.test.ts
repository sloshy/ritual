import { describe, test, expect } from 'bun:test'
import { formatCollectionLine, isFinish, isCondition } from '../../src/commands/collection-helpers'
import type { Finish, Condition } from '../../src/types'

// Minimal card data for testing formatCollectionLine
function makeCard(set: string, collectorNumber: string) {
  return { set, collectorNumber }
}

describe('formatCollectionLine', () => {
  test('formats a basic nonfoil entry without condition', () => {
    const card = makeCard('neo', '123')
    const line = formatCollectionLine(
      'Farewell',
      card.set,
      card.collectorNumber,
      'nonfoil',
      undefined,
    )
    expect(line).toBe('- Farewell (NEO:123)\n')
  })

  test('includes [foil] tag for foil finish', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card.set, card.collectorNumber, 'foil', undefined)
    expect(line).toBe('- Sol Ring (LEA:232) [foil]\n')
  })

  test('includes [etched] tag for etched finish', () => {
    const card = makeCard('cmr', '1')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'etched',
      undefined,
    )
    expect(line).toBe('- Sol Ring (CMR:1) [etched]\n')
  })

  test('includes condition when provided', () => {
    const card = makeCard('lea', '206')
    const line = formatCollectionLine(
      'Lightning Bolt',
      card.set,
      card.collectorNumber,
      'nonfoil',
      'LP',
    )
    expect(line).toBe('- Lightning Bolt (LEA:206) [LP]\n')
  })

  test('includes both finish and condition', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card.set, card.collectorNumber, 'foil', 'NM')
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM]\n')
  })

  test('includes optional note', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'NM',
      'signed',
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM] {signed}\n')
  })

  test('includes card ID suffix', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'NM',
      undefined,
      5,
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM] &5\n')
  })

  test('includes both note and card ID', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'NM',
      'signed',
      42,
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM] {signed} &42\n')
  })

  test('card ID without note', () => {
    const card = makeCard('neo', '123')
    const line = formatCollectionLine(
      'Farewell',
      card.set,
      card.collectorNumber,
      'nonfoil',
      undefined,
      undefined,
      1,
    )
    expect(line).toBe('- Farewell (NEO:123) &1\n')
  })
})

describe('isFinish', () => {
  test('accepts valid finishes', () => {
    const validFinishes: Finish[] = ['nonfoil', 'foil', 'etched']
    for (const f of validFinishes) {
      expect(isFinish(f)).toBe(true)
    }
  })

  test('rejects invalid strings', () => {
    expect(isFinish('glossy')).toBe(false)
    expect(isFinish('')).toBe(false)
    expect(isFinish('Foil')).toBe(false)
    expect(isFinish('NONFOIL')).toBe(false)
  })
})

describe('isCondition', () => {
  test('accepts valid conditions', () => {
    const validConditions: Condition[] = ['NM', 'LP', 'MP', 'HP', 'DMG']
    for (const c of validConditions) {
      expect(isCondition(c)).toBe(true)
    }
  })

  test('rejects invalid strings', () => {
    expect(isCondition('nm')).toBe(false)
    expect(isCondition('')).toBe(false)
    expect(isCondition('MINT')).toBe(false)
    expect(isCondition('Near Mint')).toBe(false)
  })
})
