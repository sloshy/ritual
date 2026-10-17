import {
  ArchidektRequestError,
  archidektReasons,
  failureMessage,
  type FailureKeyDrift,
  type FailureKeyPair,
} from './archidekt-reply'
import type {
  AuthService,
  TokenStore,
  ArchidektToken,
  ArchidektCredentials,
  ArchidektLoginStatus,
} from './interfaces'
import { getJwtExpiration } from './jwt'
import { t } from '../i18n/t'
import { isSyncMessage, syncMessage, type SyncMessage } from '../sync/message'
import { getErrorMessage } from '../util/errors'
import { isRecord } from '../util/json'
import { getLogger, type Logger } from '../util/logger'
import { parsedJson, readReplyText } from '../util/reply-text'

// Refresh slightly before actual expiry so a token isn't used mid-request.
const EXPIRY_BUFFER_MS = 30_000

type StoredUser = { username: string; id: number }

/** The two requests the login makes, each failure worded by a pair of keys. */
type AuthRequest = 'login' | 'refresh'

/** A failure Archidekt gave no reason for, and the same failure quoting its reason. */
const FAILURE_KEYS = {
  login: {
    plain: 'domain.sync.auth.loginFailed',
    withReason: 'domain.sync.auth.loginFailedWithReason',
  },
  refresh: {
    plain: 'domain.sync.auth.refreshFailed',
    withReason: 'domain.sync.auth.refreshFailedWithReason',
  },
} as const satisfies Record<AuthRequest, FailureKeyPair>

/** Both requests' keys take the status (and the reason) alone. */
type KeysDrift = FailureKeyDrift<AuthRequest, typeof FAILURE_KEYS, Record<AuthRequest, never>>
const KEYS_AGREE: [KeysDrift] extends [never] ? true : KeysDrift = true
void KEYS_AGREE

/**
 * A failed Archidekt auth request — an {@link ArchidektRequestError} whose
 * `upstreamStatus` lets the admin login route tell a refused login (a 4xx)
 * from Archidekt failing (anything else).
 */
export class ArchidektAuthError extends ArchidektRequestError {
  constructor(message: SyncMessage, upstreamStatus: number) {
    super(message, upstreamStatus)
    this.name = 'ArchidektAuthError'
  }
}

/** Whether Archidekt refused the credentials themselves: a 4xx, other than a rate limit. */
export function isCredentialRefusal(upstreamStatus: number): boolean {
  return upstreamStatus >= 400 && upstreamStatus < 500 && upstreamStatus !== 429
}

/**
 * A failed Archidekt auth request as the error to throw: the status as a
 * number, and Archidekt's own reason when its reply carries one.
 */
async function authRequestFailure(
  response: Response,
  request: AuthRequest,
): Promise<ArchidektAuthError> {
  const reasons = archidektReasons(await readReplyText(response))
  const status = response.status
  return new ArchidektAuthError(failureMessage(FAILURE_KEYS[request], {}, status, reasons), status)
}

/** A non-empty string, or `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** An optional string field: absent, or a string. */
function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

/**
 * Validate what Archidekt answered a login with: a session to store. Only the
 * fields Ritual reads are kept, so nothing unvalidated reaches the token file.
 * A reply that is not one (no tokens, a malformed account, `null`) is the
 * message saying so.
 */
export function parseArchidektToken(json: unknown): ArchidektToken | SyncMessage {
  const invalid = syncMessage('domain.sync.auth.loginReplyInvalid')
  if (!isRecord(json)) return invalid
  const access = nonEmptyString(json.access_token)
  const refresh = nonEmptyString(json.refresh_token)
  const { user, access_token_expiration: accessExp, refresh_token_expiration: refreshExp } = json
  if (access === undefined || refresh === undefined) return invalid
  if (!optionalString(accessExp) || !optionalString(refreshExp)) return invalid
  const token: ArchidektToken = { access_token: access, refresh_token: refresh }
  if (user !== undefined) {
    if (!isRecord(user)) return invalid
    const { id, username } = user
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || typeof username !== 'string') {
      return invalid
    }
    token.user = { id, username }
  }
  if (accessExp !== undefined) token.access_token_expiration = accessExp
  if (refreshExp !== undefined) token.refresh_token_expiration = refreshExp
  return token
}

/** What a token refresh answers, validated. */
export type RefreshReply = {
  accessToken: string
  refreshToken?: string
  accessTokenExpiration?: string
}

/**
 * Validate what Archidekt answered a token refresh with: the new access token
 * (`access`, or `access_token`), and a rotated refresh token and expiry when
 * it sends them. A reply without a usable access token (`null` included) is the
 * message saying so.
 */
export function parseRefreshReply(json: unknown): RefreshReply | SyncMessage {
  const invalid = syncMessage('domain.sync.auth.refreshNoAccessToken')
  if (!isRecord(json)) return invalid
  const accessToken = nonEmptyString(json.access) ?? nonEmptyString(json.access_token)
  const { refresh_token: refreshToken, access_token_expiration: expiration } = json
  if (accessToken === undefined) return invalid
  if (!optionalString(refreshToken) || !optionalString(expiration)) return invalid
  const reply: RefreshReply = { accessToken }
  if (refreshToken) reply.refreshToken = refreshToken
  if (expiration) reply.accessTokenExpiration = expiration
  return reply
}

export class ArchidektAuth implements AuthService<ArchidektCredentials> {
  private readonly SITE_NAME = 'archidekt'
  private readonly BASE_URL = 'https://archidekt.com/api/rest-auth'

