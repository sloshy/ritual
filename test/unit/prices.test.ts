import { describe, expect, test } from 'bun:test'
import { parsePriceCacheKey, priceCacheKey } from '../../src/prices'

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
