import { describe, expect, test } from 'bun:test'
import { resolvePagerMode } from '../../src/pager'

describe('resolvePagerMode', () => {
  test('returns plain when plain flag is true', () => {
    expect(resolvePagerMode(true)).toBe('plain')
  })

  test('returns plain when not in a TTY', () => {
    // In the test runner, process.stdout.isTTY is falsy
    expect(resolvePagerMode(false)).toBe('plain')
  })
})
