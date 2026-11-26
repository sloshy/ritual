import { verifyAdminUser, isTotpEnabled, getTotpSecret } from '../auth'
import { verifyTotp } from '../totp'
import {
  createSession,
  buildSessionCookie,
  destroySession,
  buildExpiredSessionCookie,
} from '../session'
import {
  auditFailedAttempt,
  globalTotpBudget,
  recordSuccessfulLogin,
  reserveAttempt,
  reserveTotpCheck,
  returnTotpCheck,
  totpBudgetRetrySeconds,
  type LoginAttempt,
} from '../login-attempt'
import { AUDIT_REASONS } from '../audit-reasons'
import { loadRitualConfig } from '../../config/ritual-config'
import { globalRateLimiter } from '../rate-limit'
import { apiError, readJsonObjectBody, type ApiErrorResponse } from '../../api/http'
import { apiMessage, type ApiMessage } from '../../api/result'
import { MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH } from '../validation'

/** `POST /api/login` when the password was right but a two-factor code is still needed. */
interface TotpRequiredResponse extends ApiErrorResponse {
  totpRequired: true
}

/** `POST /api/login` on a successful sign-in; the session rides in `Set-Cookie`. */
interface LoginSuccessResponse {
  success: true
}

/**
 * `POST /api/login` (429) while sign-in is locked for this address: the shared
 * refusal plus how long the lock has left, which the `Retry-After` header also
 * carries.
 */
interface RateLimitResponse extends ApiErrorResponse {
  retryAfterSeconds: number
}

/** The refusal at `status`, plus the header that tells the login form to ask for a code. */
function totpRefusal(message: ApiMessage, status: number): Response {
  const resp: TotpRequiredResponse = { success: false, ...message, totpRequired: true }
  return Response.json(resp, { status, headers: { 'X-TOTP-Required': 'true' } })
}

/** The 429 while sign-in is locked for `remaining` more seconds. */
function rateLimitedResponse(remaining: number): Response {
  const resp: RateLimitResponse = {
    success: false,
    ...apiMessage('admin.api.login.rateLimited'),
    retryAfterSeconds: remaining,
  }
  return Response.json(resp, { status: 429, headers: { 'Retry-After': String(remaining) } })
}

export async function handleLogin(req: Request, clientIp: string): Promise<Response> {
  const config = await loadRitualConfig()
  const userAgent = req.headers.get('User-Agent') ?? ''

  // Rate limit check
  if (config.admin.rateLimitEnabled && globalRateLimiter.isLocked(clientIp)) {
    return rateLimitedResponse(globalRateLimiter.getRemainingLockSeconds(clientIp))
  }

  const parsed = await readJsonObjectBody(req)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  // Read as strings or not at all: a non-string field is a missing one.
  const username = typeof body.username === 'string' ? body.username : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const totpCode = typeof body.totpCode === 'string' ? body.totpCode : undefined
  if (!username || !password) {
    return apiError(apiMessage('admin.api.field.credentialsRequired'), 400)
  }

  if (
    username.length > MAX_USERNAME_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    (totpCode && (totpCode.length !== 6 || !/^\d{6}$/.test(totpCode)))
  ) {
    return apiError(apiMessage('admin.api.login.inputTooLong'), 400)
  }

  // Counted before the password is checked, so a burst of parallel guesses
  // gets no more checks than the limit: the ones past it are answered as
  // locked. The body was read since the check above, so it is made again here.
  if (!reserveAttempt(globalRateLimiter, clientIp, config.admin)) {
    return rateLimitedResponse(globalRateLimiter.getRemainingLockSeconds(clientIp))
  }
  // An answer that is no failure gives the reserved attempt back.
  const release = (): void => {
    if (config.admin.rateLimitEnabled) globalRateLimiter.release(clientIp)
  }

  const attempt: LoginAttempt = { clientIp, username, userAgent }
  const valid = await verifyAdminUser(username, password)
  if (!valid) {
    await auditFailedAttempt(attempt, AUDIT_REASONS.invalidCredentials, config.admin)
    return apiError(apiMessage('admin.api.login.invalidCredentials'), 401)
  }

  // TOTP verification
  const totpEnabled = await isTotpEnabled()
  if (totpEnabled) {
    if (!totpCode) {
      release()
      return totpRefusal(apiMessage('admin.api.login.totpRequired'), 401)
    }

    const secret = await getTotpSecret()
    if (!secret) {
      release()
      return apiError(apiMessage('admin.api.login.totpMisconfigured'), 500)
    }

    // Wrong codes from every address draw on one budget: once it is spent, no
    // code is checked until its window passes, and this attempt is not
    // charged to the address.
    if (!reserveTotpCheck(globalTotpBudget, config.admin)) {
      release()
      return rateLimitedResponse(totpBudgetRetrySeconds(globalTotpBudget))
    }
    const totpValid = await verifyTotp(secret, totpCode)
    if (!totpValid) {
      await auditFailedAttempt(attempt, AUDIT_REASONS.invalidTotp, config.admin)
      return totpRefusal(apiMessage('admin.api.login.totpInvalid'), 401)
    }
    returnTotpCheck(globalTotpBudget, config.admin)
  }

  // Auth succeeded
  await recordSuccessfulLogin(globalRateLimiter, clientIp, attempt, AUDIT_REASONS.loginSucceeded)
  const session = createSession(username, clientIp)

  const resp: LoginSuccessResponse = { success: true }
  return Response.json(resp, {
    headers: { 'Set-Cookie': buildSessionCookie(session.token, config.admin.secureCookies) },
  })
}

interface LogoutResponse {
  success: boolean
}

export async function handleLogout(sessionToken: string): Promise<Response> {
  const config = await loadRitualConfig()
  destroySession(sessionToken)
  const resp: LogoutResponse = { success: true }
  return Response.json(resp, {
    headers: { 'Set-Cookie': buildExpiredSessionCookie(config.admin.secureCookies) },
  })
}
