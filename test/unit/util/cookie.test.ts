import { describe, expect, test } from 'bun:test'
import { readCookie } from '../../../src/util/cookie'

describe('readCookie', () => {
  test('finds a cookie among others, by exact name', () => {
    expect(readCookie('a=1; ritual_x=two; b=3', 'ritual_x')).toBe('two')
    expect(readCookie('xritual_x=no; ritual_x=yes', 'ritual_x')).toBe('yes')
  })

  test('the first occurrence wins, and an absent header or name is null', () => {
    expect(readCookie('k=first; k=second', 'k')).toBe('first')
    expect(readCookie(null, 'k')).toBeNull()
    expect(readCookie('other=1', 'k')).toBeNull()
  })
})
