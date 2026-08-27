import { describe, expect, test } from 'bun:test'
import {
  emptySiteCardData,
  pickDisplayPrintings,
  recordDisplayPrintings,
} from '../../../src/site-build/card-fetch'
import { ckRetailQuote, makeScryfallCard } from '../../test-utils'

/**
 * The one rule for which printings a name-only line displays, shared by
 * `build-site` and the live server. Pinned here so the two can never drift.
 */
const boltNew = makeScryfallCard({
  id: 'bolt-new',
  name: 'Lightning Bolt',
  set: 'm10',
  collector_number: '146',
  released_at: '2009-07-17',
  prices: { usd: '2.00' },
})
const boltOld = makeScryfallCard({
  id: 'bolt-old',
  name: 'Lightning Bolt',
  set: 'lea',
  collector_number: '161',
  released_at: '1993-08-05',
  prices: { usd: '1.00' },
})
const unpriced = makeScryfallCard({ ...boltOld, id: 'bolt-unpriced', prices: {} })

describe('pickDisplayPrintings', () => {
  test('the newest priced printing is the card; the cheapest is per currency', () => {
    // Handed oldest-first: the release sort is what elects the newest.
    const picks = pickDisplayPrintings({
      printings: [boltOld, boltNew],
      card: boltOld,
      currencies: ['usd', 'eur'],
      bannedPrintings: new Set(),
    })
    expect(picks.card?.id).toBe('bolt-new')
    expect(picks.cheapest.usd?.id).toBe('bolt-old')
    // EUR prices nothing: the line falls back to the base card there.
    expect(picks.missing).toEqual(['eur'])
    expect(picks.cheapest.eur?.id).toBe('bolt-old')
    expect(picks.cardKingdom).toBeUndefined()
  })

  test('a name-only line keeps the base card when no currency prices it', () => {
    const picks = pickDisplayPrintings({
      printings: [unpriced],
      card: unpriced,
      currencies: ['usd'],
      bannedPrintings: new Set(),
    })
    expect(picks.card?.id).toBe('bolt-unpriced')
    expect(picks.missing).toEqual(['usd'])
  })

  test('a banned printing is skipped as the card but still wins cheapest', () => {
    const picks = pickDisplayPrintings({
      printings: [boltOld, boltNew],
      card: boltOld,
      currencies: ['usd'],
      bannedPrintings: new Set(['m10:146']),
    })
    expect(picks.card?.id).toBe('bolt-old')
    expect(picks.cheapest.usd?.id).toBe('bolt-old')
  })

  test('Card Kingdom picks from its own catalog when a quote is given', () => {
    const picks = pickDisplayPrintings({
      printings: [boltOld, boltNew],
      card: boltOld,
      currencies: ['usd'],
      bannedPrintings: new Set(),
      ckQuote: ckRetailQuote({ 'lea:161:nonfoil': 3 }),
    })
    // CK stocks only the old printing, so both of its picks are that one.
    expect(picks.cardKingdom?.representative?.id).toBe('bolt-old')
    expect(picks.cardKingdom?.cheapest?.id).toBe('bolt-old')
  })
})

describe('recordDisplayPrintings', () => {
  test('files the picks per name, creating the CK maps only once CK priced something', () => {
    const cardData = emptySiteCardData(['usd', 'tix'])
    const stocked = pickDisplayPrintings({
      printings: [boltOld, boltNew],
      card: boltOld,
      currencies: ['usd', 'tix'],
      bannedPrintings: new Set(),
      ckQuote: ckRetailQuote({ 'lea:161:nonfoil': 3 }),
    })
    const unstocked = pickDisplayPrintings({
      printings: [],
      card: null,
      currencies: ['usd', 'tix'],
      bannedPrintings: new Set(),
      ckQuote: ckRetailQuote({}),
    })

    recordDisplayPrintings(cardData, 'Nope', [], unstocked)
    expect(cardData.cards['Nope']).toBeNull()
    expect(cardData.cheapest.usd?.['Nope']).toBeNull()
    expect(cardData.missing).toEqual({ usd: ['Nope'], tix: ['Nope'] })
    // A quote that priced nothing claims no CK view.
    expect(cardData.cardKingdom).toBeUndefined()

    recordDisplayPrintings(cardData, 'Lightning Bolt', [boltOld, boltNew], stocked)
    expect(cardData.cards['Lightning Bolt']?.id).toBe('bolt-new')
    expect(cardData.cheapest.usd?.['Lightning Bolt']?.id).toBe('bolt-old')
    expect(cardData.printings['Lightning Bolt']).toHaveLength(2)
    expect(cardData.missing.tix).toEqual(['Nope', 'Lightning Bolt'])
    expect(cardData.cardKingdom?.cards['Lightning Bolt']?.id).toBe('bolt-old')
    expect(cardData.cardKingdom?.cheapest['Lightning Bolt']?.id).toBe('bolt-old')
  })
})
