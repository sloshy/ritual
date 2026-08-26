import { describe, it, expect, beforeEach } from 'bun:test'
import type { ScryfallCard } from '../../src/scryfall/types'
import {
  seedCards,
  seedPrintings,
  getCardById,
  getUpdatedAt,
  getPrintingsByName,
  overlayCard,
  putFetchedCards,
  putFetchedPrintings,
  sessionCacheVersion,
  resetSessionCache,
} from '../../src/list-view/session-cache'

/** Build a minimal ScryfallCard; only id/name/prices.usd matter for these tests. */
function card(id: string, name: string, usd: string | null): ScryfallCard {
  return {
    id,
    name,
    prices: { usd, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
  } as unknown as ScryfallCard
}

describe('session-cache', () => {
  beforeEach(() => resetSessionCache())

  it('seeds baked cards as un-dated and returns them by id', () => {
    seedCards({ 'tst:1': card('id-a', 'Aardvark', '1.00') })
    expect(getCardById('id-a')?.name).toBe('Aardvark')
    expect(getUpdatedAt('id-a')).toBeNull() // baked: present but no session timestamp
    expect(getUpdatedAt('id-missing')).toBeUndefined()
  })

  it('does not overwrite a session-fetched card when re-seeded', () => {
    putFetchedCards([card('id-a', 'Aardvark', '5.00')], 1234)
    seedCards({ 'tst:1': card('id-a', 'Aardvark', '1.00') })
    expect(getCardById('id-a')?.prices.usd).toBe('5.00')
    expect(getUpdatedAt('id-a')).toBe(1234)
  })

  it('overlayCard prefers the fresher session entry, passing null through', () => {
    const baked = card('id-a', 'Aardvark', '1.00')
    expect(overlayCard(baked)).toBe(baked) // nothing fresher yet
    putFetchedCards([card('id-a', 'Aardvark', '9.00')], 999)
    expect(overlayCard(baked)?.prices.usd).toBe('9.00')
    expect(overlayCard(null)).toBeNull()
  })

  it('seeds and overrides printings by name', () => {
    seedPrintings({ Aardvark: [card('id-a', 'Aardvark', '1.00')] })
    expect(getPrintingsByName('Aardvark')).toHaveLength(1)
    putFetchedPrintings(
      'Aardvark',
      [card('id-a', 'Aardvark', '1.00'), card('id-b', 'Aardvark', '2.00')],
      42,
    )
    expect(getPrintingsByName('Aardvark')).toHaveLength(2)
    expect(getUpdatedAt('id-b')).toBe(42)
  })

  it('bumps the reactive version only when fetched data lands', () => {
    const before = sessionCacheVersion()
    seedCards({ 'tst:1': card('id-a', 'Aardvark', '1.00') })
    expect(sessionCacheVersion()).toBe(before) // seeding does not bump
    putFetchedCards([card('id-a', 'Aardvark', '2.00')], 7)
    expect(sessionCacheVersion()).toBe(before + 1)
  })
})
