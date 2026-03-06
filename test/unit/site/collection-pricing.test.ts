import { describe, expect, test } from 'bun:test'
import {
  getPriceForFinish,
  resolveFinish,
  type CollectionEntry,
} from '../../../src/commands/price-collection'
import type { ScryfallCard } from '../../../src/types'

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
    const card = makeCard()
    expect(getPriceForFinish(card, 'nonfoil')).toBe(2.5)
  })

  test('returns usd_foil price for foil', () => {
    const card = makeCard()
    expect(getPriceForFinish(card, 'foil')).toBe(5.0)
  })

  test('returns usd_etched price for etched', () => {
    const card = makeCard()
    expect(getPriceForFinish(card, 'etched')).toBe(8.0)
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
    const entry = makeEntry({ finish: 'foil' })
    const card = makeCard()
    expect(resolveFinish(entry, card)).toBe('foil')
  })

  test('defaults to nonfoil if card supports it', () => {
    const entry = makeEntry()
    const card = makeCard({ finishes: ['nonfoil', 'foil'] })
    expect(resolveFinish(entry, card)).toBe('nonfoil')
  })

  test('defaults to first finish if nonfoil not available', () => {
    const entry = makeEntry()
    const card = makeCard({ finishes: ['foil'] })
    expect(resolveFinish(entry, card)).toBe('foil')
  })
})
