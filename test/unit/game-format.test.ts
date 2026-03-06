import { describe, test, expect } from 'bun:test'
import { isArenaOnly, isToken, getCardGames } from '../../src/scryfall'
import { isCurrencyAvailableForCard, parseCurrenciesFlag } from '../../src/price-currency'
import { priceCacheKey, parsePriceCacheKey } from '../../src/prices'
import type { ScryfallCard } from '../../src/types'

function makeCard(games: string[]): ScryfallCard {
  return {
    id: 'test-id',
    name: 'Test Card',
    cmc: 0,
    type_line: 'Artifact',
    prices: { usd: null, usd_foil: null, usd_etched: null, eur: null, eur_foil: null, tix: null },
    finishes: ['nonfoil'],
    games,
    set: 'tst',
    set_name: 'Test Set',
    collector_number: '1',
    rarity: 'common',
    color_identity: [],
  }
}

describe('isToken', () => {
  test('returns true for token layout', () => {
    expect(isToken({ ...makeCard([]), layout: 'token' })).toBe(true)
  })

  test('returns true for double_faced_token layout', () => {
    expect(isToken({ ...makeCard([]), layout: 'double_faced_token' })).toBe(true)
  })

  test('returns true for cached card with Token in type_line (no layout field)', () => {
    expect(isToken({ ...makeCard([]), type_line: 'Token Creature — Cat Soldier' })).toBe(true)
  })

  test('returns true for legendary token type_line', () => {
    expect(isToken({ ...makeCard([]), type_line: 'Legendary Token Creature — Angel' })).toBe(true)
  })

  test('returns false for normal card layout', () => {
    expect(isToken({ ...makeCard([]), layout: 'normal' })).toBe(false)
  })

  test('returns false when layout is absent and type_line has no Token', () => {
    expect(isToken(makeCard([]))).toBe(false)
  })

  test('returns false for card whose type_line contains Token only as substring', () => {
    // e.g. a hypothetical card named "Tokenmaker" would not match \bToken\b in type_line
    expect(isToken({ ...makeCard([]), type_line: 'Artifact — Tokenmaker' })).toBe(false)
  })
})

describe('isArenaOnly', () => {
  test('returns true for arena-only card', () => {
    expect(isArenaOnly(makeCard(['arena']))).toBe(true)
  })

  test('returns false for paper card', () => {
    expect(isArenaOnly(makeCard(['paper']))).toBe(false)
  })

  test('returns false for paper+arena card', () => {
    expect(isArenaOnly(makeCard(['paper', 'arena']))).toBe(false)
  })

  test('returns false for mtgo card', () => {
    expect(isArenaOnly(makeCard(['mtgo']))).toBe(false)
  })

  test('returns false for empty games array', () => {
    expect(isArenaOnly(makeCard([]))).toBe(false)
  })

  test('returns false for paper+mtgo+arena card', () => {
    expect(isArenaOnly(makeCard(['paper', 'mtgo', 'arena']))).toBe(false)
  })
})

describe('getCardGames', () => {
  test('returns union of games across printings', () => {
    const paper = makeCard(['paper'])
    const mtgo = makeCard(['mtgo'])
    expect(getCardGames([paper, mtgo]).sort()).toEqual(['mtgo', 'paper'])
  })

  test('deduplicates games', () => {
    const a = makeCard(['paper', 'arena'])
    const b = makeCard(['paper', 'mtgo'])
    expect(getCardGames([a, b]).sort()).toEqual(['arena', 'mtgo', 'paper'])
  })

  test('returns empty for no printings', () => {
    expect(getCardGames([])).toEqual([])
  })

  test('returns empty for cards with empty games', () => {
    expect(getCardGames([makeCard([])])).toEqual([])
  })
})

describe('isCurrencyAvailableForCard', () => {
  test('usd requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'usd')).toBe(false)
    expect(isCurrencyAvailableForCard(['arena'], 'usd')).toBe(false)
  })

  test('eur requires paper', () => {
    expect(isCurrencyAvailableForCard(['paper'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['mtgo'], 'eur')).toBe(false)
  })

  test('tix requires mtgo', () => {
    expect(isCurrencyAvailableForCard(['mtgo'], 'tix')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper'], 'tix')).toBe(false)
  })

  test('empty games array returns true (backward compat)', () => {
    expect(isCurrencyAvailableForCard([], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard([], 'tix')).toBe(true)
  })

  test('paper+mtgo supports all currencies', () => {
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'usd')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'eur')).toBe(true)
    expect(isCurrencyAvailableForCard(['paper', 'mtgo'], 'tix')).toBe(true)
  })
})

describe('parseCurrenciesFlag', () => {
  test('returns all currencies when undefined', () => {
    expect(parseCurrenciesFlag(undefined)).toEqual(['usd', 'eur', 'tix'])
  })

  test('parses single currency', () => {
    expect(parseCurrenciesFlag('eur')).toEqual(['eur'])
  })

  test('parses comma-separated currencies', () => {
    expect(parseCurrenciesFlag('usd,eur')).toEqual(['usd', 'eur'])
  })

  test('deduplicates currencies', () => {
    expect(parseCurrenciesFlag('usd,usd,eur')).toEqual(['usd', 'eur'])
  })

  test('is case insensitive', () => {
    expect(parseCurrenciesFlag('USD,EUR')).toEqual(['usd', 'eur'])
  })

  test('trims whitespace', () => {
    expect(parseCurrenciesFlag(' usd , tix ')).toEqual(['usd', 'tix'])
  })

  test('throws for invalid currency', () => {
    expect(() => parseCurrenciesFlag('usd,gbp')).toThrow()
  })

  test('returns all currencies for empty string (treated as no input)', () => {
    expect(parseCurrenciesFlag('')).toEqual(['usd', 'eur', 'tix'])
  })
})

describe('priceCacheKey', () => {
  test('creates currency-keyed cache key', () => {
    expect(priceCacheKey('Sol Ring', 'usd')).toBe('Sol Ring:usd')
    expect(priceCacheKey('Sol Ring', 'eur')).toBe('Sol Ring:eur')
    expect(priceCacheKey('Sol Ring', 'tix')).toBe('Sol Ring:tix')
  })
})

describe('parsePriceCacheKey', () => {
  test('parses currency-keyed cache key', () => {
    expect(parsePriceCacheKey('Sol Ring:usd')).toEqual({
      ok: true,
      cardName: 'Sol Ring',
      currency: 'usd',
    })
    expect(parsePriceCacheKey('Sol Ring:eur')).toEqual({
      ok: true,
      cardName: 'Sol Ring',
      currency: 'eur',
    })
    expect(parsePriceCacheKey('Sol Ring:tix')).toEqual({
      ok: true,
      cardName: 'Sol Ring',
      currency: 'tix',
    })
  })

  test('handles card names with colons', () => {
    expect(parsePriceCacheKey('Who // What:usd')).toEqual({
      ok: true,
      cardName: 'Who // What',
      currency: 'usd',
    })
  })

  test('returns error for key without currency suffix', () => {
    const result = parsePriceCacheKey('Sol Ring')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeString()
  })

  test('returns error for unknown currency suffix', () => {
    const result = parsePriceCacheKey('Sol Ring:xyz')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeString()
  })
})
