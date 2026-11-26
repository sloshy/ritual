import { getTotpSecret, isTotpEnabled, verifyAdminUser } from '../../admin/auth'
import { AUDIT_REASONS } from '../../admin/audit-reasons'
import {
  auditFailedAttempt,
  recordSuccessfulLogin,
  reserveAttempt,
  reserveTotpCheck,
  returnTotpCheck,
  totpBudgetRetrySeconds,
  type LoginAttempt,
  type LoginLimitSettings,
} from '../../admin/login-attempt'
import type { RateLimiter } from '../../admin/rate-limit'
import { verifyTotp } from '../../admin/totp'
import { MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from '../../admin/validation'
import { addressKey } from './address-key'
import type { SignInGate } from './sign-in-gate'

/** The sign-in fields of a consent form, as submitted. */
export type ConsentCredentials = {
  username: string
  password: string
  totpCode: string
}

/** Who is signing in, for the rate limiter and the audit log. */
export type LoginOrigin = {
  clientIp: string
  userAgent: string
}

/**
 * Which credential failed a check (`password`, `totp`), `totpPaused` when the
 * password was right but the global budget of wrong codes is spent so no code
 * was checked, or `undefined` when both passed.
 */
export type CredentialFailure = 'password' | 'totp' | 'totpPaused'

/** Check a consent form's credentials, drawing on `budget` for the authenticator code. */
export type CredentialCheck = (
  credentials: ConsentCredentials,
  budget: RateLimiter,
) => Promise<CredentialFailure | undefined>

/** What the consent sign-in counts and queues on: the server's own limiter and gate. */
export type ConsentLoginGuards = {
  limiter: RateLimiter
  gate: SignInGate
  /** The global budget of wrong authenticator codes (shared with the admin login). */
  totpBudget: RateLimiter
  /** The credential check; the admin account by default. Tests slow it down. */
  check?: CredentialCheck
}

/**
 * The result of a consent sign-in. A failure is only ever "invalid
 * credentials", "locked", or "busy" (too many sign-ins queued right now): a
 * right password with a missing or wrong code reads exactly like a wrong
 * password, so the page is no oracle for the password alone.
 *
 * One deliberate exception: while the global budget of wrong authenticator
 * codes is spent, a right password is answered `rateLimited` (429 with
 * `Retry-After`), which a wrong password is not, so the two are
 * distinguishable then. Checking the password anyway and answering as if it
 * were wrong would lock the owner out with no hint why; the per-address limit
 * still bounds how many passwords such an answer can test.
 */
export type ConsentLoginResult =
  | { ok: true; username: string }
  | { ok: false; error: 'invalidCredentials' | 'busy' }
  | {
      ok: false
      error: 'rateLimited'
      /** When the refusal has a known end (the spent code budget): seconds until then. */
      retryAfterSeconds?: number
    }

/** Whether the submitted fields could be credentials at all. */
function plausible({ username, password }: ConsentCredentials): boolean {
  return (
    username !== '' &&
    password !== '' &&
    username.length <= MAX_USERNAME_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  )
}

/**
 * Check the password, then (when it is on) the TOTP code, against the admin
 * account. A well-formed code is checked only when the global budget of
 * wrong codes allows it, and a wrong one is counted against it; a missing or
 * malformed code cannot be right, so it is refused without counting.
 */
export const checkAdminCredentials: CredentialCheck = async (credentials, budget) => {
  if (!plausible(credentials)) return 'password'
  if (!(await verifyAdminUser(credentials.username, credentials.password))) return 'password'
  if (!(await isTotpEnabled())) return undefined
  const secret = await getTotpSecret()
  const code = credentials.totpCode
  if (secret === null || !/^\d{6}$/.test(code)) return 'totp'
  if (!reserveTotpCheck(budget)) return 'totpPaused'
  if (!(await verifyTotp(secret, code))) return 'totp'
  returnTotpCheck(budget)
  return undefined
}

/**
 * Check a consent form's sign-in against the Ritual admin account.
 *
 * The attempt is reserved against the client address's limit *before* the
 * credentials are checked (`reserveAttempt`, shared with the admin login),
 * and checks run one at a time per address and a few at a time overall: a
 * burst of parallel guesses gets no more checks than the limit allows. Only
 * the check holds a gate slot; the audit entry and the failed-attempt delay
 * (`admin.failedAuthDelayMs`) come after the slot is released, so delayed
 * failures cannot starve the owner. A full queue answers `busy` without
 * counting anything. A success forgives the address's failures. The limiter is
 * the OAuth server's own, so internet traffic cannot lock the owner out of
 * the local admin. Nothing about an attempt, least of all the password, is
 * logged beyond the audit entry.
 *
 * Wrong authenticator codes also draw on a budget shared by every address
 * (and by the admin login): once it is spent, a right password is answered
 * `rateLimited` with the time left, the address's attempt is given back, and
 * no code is checked until the window passes. A wrong password is answered
 * exactly as before.
 */
export async function verifyConsentLogin(
  credentials: ConsentCredentials,
  origin: LoginOrigin,
  settings: LoginLimitSettings,
  guards: ConsentLoginGuards,
): Promise<ConsentLoginResult> {
  const key = addressKey(origin.clientIp)
  if (!guards.gate.hasRoom()) return { ok: false, error: 'busy' }
  if (!reserveAttempt(guards.limiter, key, settings)) return { ok: false, error: 'rateLimited' }
  const check = guards.check ?? checkAdminCredentials
  // `hasRoom` was checked synchronously just before, so the gate admits this.
  const gated = await guards.gate.run(key, () => check(credentials, guards.totpBudget))
  if (!gated.ok) return { ok: false, error: 'busy' }
  const failed = gated.value
  if (failed === 'totpPaused') {
    // No credential was found wrong: the address is not charged for it.
    if (settings.rateLimitEnabled) guards.limiter.release(key)
    return {
      ok: false,
      error: 'rateLimited',
      retryAfterSeconds: totpBudgetRetrySeconds(guards.totpBudget),
    }
  }
  const attempt: LoginAttempt = {
    clientIp: origin.clientIp,
    username: credentials.username,
    userAgent: origin.userAgent,
  }
  if (failed !== undefined) {
    const reason = failed === 'totp' ? AUDIT_REASONS.invalidTotp : AUDIT_REASONS.invalidCredentials
    await auditFailedAttempt(attempt, reason, settings)
    return { ok: false, error: 'invalidCredentials' }
  }
  await recordSuccessfulLogin(guards.limiter, key, attempt, AUDIT_REASONS.oauthAuthorized)
  return { ok: true, username: credentials.username }
}
