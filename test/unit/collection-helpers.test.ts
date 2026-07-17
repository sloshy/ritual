import { describe, test, expect } from 'bun:test'
import {
  formatCollectionLine,
  isFinish,
  isCondition,
  matchFinishPin,
  matchPrintingPin,
  printingFinishes,
} from '../../src/commands/collection-helpers'
import type { Finish, Condition, ScryfallCard } from '../../src/types'

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
    const line = formatCollectionLine('Sol Ring', card.set, card.collectorNumber, 'foil', 'LP')
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP]\n')
  })

  test('omits the default NM condition', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine('Sol Ring', card.set, card.collectorNumber, 'foil', 'NM')
    expect(line).toBe('- Sol Ring (LEA:232) [foil]\n')
  })

  test('includes optional note', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'LP',
      'signed',
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] {signed}\n')
  })

  test('includes card ID suffix', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'LP',
      undefined,
      5,
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] &5\n')
  })

  test('includes both note and card ID', () => {
    const card = makeCard('lea', '232')
    const line = formatCollectionLine(
      'Sol Ring',
      card.set,
      card.collectorNumber,
      'foil',
      'LP',
      'signed',
      42,
    )
    expect(line).toBe('- Sol Ring (LEA:232) [foil] [LP] {signed} &42\n')
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

// ── Strict printing/finish pin matching ───────────────────────────────────────

function makePrinting(
  set: string,
  collectorNumber: string,
  finishes: string[] = ['nonfoil'],
): ScryfallCard {
  return {
    id: `id-${set}-${collectorNumber}`,
    name: 'Test Card',
    cmc: 1,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes,
    games: ['paper'],
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    rarity: 'rare',
    color_identity: [],
  }
}

describe('matchPrintingPin', () => {
  const printings = [makePrinting('lea', '161'), makePrinting('sta', '42')]

  test('matches an existing printing', () => {
    const result = matchPrintingPin('Test Card', printings, 'sta', '42')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.printing.set).toBe('sta')
  })

  test('matches set codes case-insensitively', () => {
    const upper = [makePrinting('LEA', '161')]
    const result = matchPrintingPin('Test Card', upper, 'lea', '161')
    expect(result.ok).toBe(true)
  })

  test('rejects an unknown set/collector-number pair with the available printings', () => {
    const result = matchPrintingPin('Test Card', printings, 'lea', '999')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('LEA:999')
    expect(result.message).toContain('LEA:161')
    expect(result.message).toContain('STA:42')
    expect(result.available).toEqual([
      { set: 'lea', collectorNumber: '161' },
      { set: 'sta', collectorNumber: '42' },
    ])
    expect(result.totalPrintings).toBe(2)
  })

  test('collector numbers must match exactly (no prefix matching)', () => {
    const result = matchPrintingPin('Test Card', printings, 'lea', '16')
    expect(result.ok).toBe(false)
  })

  test('lists at most 10 printings and reports the remainder count', () => {
    const many = Array.from({ length: 13 }, (_, i) => makePrinting('set', String(i + 1)))
    const result = matchPrintingPin('Test Card', many, 'set', '999')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.available).toHaveLength(10)
    expect(result.totalPrintings).toBe(13)
    expect(result.message).toContain('and 3 more')
  })

  test('reports an empty printing list distinctly', () => {
    const result = matchPrintingPin('Test Card', [], 'lea', '161')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('No printings')
    expect(result.available).toEqual([])
    expect(result.totalPrintings).toBe(0)
  })
})

describe('printingFinishes', () => {
  test('returns the valid finishes of a printing', () => {
    expect(printingFinishes(makePrinting('lea', '1', ['nonfoil', 'foil']))).toEqual([
      'nonfoil',
      'foil',
    ])
  })

  test('filters out unknown finish strings', () => {
    expect(printingFinishes(makePrinting('lea', '1', ['nonfoil', 'glossy']))).toEqual(['nonfoil'])
  })

  test('falls back to nonfoil when no usable finish data exists', () => {
    expect(printingFinishes(makePrinting('lea', '1', []))).toEqual(['nonfoil'])
  })
})

describe('matchFinishPin', () => {
  test('accepts a finish the printing offers', () => {
    const result = matchFinishPin(
      'Test Card',
      makePrinting('sta', '42', ['nonfoil', 'foil']),
      'foil',
    )
    expect(result.ok).toBe(true)
  })

  test('rejects a finish the printing does not offer, listing the available ones', () => {
    const result = matchFinishPin('Test Card', makePrinting('lea', '161', ['nonfoil']), 'etched')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('LEA:161')
    expect(result.message).toContain('etched')
    expect(result.message).toContain('nonfoil')
    expect(result.available).toEqual(['nonfoil'])
  })

  test('treats missing finish data as nonfoil-only', () => {
    const result = matchFinishPin('Test Card', makePrinting('lea', '161', []), 'nonfoil')
    expect(result.ok).toBe(true)
    const foil = matchFinishPin('Test Card', makePrinting('lea', '161', []), 'foil')
    expect(foil.ok).toBe(false)
  })
})
