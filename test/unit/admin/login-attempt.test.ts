import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readAuditLog } from '../../../src/admin/audit-log'
import { AUDIT_REASONS } from '../../../src/admin/audit-reasons'
import {
  MAX_AUDIT_USER_AGENT_LENGTH,
  auditFailedAttempt,
  recordSuccessfulLogin,
  reserveAttempt,
  reserveTotpCheck,
  returnTotpCheck,
  TOTP_BUDGET_KEY,
  totpBudgetRetrySeconds,
  type LoginLimitSettings,
} from '../../../src/admin/login-attempt'
import { RateLimiter } from '../../../src/admin/rate-limit'
import { bindWorkspace, type BoundWorkspace } from '../../helpers/workspace'

const SETTINGS: LoginLimitSettings = {
  rateLimitEnabled: true,
  rateLimitMaxAttempts: 2,
  rateLimitWindowMinutes: 5,
  failedAuthDelayMs: 0,
}

const ATTEMPT = { clientIp: '203.0.113.9', username: 'owner', userAgent: 'test-agent' }

describe('login-attempt bookkeeping', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })
  afterEach(async () => ws.dispose())

  test('a reservation counts at once, and a locked key is refused without counting', () => {
    const limiter = new RateLimiter()
    expect(reserveAttempt(limiter, 'key', SETTINGS)).toBe(true)
    expect(limiter.getFailureCount('key')).toBe(1)
    expect(reserveAttempt(limiter, 'key', SETTINGS)).toBe(true)
    // The second reservation reached the limit of 2, so the key is locked now.
    expect(reserveAttempt(limiter, 'key', SETTINGS)).toBe(false)
    expect(limiter.getFailureCount('key')).toBe(2)
  })

  test('with rate limiting off, a reservation always admits and counts nothing', () => {
    const limiter = new RateLimiter()
    for (let i = 0; i < 5; i++) {
      expect(reserveAttempt(limiter, 'key', { ...SETTINGS, rateLimitEnabled: false })).toBe(true)
    }
    expect(limiter.getFailureCount('key')).toBe(0)
  })

  test('the TOTP budget counts each check and gives back only a returned one', () => {
    const budget = new RateLimiter()
    expect(reserveTotpCheck(budget)).toBe(true)
    expect(reserveTotpCheck(budget)).toBe(true)
    returnTotpCheck(budget)
    expect(budget.getFailureCount(TOTP_BUDGET_KEY)).toBe(1)
  })

  test('the TOTP budget never asks for Retry-After: 0, even once its lock has lapsed', () => {
    let now = 0
    const budget = new RateLimiter(() => now)
    while (reserveTotpCheck(budget)) now += 1
    expect(totpBudgetRetrySeconds(budget)).toBeGreaterThan(1)
    now += 24 * 60 * 60_000
    expect(totpBudgetRetrySeconds(budget)).toBe(1)
  })

  test('a failure is audited with its reason', async () => {
    await auditFailedAttempt(ATTEMPT, AUDIT_REASONS.invalidTotp, SETTINGS)
    const [entry] = await readAuditLog(1)
    expect(entry).toMatchObject({
      ip: '203.0.113.9',
      username: 'owner',
      success: false,
      reason: 'Invalid TOTP code',
    })
  })

  test('a success forgives the key and is audited; long free-form fields are cut', async () => {
    const limiter = new RateLimiter()
    limiter.recordFailure('key', 5, 5)
    await recordSuccessfulLogin(
      limiter,
      'key',
      { ...ATTEMPT, userAgent: 'u'.repeat(5000), username: 'n'.repeat(5000) },
      AUDIT_REASONS.oauthAuthorized,
    )
    expect(limiter.getFailureCount('key')).toBe(0)
    const [entry] = await readAuditLog(1)
    expect(entry?.success).toBe(true)
    expect(entry?.reason).toBe('MCP client authorized via OAuth')
    expect(entry?.userAgent).toHaveLength(MAX_AUDIT_USER_AGENT_LENGTH)
    expect(entry!.username.length).toBeLessThan(5000)
  })
})
