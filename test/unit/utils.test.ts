import { describe, expect, test } from 'bun:test'
import { formatDuration, getAtPath } from '../../src/utils'

describe('formatDuration', () => {
  test('formats sub-minute, minutes, hours, and day durations', () => {
    expect(formatDuration(30_000)).toBe('less than a minute')
    expect(formatDuration(45 * 60_000)).toBe('45 minutes')
    expect(formatDuration(3 * 60 * 60_000 + 5 * 60_000)).toBe('3 hours, 5 minutes')
    expect(formatDuration(26 * 60 * 60_000)).toBe('1 day, 2 hours')
  })

  test('omits minute precision once the total exceeds a day', () => {
    expect(formatDuration(24 * 60 * 60_000 + 61_000)).toBe('1 day')
  })

  test('uses singular unit names for one minute and one hour', () => {
    expect(formatDuration(60_000)).toBe('1 minute')
    expect(formatDuration(60 * 60_000 + 60_000)).toBe('1 hour, 1 minute')
  })
})

describe('getAtPath', () => {
  const obj = { admin: { gitEnabled: true, nested: { deep: 'value' } }, top: 'level' }

  test('reads top-level and nested values', () => {
    expect(getAtPath(obj, ['top'])).toBe('level')
    expect(getAtPath(obj, ['admin', 'gitEnabled'])).toBe(true)
    expect(getAtPath(obj, ['admin', 'nested', 'deep'])).toBe('value')
  })

  test('returns undefined for missing segments', () => {
    expect(getAtPath(obj, ['nope'])).toBeUndefined()
    expect(getAtPath(obj, ['admin', 'nope'])).toBeUndefined()
    expect(getAtPath(obj, ['admin', 'nope', 'deeper'])).toBeUndefined()
  })

  test('returns undefined when a path segment lands on a non-object', () => {
    expect(getAtPath(obj, ['top', 'child'])).toBeUndefined()
    expect(getAtPath(null, ['a'])).toBeUndefined()
    expect(getAtPath('scalar', ['a'])).toBeUndefined()
  })

  test('an empty path returns the input itself', () => {
    expect(getAtPath(obj, [])).toBe(obj)
  })
})
