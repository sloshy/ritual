import { describe, test, expect } from 'bun:test'
import { formatCollectionLine, isFinish, isCondition } from '../../src/commands/collection-helpers'
import type { Finish, Condition } from '../../src/types'

// Minimal ScryfallCard stub for testing formatCollectionLine
function makeCard(set: string, collectorNumber: string) {
  return {
    id: 'stub',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil', 'foil'] as string[],
    games: ['paper'],
    set,
    set_name: 'Test Set',
    collector_number: collectorNumber,
    rarity: 'uncommon',
    color_identity: [],
  }
}

describe('formatCollectionLine', () => {
  test('formats a basic nonfoil entry without condition', () => {
    const card = makeCard('neo', '123')
    const line = formatCollectionLine('Farewell', card, 'nonfoil', undefined)
    expect(line).toBe('- Farewell (NEO:123)\n')
  })

  test('omits [nonfoil] tag (nonfoil is the default)', () => {
    const card = makeCard('mrd', '215')
    const line = formatCollectionLine('Skullclamp', card, 'nonfoil', undefined)
    expect(line).not.toContain('[nonfoil]')
  })

  test('includes [foil] tag for foil finish', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card, 'foil', undefined)
    expect(line).toBe('- Sol Ring (LEA:232) [foil]\n')
  })

  test('includes [etched] tag for etched finish', () => {
    const card = makeCard('cmr', '1')
    const line = formatCollectionLine('Sol Ring', card, 'etched', undefined)
    expect(line).toBe('- Sol Ring (CMR:1) [etched]\n')
  })

  test('includes condition when provided', () => {
    const card = makeCard('lea', '206')
    const line = formatCollectionLine('Lightning Bolt', card, 'nonfoil', 'LP')
    expect(line).toBe('- Lightning Bolt (LEA:206) [LP]\n')
  })

  test('includes both finish and condition', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card, 'foil', 'NM')
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM]\n')
  })

  test('omits condition when undefined', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card, 'nonfoil', undefined)
    expect(line).not.toContain('[NM]')
    expect(line).not.toContain('[undefined]')
  })

  test('includes optional note', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card, 'foil', 'NM', 'signed')
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [NM] {signed}\n')
  })

  test('set code is uppercased', () => {
    const card = makeCard('mh2', '100')
    const line = formatCollectionLine('Dragon', card, 'nonfoil', undefined)
    expect(line).toContain('(MH2:100)')
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
