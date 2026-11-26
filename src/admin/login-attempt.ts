import { appendAuditLog, createAuditEntry } from './audit-log'
import type { AuditReason } from './audit-reasons'
import { RateLimiter } from './rate-limit'
import { MAX_USERNAME_LENGTH } from './validation'
import type { AdminConfig } from '../config/ritual-config'

/**
 * The bookkeeping every sign-in Ritual checks shares — the admin login
 * (`POST /api/login`) and the MCP OAuth consent page: counting a failure
 * against a rate limiter, the audit entry, and the failed-attempt delay. Each
 * caller keeps its own responses; only this part is common.
 */

/** The longest User-Agent the audit log keeps; a longer one is cut. */
export const MAX_AUDIT_USER_AGENT_LENGTH = 512

/** Who attempted a sign-in, as the audit log records it. */
export type LoginAttempt = {
  clientIp: string
  username: string
  userAgent: string
}

/** The `admin.*` settings the bookkeeping follows. */
export type LoginLimitSettings = Pick<
  AdminConfig,
  'rateLimitEnabled' | 'rateLimitMaxAttempts' | 'rateLimitWindowMinutes' | 'failedAuthDelayMs'
>

/** Count one failed (or reserved) attempt for `key`, when rate limiting is on. */
export function countFailedAttempt(
  limiter: RateLimiter,
  key: string,
  settings: LoginLimitSettings,
): void {
  if (!settings.rateLimitEnabled) return
  limiter.recordFailure(key, settings.rateLimitMaxAttempts, settings.rateLimitWindowMinutes)
}

/** Append an audit entry, with the free-form fields cut to what the log keeps. */
async function audit(attempt: LoginAttempt, success: boolean, reason: AuditReason): Promise<void> {
  await appendAuditLog(
    createAuditEntry(
      attempt.clientIp,
      attempt.username.slice(0, MAX_USERNAME_LENGTH),
      success,
      reason,
      attempt.userAgent.slice(0, MAX_AUDIT_USER_AGENT_LENGTH),
    ),
  )
}

/**
 * Reserve one attempt for `key` before its credentials are checked: refused
 * (`false`) when the key is already locked, otherwise counted at once as a
 * failure — a success forgives it ({@link recordSuccessfulLogin}). Check and
 * count happen together, synchronously, so parallel requests see each other's
 * reservations and a burst gets no more checks than the limit allows. With
 * rate limiting off it always admits and counts nothing.
 */
export function reserveAttempt(
  limiter: RateLimiter,
  key: string,
  settings: LoginLimitSettings,
): boolean {
  if (!settings.rateLimitEnabled) return true
  if (limiter.isLocked(key)) return false
  countFailedAttempt(limiter, key, settings)
  return true
}

/**
 * Wrong authenticator codes accepted across every address in
 * {@link TOTP_BUDGET_WINDOW_MINUTES}, after a right password: past this, no
 * code is checked by anyone until the window has passed. A code is right for
 * up to three 30-second steps (the current one and one either side), so a
 * guess wins with odds of about 3 in 1,000,000; at no more than 10 guesses
 * per 15 minutes, 960 a day, that is about 0.3% a day, or one success in
 * roughly a year of uninterrupted guessing. Without it, enough addresses
 * would get through the six-digit space in hours.
 */
export const MAX_TOTP_FAILURES_PER_WINDOW = 10

/** The window of {@link MAX_TOTP_FAILURES_PER_WINDOW}, in minutes. */
export const TOTP_BUDGET_WINDOW_MINUTES = 15

/** The one key the global budget counts under: it is not per address. */
export const TOTP_BUDGET_KEY = 'totp'

/**
 * The process's budget of wrong authenticator codes, shared by the admin
 * login and the MCP OAuth consent sign-in: both check the same TOTP secret,
 * so a guesser gets no more codes by spreading over both.
 */
export const globalTotpBudget = new RateLimiter()

/**
 * Take one authenticator-code check from `budget`, before the code is
 * checked: `false` while the budget is spent. Counted at once as a wrong code
 * (synchronously, like {@link reserveAttempt}, so parallel checks see each
 * other); a right code gives it back with {@link returnTotpCheck}. With rate
 * limiting off it always admits and counts nothing.
 */
export function reserveTotpCheck(budget: RateLimiter, settings: LoginLimitSettings): boolean {
  if (!settings.rateLimitEnabled) return true
  if (budget.isLocked(TOTP_BUDGET_KEY)) return false
  budget.recordFailure(TOTP_BUDGET_KEY, MAX_TOTP_FAILURES_PER_WINDOW, TOTP_BUDGET_WINDOW_MINUTES)
  return true
}

/**
 * Give back a check {@link reserveTotpCheck} took, for a code that was right.
 * Only that one: a success does not forgive the wrong codes before it, which
 * may have been someone else's.
 */
export function returnTotpCheck(budget: RateLimiter, settings: LoginLimitSettings): void {
  if (settings.rateLimitEnabled) budget.release(TOTP_BUDGET_KEY)
}

/**
 * How long until `budget` checks codes again, in whole seconds (`Retry-After`),
 * for a check {@link reserveTotpCheck} just refused. At least 1: the lock can
 * lapse between that refusal and this read, and `Retry-After: 0` would invite
 * an immediate retry loop.
 */
export function totpBudgetRetrySeconds(budget: RateLimiter): number {
  return Math.max(1, budget.getRemainingLockSeconds(TOTP_BUDGET_KEY))
}

/** Audit a failed attempt and hold the answer back by `admin.failedAuthDelayMs`. */
export async function auditFailedAttempt(
  attempt: LoginAttempt,
  reason: AuditReason,
  settings: LoginLimitSettings,
): Promise<void> {
  await audit(attempt, false, reason)
  await Bun.sleep(settings.failedAuthDelayMs)
}

/** A successful sign-in: `key`'s failures are forgiven and the success audited. */
export async function recordSuccessfulLogin(
  limiter: RateLimiter,
  key: string,
  attempt: LoginAttempt,
  reason: AuditReason,
): Promise<void> {
  limiter.recordSuccess(key)
  await audit(attempt, true, reason)
}
