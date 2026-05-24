import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { ArchidektAuth } from '../../../src/auth/ArchidektAuth'
import type { TokenStore, ArchidektToken } from '../../../src/auth/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'

class MockTokenStore implements TokenStore {
  store = new Map<string, any>()
  async save(site: string, data: any) {
    this.store.set(site, data)
  }
  async load<T>(site: string) {
    return (this.store.get(site) as T) || null
  }
  async clear(site: string) {
    this.store.delete(site)
  }
}

function makeJwt(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow
  const body = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return `${header}.${body}.signature`
}

describe('ArchidektAuth', () => {
  let tokenStore: MockTokenStore
  let auth: ArchidektAuth
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    originalFetch = global.fetch
    setLogger(new MemoryLogger())
    tokenStore = new MockTokenStore()
    auth = new ArchidektAuth(tokenStore)
    mock.restore()
  })

  afterEach(() => {
    global.fetch = originalFetch
    resetLogger()
  })

  test('should return null if no token exists', async () => {
    const token = await auth.getToken()
    expect(token).toBeNull()
  })

  test('should return valid token if not expired', async () => {
    const validToken: ArchidektToken = {
      access_token: 'accessRepo',
      refresh_token: 'refreshRepo',
      user: { id: 1, username: 'user' },
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }
    await tokenStore.save('archidekt', validToken)

    const token = await auth.getToken()
    expect(token).toBe('accessRepo')
  })

  test('should refresh token if expired', async () => {
    const expiredToken: ArchidektToken = {
      access_token: 'expiredAccess',
      refresh_token: 'validRefresh',
      user: { id: 1, username: 'user' },
      access_token_expiration: new Date(Date.now() - 1000).toISOString(), // Expired
    }
    await tokenStore.save('archidekt', expiredToken)

    const refreshResponse = {
      access_token: 'newAccess',
      refresh_token: 'newRefresh',
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }

    global.fetch = mock(async (url: string | URL | Request) => {
      const urlString = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (urlString.includes('/token/refresh/')) {
        return new Response(JSON.stringify(refreshResponse), { status: 200 })
      }
      return new Response('Not Found', { status: 404 })
    }) as any

    const token = await auth.getToken()
    expect(token).toBe('newAccess')

    const savedToken = await tokenStore.load<ArchidektToken>('archidekt')
    expect(savedToken?.access_token).toBe('newAccess')
    expect(savedToken?.refresh_token).toBe('newRefresh')
  })

  test('should return stored user', async () => {
    const validToken: ArchidektToken = {
      access_token: 'accessRepo',
      refresh_token: 'refreshRepo',
      user: { id: 123, username: 'testuser' },
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }
    await tokenStore.save('archidekt', validToken)

    const user = await auth.getStoredUser()
    expect(user).not.toBeNull()
    expect(user?.username).toBe('testuser')
    expect(user?.id).toBe(123)
  })

  test('should return null user if no token', async () => {
    const user = await auth.getStoredUser()
    expect(user).toBeNull()
  })

  describe('getStatus', () => {
    test('reports a login is required when no token exists', async () => {
      const status = await auth.getStatus()
      expect(status).toEqual({
        loggedIn: false,
        username: null,
        accessTokenExpiration: null,
        accessTokenValid: false,
        refreshTokenExpiration: null,
        refreshTokenValid: false,
        loginRequired: true,
      })
    })

    test('derives token validity from the JWT exp claims', async () => {
      await tokenStore.save('archidekt', {
        access_token: makeJwt(3600),
        refresh_token: makeJwt(3600 * 24 * 30),
        user: { id: 1, username: 'user' },
      })

      const status = await auth.getStatus()
      expect(status.loggedIn).toBe(true)
      expect(status.username).toBe('user')
      expect(status.accessTokenValid).toBe(true)
      expect(status.refreshTokenValid).toBe(true)
      expect(status.loginRequired).toBe(false)
      expect(status.accessTokenExpiration).not.toBeNull()
      expect(status.refreshTokenExpiration).not.toBeNull()
    })

    test('does not require login when only the access token has expired', async () => {
      await tokenStore.save('archidekt', {
        access_token: makeJwt(-60),
        refresh_token: makeJwt(3600 * 24 * 30),
        user: { id: 1, username: 'user' },
      })

      const status = await auth.getStatus()
      expect(status.accessTokenValid).toBe(false)
      expect(status.refreshTokenValid).toBe(true)
      expect(status.loginRequired).toBe(false)
    })

    test('requires login when both tokens have expired', async () => {
      await tokenStore.save('archidekt', {
        access_token: makeJwt(-3600),
        refresh_token: makeJwt(-60),
        user: { id: 1, username: 'user' },
      })

      const status = await auth.getStatus()
      expect(status.loggedIn).toBe(true)
      expect(status.accessTokenValid).toBe(false)
      expect(status.refreshTokenValid).toBe(false)
      expect(status.loginRequired).toBe(true)
    })

    test('prefers explicit expiration fields over the JWT claim', async () => {
      const futureIso = new Date(Date.now() + 3600_000).toISOString()
      await tokenStore.save('archidekt', {
        access_token: makeJwt(-3600), // JWT says expired...
        access_token_expiration: futureIso, // ...but explicit field says valid
        refresh_token: makeJwt(-3600),
        refresh_token_expiration: futureIso,
        user: { id: 1, username: 'user' },
      })

      const status = await auth.getStatus()
      expect(status.accessTokenExpiration).toBe(futureIso)
      expect(status.accessTokenValid).toBe(true)
      expect(status.refreshTokenValid).toBe(true)
      expect(status.loginRequired).toBe(false)
    })
  })
})