  /**
   * `logger` takes the session-refresh lines; a command that owns stdout (a
   * sync under `--output json`) passes its scripting logger so they never
   * reach it. Without one, each line goes to the process's logger.
   */
  constructor(
    private readonly tokenStore: TokenStore,
    private readonly logger?: Logger,
  ) {}

  private log(): Logger {
    return this.logger ?? getLogger()
  }

  async getStoredUser(): Promise<StoredUser | null> {
    const token = await this.tokenStore.load<ArchidektToken>(this.SITE_NAME)
    return token?.user || null
  }

  async getStatus(): Promise<ArchidektLoginStatus> {
    const token = await this.tokenStore.load<ArchidektToken>(this.SITE_NAME)
    if (!token) {
      return {
        loggedIn: false,
        username: null,
        accessTokenExpiration: null,
        accessTokenValid: false,
        refreshTokenExpiration: null,
        refreshTokenValid: false,
        loginRequired: true,
      }
    }

    const now = Date.now()
    const accessExpiration = this.getTokenExpiration(
      token.access_token_expiration,
      token.access_token,
    )
    const refreshExpiration = this.getTokenExpiration(
      token.refresh_token_expiration,
      token.refresh_token,
    )
    const accessTokenValid = accessExpiration !== null && accessExpiration.getTime() > now
    const refreshTokenValid = refreshExpiration !== null && refreshExpiration.getTime() > now

    return {
      loggedIn: true,
      username: token.user?.username ?? null,
      accessTokenExpiration: accessExpiration?.toISOString() ?? null,
      accessTokenValid,
      refreshTokenExpiration: refreshExpiration?.toISOString() ?? null,
      refreshTokenValid,
      // An expired access token is fine on its own — it auto-refreshes. Only when
      // the refresh token is also dead does the user have to log in again. A token
      // whose expiry can't be determined counts as invalid here (safe-fail:
      // better to prompt a login than to rely on a possibly-dead token).
      loginRequired: !accessTokenValid && !refreshTokenValid,
    }
  }

  async login(credentials: ArchidektCredentials): Promise<void> {
    const response = await fetch(`${this.BASE_URL}/login/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    })

    if (!response.ok) throw await authRequestFailure(response, 'login')

    // A 2xx reply that is not JSON parses to `undefined`: a reply without a usable
    // session (502 on the admin route), never a SyntaxError (500).
    const token = parseArchidektToken(parsedJson(await response.text()))
    if (isSyncMessage(token)) throw new ArchidektAuthError(token, response.status)
    await this.tokenStore.save(this.SITE_NAME, token)
  }

  /** Forget the stored login (token + user); a no-op when none is stored. */
  async logout(): Promise<void> {
    await this.tokenStore.clear(this.SITE_NAME)
  }

  async getToken(): Promise<string | null> {
    const token = await this.tokenStore.load<ArchidektToken>(this.SITE_NAME)

    if (!token) {
      return null
    }

    if (this.isExpired(token)) {
      try {
        const accessToken = await this.refreshToken(token)
        this.log().info(t('domain.sync.auth.refreshed'))
        return accessToken
      } catch (error) {
        this.log().error(t('domain.sync.auth.refreshError', { error: getErrorMessage(error) }))
        // Returning null signals the caller to re-enter the login flow.
        return null
      }
    }

    return token.access_token
  }

  // Prefer an explicit expiration field if Archidekt ever returns one, otherwise
  // fall back to the token's own JWT `exp` claim.
  //
  // `jwt` is declared non-optional on `ArchidektToken` but the token store
  // JSON-parses whatever is on disk, so a truncated or hand-edited file can hand
  // this `undefined`. A missing token has no expiry rather than throwing: that
  // reads as "invalid", which is exactly what `login status` should report about
  // a token file it cannot make sense of.
  private getTokenExpiration(
    explicitIso: string | undefined,
    jwt: string | undefined,
  ): Date | null {
    if (explicitIso) return new Date(explicitIso)
    return typeof jwt === 'string' ? getJwtExpiration(jwt) : null
  }

  private isExpired(token: ArchidektToken): boolean {
    const expiration = this.getTokenExpiration(token.access_token_expiration, token.access_token)
    if (!expiration) {
      return true
    }
    return Date.now() >= expiration.getTime() - EXPIRY_BUFFER_MS
  }

  /**
   * Trade the stored refresh token for a new access token, store it, and
   * return it. Rejects with an {@link ArchidektAuthError} when Archidekt
   * refuses or answers without one. Public so the failure can be observed:
   * {@link getToken} logs it and asks for a fresh login instead.
   */
  async refreshToken(oldToken: ArchidektToken): Promise<string> {
    const response = await fetch(`${this.BASE_URL}/token/refresh/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh: oldToken.refresh_token }),
    })

    if (!response.ok) throw await authRequestFailure(response, 'refresh')

    const reply = parseRefreshReply(parsedJson(await response.text()))
    if (isSyncMessage(reply)) throw new ArchidektAuthError(reply, response.status)
    // Preserve fields (e.g. user info) that the refresh endpoint omits.
    const newToken: ArchidektToken = { ...oldToken, access_token: reply.accessToken }
    if (reply.refreshToken !== undefined) newToken.refresh_token = reply.refreshToken
    if (reply.accessTokenExpiration !== undefined) {
      newToken.access_token_expiration = reply.accessTokenExpiration
    }

    await this.tokenStore.save(this.SITE_NAME, newToken)

    return newToken.access_token
  }
}
