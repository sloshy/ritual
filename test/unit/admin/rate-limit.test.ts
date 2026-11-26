import { describe, test, expect, beforeEach } from 'bun:test'
import { RateLimiter } from '../../../src/admin/rate-limit'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  beforeEach(() => {
    limiter = new RateLimiter()
  })

  test('isLocked returns false for unknown IP', () => {
    expect(limiter.isLocked('1.2.3.4')).toBe(false)
  })

  test('records failures and locks after max attempts', () => {
    const ip = '1.2.3.4'
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(ip, 5, 5)
    }
    expect(limiter.isLocked(ip)).toBe(true)
  })

  test('does not lock before max attempts', () => {
    const ip = '1.2.3.4'
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure(ip, 5, 5)
    }
    expect(limiter.isLocked(ip)).toBe(false)
  })

  test('recordSuccess clears tracking', () => {
    const ip = '1.2.3.4'
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure(ip, 5, 5)
    }
    expect(limiter.isLocked(ip)).toBe(true)
    limiter.recordSuccess(ip)
    expect(limiter.isLocked(ip)).toBe(false)
    expect(limiter.getFailureCount(ip)).toBe(0)
  })

  test('getFailureCount tracks failures', () => {
    const ip = '10.0.0.1'
    expect(limiter.getFailureCount(ip)).toBe(0)
    limiter.recordFailure(ip, 10, 5)
    limiter.recordFailure(ip, 10, 5)
    expect(limiter.getFailureCount(ip)).toBe(2)
  })

  test('getRemainingLockSeconds returns 0 when not locked', () => {
    expect(limiter.getRemainingLockSeconds('1.2.3.4')).toBe(0)
  })

  test('getRemainingLockSeconds returns positive value when locked', () => {
    const ip = '1.2.3.4'
    for (let i = 0; i < 3; i++) {
      limiter.recordFailure(ip, 3, 5)
    }
    expect(limiter.isLocked(ip)).toBe(true)
    expect(limiter.getRemainingLockSeconds(ip)).toBeGreaterThan(0)
    expect(limiter.getRemainingLockSeconds(ip)).toBeLessThanOrEqual(300)
  })

  test('different IPs are tracked independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('1.1.1.1', 5, 5)
    }
    expect(limiter.isLocked('1.1.1.1')).toBe(true)
    expect(limiter.isLocked('2.2.2.2')).toBe(false)
  })
})

describe('RateLimiter with a clock', () => {
  test('a lock lifts when the injected clock passes the window', () => {
    let now = 1_000_000
    const limiter = new RateLimiter(() => now)
    for (let i = 0; i < 3; i++) limiter.recordFailure('k', 3, 1)
    expect(limiter.isLocked('k')).toBe(true)
    expect(limiter.getRemainingLockSeconds('k')).toBe(60)
    now += 60_000
    expect(limiter.isLocked('k')).toBe(false)
  })

  test('idle records are swept, so one-off keys do not accumulate', () => {
    let now = 1_000_000
    const limiter = new RateLimiter(() => now)
    for (let i = 0; i < 99; i++) limiter.recordFailure(`one-off-${i}`, 5, 1)
    expect(limiter.size).toBe(99)
    now += 61_000
    // The hundredth failure triggers a sweep of everything idle past the window.
    limiter.recordFailure('fresh', 5, 1)
    expect(limiter.size).toBe(1)
  })

  test('a sweep keeps locked and recently failing keys', () => {
    let now = 1_000_000
    const limiter = new RateLimiter(() => now)
    for (let i = 0; i < 5; i++) limiter.recordFailure('locked', 5, 10)
    now += 5 * 60_000
    for (let i = 0; i < 95; i++) limiter.recordFailure(`k${i}`, 50, 10)
    expect(limiter.isLocked('locked')).toBe(true)
    expect(limiter.size).toBe(96)
  })
})

describe('RateLimiter.release', () => {
  test('takes back the latest failure and lifts the lock it alone caused', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < 3; i++) limiter.recordFailure('k', 3, 5)
    expect(limiter.isLocked('k')).toBe(true)
    limiter.release('k')
    expect(limiter.isLocked('k')).toBe(false)
    expect(limiter.getFailureCount('k')).toBe(2)
  })

  test('keeps a lock that more failures than the limit hold, and ignores an unknown key', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < 4; i++) limiter.recordFailure('k', 3, 5)
    limiter.release('k')
    expect(limiter.isLocked('k')).toBe(true)
    limiter.release('nobody')
    expect(limiter.size).toBe(1)
  })
})
