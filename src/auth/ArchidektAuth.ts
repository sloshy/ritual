import type {
  AuthService,
  TokenStore,
  ArchidektToken,
  ArchidektCredentials,
  ArchidektLoginStatus,
} from './interfaces'
import { getJwtExpiration } from './jwt'
import { getLogger } from '../logger'
import { throwHttpError } from '../errors'

// Refresh slightly before actual expiry so a token isn't used mid-request.
const EXPIRY_BUFFER_MS = 30_000

type StoredUser = { username: string; id: number }

type RefreshResponse = {
  access?: string
  access_token?: string
  refresh_token?: string
  access_token_expiration?: string
}

export class ArchidektAuth implements AuthService<ArchidektCredentials> {
  private readonly SITE_NAME = 'archidekt'
  private readonly BASE_URL = 'https://archidekt.com/api/rest-auth'

  constructor(private tokenStore: TokenStore) {}

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

    if (!response.ok) {
      throwHttpError(response, 'Login failed')
    }

    const data = (await response.json()) as ArchidektToken
    await this.tokenStore.save(this.SITE_NAME, data)
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
        getLogger().info('Token refreshed successfully.')
        return accessToken
      } catch (error) {
        getLogger().error('Failed to refresh token:', error)
        // Returning null signals the caller to re-enter the login flow.
        return null
      }
    }

    return token.access_token
  }

  // Prefer an explicit expiration field if Archidekt ever returns one, otherwise
  // fall back to the token's own JWT `exp` claim.
  private getTokenExpiration(explicitIso: string | undefined, jwt: string): Date | null {
    return explicitIso ? new Date(explicitIso) : getJwtExpiration(jwt)
  }

  private isExpired(token: ArchidektToken): boolean {
    const expiration = this.getTokenExpiration(token.access_token_expiration, token.access_token)
    if (!expiration) {
      return true
    }
    return Date.now() >= expiration.getTime() - EXPIRY_BUFFER_MS
  }

  private async refreshToken(oldToken: ArchidektToken): Promise<string> {
    const response = await fetch(`${this.BASE_URL}/token/refresh/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh: oldToken.refresh_token }),
    })

    if (!response.ok) {
      throwHttpError(response, 'Token refresh failed')
    }

    const data = (await response.json()) as RefreshResponse
    // Preserve fields (e.g. user info) that the refresh endpoint may omit
    const newToken: ArchidektToken = {
      ...oldToken,
    }

    const nextAccessToken = data.access ?? data.access_token
    if (!nextAccessToken) {
      throw new Error('Token refresh failed: missing access token in response')
    }
    newToken.access_token = nextAccessToken
    if (data.refresh_token) {
      newToken.refresh_token = data.refresh_token
    }
    if (data.access_token_expiration) {
      newToken.access_token_expiration = data.access_token_expiration
    }

    await this.tokenStore.save(this.SITE_NAME, newToken)

    return newToken.access_token
  }
}
