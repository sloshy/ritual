import { verifyAdminUser, isTotpEnabled, getTotpSecret } from '../auth'
import { verifyTotp } from '../totp'
import {
  createSession,
  buildSessionCookie,
  destroySession,
  buildExpiredSessionCookie,
} from '../session'
import { appendAuditLog, createAuditEntry } from '../audit-log'
import { loadRitualConfig } from '../../ritual-config'
import { globalRateLimiter } from '../rate-limit'
import { MAX_BODY_SIZE, MAX_USERNAME_LENGTH, MAX_PASSWORD_LENGTH } from '../validation'

interface LoginRequest {
  username: string
  password: string
  totpCode?: string
}

interface LoginResponse {
  success: boolean
  message?: string
  totpRequired?: boolean
}

interface RateLimitResponse {
  success: false
  error: string
  retryAfterSeconds: number
}

export async function handleLogin(req: Request, clientIp: string): Promise<Response> {
  const config = await loadRitualConfig()
  const userAgent = req.headers.get('User-Agent') ?? ''

  // Rate limit check
  if (config.rateLimitEnabled && globalRateLimiter.isLocked(clientIp)) {
    const remaining = globalRateLimiter.getRemainingLockSeconds(clientIp)
    const resp: RateLimitResponse = {
      success: false,
      error: 'Too many failed attempts. Try again later.',
      retryAfterSeconds: remaining,
    }
    return Response.json(resp, { status: 429, headers: { 'Retry-After': String(remaining) } })
  }

  const contentLength = Number(req.headers.get('Content-Length') ?? '0')
  if (contentLength > MAX_BODY_SIZE) {
    return Response.json({ success: false, message: 'Request body too large' }, { status: 413 })
  }

  let body: LoginRequest
  try {
    body = (await req.json()) as LoginRequest
  } catch {
    return Response.json({ success: false, message: 'Invalid request body' }, { status: 400 })
  }

  const { username, password, totpCode } = body
  if (!username || !password) {
    return Response.json(
      { success: false, message: 'Username and password are required' },
      { status: 400 },
    )
  }

  if (
    username.length > MAX_USERNAME_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    (totpCode && (totpCode.length !== 6 || !/^\d{6}$/.test(totpCode)))
  ) {
    return Response.json(
      { success: false, message: 'Input exceeds maximum length' },
      { status: 400 },
    )
  }

  const valid = await verifyAdminUser(username, password)
  if (!valid) {
    if (config.rateLimitEnabled) {
      globalRateLimiter.recordFailure(
        clientIp,
        config.rateLimitMaxAttempts,
        config.rateLimitWindowMinutes,
      )
    }
    await appendAuditLog(
      createAuditEntry(clientIp, username, false, 'Invalid credentials', userAgent),
    )
    await Bun.sleep(config.failedAuthDelayMs)
    return Response.json(
      { success: false, message: 'Invalid username or password' },
      { status: 401 },
    )
  }

  // TOTP verification
  const totpEnabled = await isTotpEnabled()
  if (totpEnabled) {
    if (!totpCode) {
      const resp: LoginResponse = {
        success: false,
        message: 'TOTP code required',
        totpRequired: true,
      }
      return Response.json(resp, { status: 401, headers: { 'X-TOTP-Required': 'true' } })
    }

    const secret = await getTotpSecret()
    if (!secret) {
      return Response.json({ success: false, message: 'TOTP configuration error' }, { status: 500 })
    }

    const totpValid = await verifyTotp(secret, totpCode)
    if (!totpValid) {
      if (config.rateLimitEnabled) {
        globalRateLimiter.recordFailure(
          clientIp,
          config.rateLimitMaxAttempts,
          config.rateLimitWindowMinutes,
        )
      }
      await appendAuditLog(
        createAuditEntry(clientIp, username, false, 'Invalid TOTP code', userAgent),
      )
      await Bun.sleep(config.failedAuthDelayMs)
      return Response.json(
        { success: false, message: 'Invalid TOTP code', totpRequired: true },
        { status: 401, headers: { 'X-TOTP-Required': 'true' } },
      )
    }
  }

  // Auth succeeded
  globalRateLimiter.recordSuccess(clientIp)
  const session = createSession(username, clientIp)
  await appendAuditLog(createAuditEntry(clientIp, username, true, 'Login successful', userAgent))

  const resp: LoginResponse = { success: true }
  return Response.json(resp, {
    headers: { 'Set-Cookie': buildSessionCookie(session.token, config.secureCookies) },
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
    headers: { 'Set-Cookie': buildExpiredSessionCookie(config.secureCookies) },
  })
}
