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
