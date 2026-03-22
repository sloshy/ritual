import { describe, expect, test } from 'bun:test'
import { resolvePagerMode } from '../../src/pager'

describe('resolvePagerMode', () => {
  test('returns plain when plain flag is true', () => {
    expect(resolvePagerMode(true, true)).toBe('plain')
  })

  test('returns plain when not in a TTY', () => {
    expect(resolvePagerMode(false, false)).toBe('plain')
  })

  test('returns interactive when in a TTY and plain is false', () => {
    expect(resolvePagerMode(false, true)).toBe('interactive')
  })
})
