export interface TokenStore {
  save(site: string, data: unknown): Promise<void>
  load<T>(site: string): Promise<T | null>
  clear(site: string): Promise<void>
}

export interface AuthService<C = unknown> {
  login(credentials: C): Promise<void>
  getToken(): Promise<string | null>
}

export interface ArchidektToken {
  access_token: string
  refresh_token: string
  // Archidekt does not currently return explicit expiration fields — the
  // expirations are carried in the JWTs' `exp` claims. These remain here as an
  // optional fast path in case the API starts returning them (dj-rest-auth can).
  access_token_expiration?: string
  refresh_token_expiration?: string
  user: {
    id: number
    username: string
  }
}

export interface ArchidektCredentials {
  username: string
  password?: string
}

/**
 * A snapshot of the locally stored Archidekt login, including how long the
 * access and refresh tokens remain valid. When neither token is usable,
 * `loginRequired` is true and the user must sign in again.
 */
export interface ArchidektLoginStatus {
  loggedIn: boolean
  username: string | null
  /** ISO string for when the access token expires, or null if unknown. */
  accessTokenExpiration: string | null
  accessTokenValid: boolean
  /** ISO string for when the refresh token expires, or null if unknown. */
  refreshTokenExpiration: string | null
  refreshTokenValid: boolean
  /** True when neither token is valid, so account features need a fresh login. */
  loginRequired: boolean
}
