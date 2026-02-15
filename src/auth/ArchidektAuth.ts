import type { AuthService, TokenStore, ArchidektToken, ArchidektCredentials } from './interfaces'
import { getLogger } from '../logger'

export class ArchidektAuth implements AuthService<ArchidektCredentials> {
  private readonly SITE_NAME = 'archidekt'
  private readonly BASE_URL = 'https://archidekt.com/api/rest-auth'

  constructor(private tokenStore: TokenStore) {}

  async getStoredUser(): Promise<{ username: string; id: number } | null> {
    const token = await this.tokenStore.load<ArchidektToken>(this.SITE_NAME)
    return token?.user || null
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
      throw new Error(`Login failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ArchidektToken
    await this.tokenStore.save(this.SITE_NAME, data)
  }

  async getToken(): Promise<string | null> {
    const token = await this.tokenStore.load<ArchidektToken>(this.SITE_NAME)

    if (!token) {
      return null
    }

    if (this.isExpired(token)) {
      getLogger().info('Token expired, refreshing...')
      try {
        return await this.refreshToken(token)
      } catch (error) {
        getLogger().error('Failed to refresh token:', error)
        // If refresh fails, we might want to prompt for re-login, but for now just return null
        return null // Or throw, depending on desired behavior. Returning null forces re-login flow usually.
      }
    }

    return token.access_token
  }

  private isExpired(token: ArchidektToken): boolean {
    if (!token.access_token_expiration) {
      return true // Assume expired if no timestamp
    }
    // Check if expired or about to expire in the next 30 seconds
    const expirationDate = new Date(token.access_token_expiration)
    return Date.now() >= expirationDate.getTime() - 30000
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
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as {
      access?: string
      access_token?: string
      refresh_token?: string
      access_token_expiration?: string
    }
    // Merge new data with old token data (preserve user info if not returned)
    // The refresh endpoint usually returns at least access_token.
    // It might return a new refresh_token too.
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
