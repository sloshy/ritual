import { describe, expect, test } from 'bun:test'
import { isWithinWindow } from '../../src/util/time-window'

describe('isWithinWindow', () => {
  test.each<[string, number | undefined, boolean]>([
    ['never', undefined, false],
    ['just now', 100, true],
    ['one tick before the window closes', 1, true],
    ['exactly the window ago', 0, false],
    // A clock that moved backwards must not silence an advisory for good.
    ['in the future', 101, false],
  ])('%s', (_label, time, recent) => {
    expect(isWithinWindow(time, 100, 100)).toBe(recent)
  })
})
