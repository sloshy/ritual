import { describe, test, expect } from 'bun:test'
import {
  finishChoices,
  finishRows,
  formatCollectionLine,
  isFinish,
  isCondition,
  matchFinishPin,
  matchPrintingPin,
  printingChoices,
} from '../../src/commands/collection-helpers'
import type { Finish, Condition, ScryfallCard } from '../../src/types'
import { makeScryfallCard } from '../test-utils'

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
  return makeScryfallCard({
    id: `id-${set}-${collectorNumber}`,
    set,
    set_name: set.toUpperCase(),
    collector_number: collectorNumber,
    rarity: 'rare',
    finishes,
  })
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

// ── Picker titles ─────────────────────────────────────────────────────────────

describe('printingChoices', () => {
  test('prices each printing at its default finish, in one aligned column', () => {
    const nonfoil = makeScryfallCard({
      set: 'lea',
      set_name: 'Limited Edition Alpha',
      collector_number: '161',
      rarity: 'common',
      finishes: ['nonfoil', 'foil'],
      prices: { usd: '3.00', usd_foil: '25.00' },
    })
    const etchedOnly = makeScryfallCard({
      set: 'cmr',
      set_name: 'Commander Legends',
      collector_number: '472',
      rarity: 'mythic',
      finishes: ['etched'],
      prices: { usd_etched: '14.99' },
    })
    expect(printingChoices([nonfoil, etchedOnly], 'usd')).toEqual([
      { title: 'Limited Edition Alpha (LEA) #161 [common]  $3.00', value: nonfoil },
      { title: 'Commander Legends (CMR) #472 [mythic]      $14.99 etched', value: etchedOnly },
    ])
  })

  test('prices in the given currency, showing N/A where it has none', () => {
    const card = makeScryfallCard({
      set: 'neo',
      set_name: 'Kamigawa',
      collector_number: '1',
      rarity: 'rare',
      prices: { usd: '3.00' },
    })
    expect(printingChoices([card], 'eur').map((c) => c.title)).toEqual([
      'Kamigawa (NEO) #1 [rare]  N/A',
    ])
  })
})

describe('finishChoices', () => {
  const card = makeScryfallCard({ prices: { usd: '1.00', usd_foil: '4.50' } })

  test('prices each finish and leaves a finishless row bare, keeping each row value', () => {
    expect(
      finishChoices<string>(
        [
          { label: 'No preference (any finish)', value: '__NONE__' },
          ...finishRows(['nonfoil', 'foil']),
        ],
        card,
        'usd',
      ),
    ).toEqual([
      { title: 'No preference (any finish)', value: '__NONE__' },
      { title: 'Nonfoil  $1.00', value: 'nonfoil' },
      { title: 'Foil     $4.50', value: 'foil' },
    ])
  })

  test('omits the price column entirely when the printing is unknown', () => {
    expect(
      finishChoices([{ label: 'Foil', finish: 'foil', value: 'foil' }], undefined, 'usd').map(
        (c) => c.title,
      ),
    ).toEqual(['Foil'])
  })
})
