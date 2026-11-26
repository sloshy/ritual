import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readAuditLog } from '../../../../src/admin/audit-log'
import { setTotpSecret } from '../../../../src/admin/auth'
import {
  MAX_TOTP_FAILURES_PER_WINDOW,
  TOTP_BUDGET_KEY,
  TOTP_BUDGET_WINDOW_MINUTES,
  type LoginLimitSettings,
} from '../../../../src/admin/login-attempt'
import { RateLimiter } from '../../../../src/admin/rate-limit'
import { generateTotp, resetTotpReplayState } from '../../../../src/admin/totp'
import {
  verifyConsentLogin,
  type ConsentLoginGuards,
  type CredentialCheck,
} from '../../../../src/mcp/oauth/login'
import { SignInGate } from '../../../../src/mcp/oauth/sign-in-gate'
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  manualClock,
  seedAdminAccount,
  type ManualClock,
} from '../../../helpers/oauth'
import { bindWorkspace, type BoundWorkspace } from '../../../helpers/workspace'

const DELAY_MS = 300

const SETTINGS: LoginLimitSettings = {
  rateLimitEnabled: true,
  rateLimitMaxAttempts: 5,
  rateLimitWindowMinutes: 5,
  failedAuthDelayMs: DELAY_MS,
}

/** A check that takes `ms` and accepts only the password `right`. */
function slowCheck(ms: number): CredentialCheck {
  return async (credentials) => {
    await Bun.sleep(ms)
    return credentials.password === 'right' ? undefined : 'password'
  }
}

/** Fresh limiters around `gate`. */
function guardsWith(gate: SignInGate): ConsentLoginGuards {
  return { limiter: new RateLimiter(), gate, totpBudget: new RateLimiter() }
}

function attempt(password: string, clientIp: string) {
  return [
    { username: 'owner', password, totpCode: '' },
    { clientIp, userAgent: 'test' },
  ] as const
}

describe('verifyConsentLogin', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })
  afterEach(async () => ws.dispose())

  test('the failure delay is waited out after the gate slot is released', async () => {
    const guards = { ...guardsWith(new SignInGate(1, 16)), check: slowCheck(10) }
    // Six failing addresses, one slot: if each held the slot through its
    // delay, the owner would wait about six delays.
    const attacks = Array.from({ length: 6 }, (_, i) =>
      verifyConsentLogin(...attempt('wrong', `203.0.113.${i}`), SETTINGS, guards),
    )
    await Bun.sleep(5)
    const started = Date.now()
    const owner = await verifyConsentLogin(...attempt('right', '192.0.2.1'), SETTINGS, guards)
    const waited = Date.now() - started
    expect(owner.ok).toBe(true)
    expect(waited).toBeLessThan(DELAY_MS)
    const results = await Promise.all(attacks)
    expect(results.every((result) => !result.ok && result.error === 'invalidCredentials')).toBe(
      true,
    )
  })

  test('a full queue answers busy at once and counts nothing', async () => {
    const guards = { ...guardsWith(new SignInGate(1, 1)), check: slowCheck(100) }
    const first = verifyConsentLogin(...attempt('wrong', '203.0.113.1'), SETTINGS, guards)
    const second = verifyConsentLogin(...attempt('wrong', '203.0.113.2'), SETTINGS, guards)
    const refused = await verifyConsentLogin(...attempt('right', '203.0.113.3'), SETTINGS, guards)
    expect(refused).toEqual({ ok: false, error: 'busy' })
    expect(guards.limiter.getFailureCount('203.0.113.3')).toBe(0)
    await Promise.all([first, second])
  })

  test('a burst from one address gets no more checks than the limit', async () => {
    let checks = 0
    const check: CredentialCheck = async () => {
      checks += 1
      await Bun.sleep(1)
      return 'password'
    }
    const guards = { ...guardsWith(new SignInGate(4, 64)), check }
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        verifyConsentLogin(
          ...attempt('wrong', '198.51.100.7'),
          { ...SETTINGS, failedAuthDelayMs: 0 },
          guards,
        ),
      ),
    )
    expect(checks).toBe(5)
    expect(results.filter((r) => !r.ok && r.error === 'rateLimited')).toHaveLength(25)
    expect((await readAuditLog()).filter((entry) => !entry.success)).toHaveLength(5)
  })
})

