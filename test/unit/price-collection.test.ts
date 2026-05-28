import { describe, expect, test } from 'bun:test'
import {
  getPriceForFinish,
  parseCollectionFile,
  resolveFinish,
  type CollectionEntry,
} from '../../src/commands/price-collection'
import type { ScryfallCard } from '../../src/types'

describe('parseCollectionFile', () => {
  test('parses card with set and collector number', () => {
    const content = `# My Collection\n\n- Arcane Signet (ECC:55)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arcane Signet')
    expect(entries[0]!.set).toBe('ecc')
    expect(entries[0]!.collectorNumber).toBe('55')
    expect(entries[0]!.quantity).toBe(1)
    expect(warnings).toHaveLength(0)
  })

  test('warns and skips cards missing set code', () => {
    const content = `- Bitterbloom Bearer\n- Jeska's Will (CLB:799)\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe("Jeska's Will")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Bitterbloom Bearer')
    expect(warnings[0]).toContain('missing set code')
  })

  test('parses card with finish and condition', () => {
    const content = `- Arahbo, the First Fang (FDN:2) [foil] [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Arahbo, the First Fang')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
  })

  test('parses condition without finish', () => {
    const content = `- Adeline, Resplendent Cathar (MID:1) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Adeline, Resplendent Cathar')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBe('NM')
  })

  test('does not aggregate duplicates — each line is a separate entry', () => {
    const content = `- Sol Ring (C19:221)\n- Sol Ring (MH3:300)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.set).toBe('c19')
    expect(entries[1]!.set).toBe('mh3')
  })

  test('handles double-faced card names', () => {
    const content = `- Elesh Norn // The Argent Etchings (MOM:12) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Elesh Norn // The Argent Etchings')
  })

  test('skips non-card lines', () => {
    const content = `# Header\n\nSome text\n- Actual Card (SET:1)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Actual Card')
  })

  test('handles collector numbers with letters', () => {
    const content = `- Nomad Mythmaker (PLST:10E-30) [NM]\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.collectorNumber).toBe('10E-30')
  })

  test('handles collector numbers with special characters', () => {
    const content = `- Serpent of Yawning Depths (SLD:1489★) [foil] [NM]\n`
    const { entries, warnings } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Serpent of Yawning Depths')
    expect(entries[0]!.set).toBe('sld')
    expect(entries[0]!.collectorNumber).toBe('1489★')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(warnings).toHaveLength(0)
  })

  test('parses card with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {Japanese language, ignore pricing}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Mana Crypt')
    expect(entries[0]!.finish).toBe('foil')
    expect(entries[0]!.condition).toBe('NM')
    expect(entries[0]!.note).toBe('Japanese language, ignore pricing')
  })

  test('parses card with note but no finish or condition', () => {
    const content = `- Sol Ring (C19:221) {Signed by artist}\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.finish).toBeUndefined()
    expect(entries[0]!.condition).toBeUndefined()
    expect(entries[0]!.note).toBe('Signed by artist')
  })

  test('card without note has undefined note field', () => {
    const content = `- Arcane Signet (ECC:55)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBeUndefined()
  })

  test('parses card ID suffix', () => {
    const content = `- Sol Ring (C19:221) [foil] [NM] &5\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.name).toBe('Sol Ring')
    expect(entries[0]!.cardId).toBe(5)
  })

  test('parses card ID with note', () => {
    const content = `- Mana Crypt (2XM:270) [foil] [NM] {JP} &12\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.note).toBe('JP')
    expect(entries[0]!.cardId).toBe(12)
  })

  test('parses card ID without finish or condition', () => {
    const content = `- Arcane Signet (ECC:55) &1\n`
    const { entries } = parseCollectionFile(content)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.cardId).toBe(1)
  })

  test('entry without card ID has undefined cardId', () => {
    const content = `- Arcane Signet (ECC:55)\n`
    const { entries } = parseCollectionFile(content)
    expect(entries[0]!.cardId).toBeUndefined()
  })
})

function makeCard(overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 3,
    mana_cost: '{2}{W}',
    type_line: 'Creature — Human',
    prices: {
      usd: '2.50',
      usd_foil: '5.00',
      usd_etched: '8.00',
      eur: null,
      eur_foil: null,
      tix: null,
    },
    finishes: ['nonfoil', 'foil'],
    games: ['paper'],
    set: 'FDN',
    set_name: 'Foundation',
    collector_number: '1',
    rarity: 'rare',
    color_identity: [],
    ...overrides,
  }
}

function makeEntry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  return {
    name: 'Test Card',
    quantity: 1,
    set: 'FDN',
    collectorNumber: '1',
    ...overrides,
  }
}

describe('getPriceForFinish', () => {
  test('returns usd price for nonfoil', () => {
    expect(getPriceForFinish(makeCard(), 'nonfoil')).toBe(2.5)
  })

  test('returns usd_foil price for foil', () => {
    expect(getPriceForFinish(makeCard(), 'foil')).toBe(5.0)
  })

  test('returns usd_etched price for etched', () => {
    expect(getPriceForFinish(makeCard(), 'etched')).toBe(8.0)
  })

  test('returns 0 when price is null', () => {
    const card = makeCard({
      prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    })
    expect(getPriceForFinish(card, 'nonfoil')).toBe(0)
  })
})

describe('resolveFinish', () => {
  test('uses entry finish if specified', () => {
    expect(resolveFinish(makeEntry({ finish: 'foil' }), makeCard())).toBe('foil')
  })

  test('defaults to nonfoil if card supports it', () => {
    expect(resolveFinish(makeEntry(), makeCard({ finishes: ['nonfoil', 'foil'] }))).toBe('nonfoil')
  })

  test('defaults to first finish if nonfoil not available', () => {
    expect(resolveFinish(makeEntry(), makeCard({ finishes: ['foil'] }))).toBe('foil')
  })
})
