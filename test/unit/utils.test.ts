import { describe, expect, test } from 'bun:test'
import { formatDuration } from '../../src/utils'

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