describe('verifyConsentLogin — the global budget of wrong authenticator codes', () => {
  const SECRET = 'JBSWY3DPEHPK3PXP'
  const NO_DELAY: LoginLimitSettings = { ...SETTINGS, failedAuthDelayMs: 0 }
  let ws: BoundWorkspace
  let time: ManualClock
  let guards: ConsentLoginGuards
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
    await seedAdminAccount(ws.dir)
    await setTotpSecret(SECRET)
    resetTotpReplayState()
    time = manualClock()
    guards = {
      limiter: new RateLimiter(time.clock),
      gate: new SignInGate(4, 16),
      totpBudget: new RateLimiter(time.clock),
    }
  })
  afterEach(async () => ws.dispose())

  /** A sign-in from `clientIp`, by default with the right password. */
  function signIn(clientIp: string, totpCode: string, password: string = ADMIN_PASSWORD) {
    return verifyConsentLogin(
      { username: ADMIN_USERNAME, password, totpCode },
      { clientIp, userAgent: 'test' },
      NO_DELAY,
      guards,
    )
  }

  /** `count` right-password, wrong-code sign-ins, each from a fresh address. */
  async function wrongCodes(count: number, prefix: string): Promise<void> {
    for (let i = 0; i < count; i++) {
      expect(await signIn(`${prefix}.${i + 1}`, '000000')).toEqual({
        ok: false,
        error: 'invalidCredentials',
      })
    }
  }

  test('wrong codes from many addresses spend it: then even the right code is refused, a wrong password unchanged', async () => {
    await wrongCodes(MAX_TOTP_FAILURES_PER_WINDOW, '203.0.113')
    const refused = await signIn('192.0.2.1', await generateTotp(SECRET))
    expect(refused).toEqual({
      ok: false,
      error: 'rateLimited',
      retryAfterSeconds: TOTP_BUDGET_WINDOW_MINUTES * 60,
    })
    // The refused attempt is not charged to its address.
    expect(guards.limiter.getFailureCount('192.0.2.1')).toBe(0)
    // A wrong password reads as it always did.
    expect(await signIn('192.0.2.2', '000000', 'wrong password')).toEqual({
      ok: false,
      error: 'invalidCredentials',
    })
  })

  test('wrong passwords do not draw on it', async () => {
    for (let i = 0; i < 2 * MAX_TOTP_FAILURES_PER_WINDOW; i++) {
      await signIn(`198.51.100.${i + 1}`, '000000', 'wrong password')
    }
    expect(guards.totpBudget.getFailureCount(TOTP_BUDGET_KEY)).toBe(0)
    expect((await signIn('192.0.2.1', await generateTotp(SECRET))).ok).toBe(true)
  })

  test('it recovers once its window has passed', async () => {
    await wrongCodes(MAX_TOTP_FAILURES_PER_WINDOW, '203.0.113')
    time.advance(TOTP_BUDGET_WINDOW_MINUTES * 60_000)
    expect((await signIn('192.0.2.1', await generateTotp(SECRET))).ok).toBe(true)
  })

  test('a successful sign-in does not reset it', async () => {
    await wrongCodes(MAX_TOTP_FAILURES_PER_WINDOW - 1, '203.0.113')
    expect((await signIn('192.0.2.1', await generateTotp(SECRET))).ok).toBe(true)
    // One more wrong code is the last the window allows.
    await wrongCodes(1, '198.51.100')
    resetTotpReplayState()
    expect(await signIn('192.0.2.1', await generateTotp(SECRET))).toMatchObject({
      ok: false,
      error: 'rateLimited',
    })
  })

  test('a missing or malformed code cannot be right, so it draws nothing', async () => {
    for (const code of ['', '12345', 'abcdef']) {
      expect(await signIn('203.0.113.1', code)).toEqual({ ok: false, error: 'invalidCredentials' })
    }
    expect(guards.totpBudget.getFailureCount(TOTP_BUDGET_KEY)).toBe(0)
  })
})
