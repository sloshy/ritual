import { describe, expect, test } from 'bun:test'
import { parsePriceCacheKey } from '../../src/pricing/prices'

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
