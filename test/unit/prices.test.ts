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

  test('splits on the last colon, so a name with a colon survives', () => {
    expect(parsePriceCacheKey('Circle of Protection: Red:usd')).toEqual({
      ok: true,
      cardName: 'Circle of Protection: Red',
      currency: 'usd',
    })
  })

  test('refuses a key without a currency suffix', () => {
    expect(parsePriceCacheKey('Sol Ring')).toEqual({ ok: false, problem: 'missing-currency' })
  })

  test.each([
    ['an unknown suffix', 'Sol Ring:xyz', 'xyz'],
    ['an empty suffix', 'Sol Ring:', ''],
    ['an upper-case suffix (keys are written lowercase)', 'Sol Ring:USD', 'USD'],
  ])('refuses %s, naming it', (_label, key, suffix) => {
    expect(parsePriceCacheKey(key)).toEqual({ ok: false, problem: 'unknown-currency', suffix })
  })
})
