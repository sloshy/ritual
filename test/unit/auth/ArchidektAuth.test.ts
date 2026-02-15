import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
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

describe('ArchidektAuth', () => {
  let tokenStore: MockTokenStore
  let auth: ArchidektAuth

  beforeEach(() => {
    setLogger(new MemoryLogger())
    tokenStore = new MockTokenStore()
    auth = new ArchidektAuth(tokenStore)
    mock.restore()
  })

  afterEach(() => {
    resetLogger()
  })

  it('should return null if no token exists', async () => {
    const token = await auth.getToken()
    expect(token).toBeNull()
  })

  it('should return valid token if not expired', async () => {
    const validToken: ArchidektToken = {
      access_token: 'accessRepo',
      refresh_token: 'refreshRepo',
      token_type: 'Bearer',
      scope: 'read',
      user: { id: 1, username: 'user' },
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }
    await tokenStore.save('archidekt', validToken)

    const token = await auth.getToken()
    expect(token).toBe('accessRepo')
  })

  it('should refresh token if expired', async () => {
    const expiredToken: ArchidektToken = {
      access_token: 'expiredAccess',
      refresh_token: 'validRefresh',
      token_type: 'Bearer',
      scope: 'read',
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
      if (url.toString().includes('/token/refresh/')) {
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

  it('should return stored user', async () => {
    const validToken: ArchidektToken = {
      access_token: 'accessRepo',
      refresh_token: 'refreshRepo',
      token_type: 'Bearer',
      scope: 'read',
      user: { id: 123, username: 'testuser' },
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }
    await tokenStore.save('archidekt', validToken)

    const user = await auth.getStoredUser()
    expect(user).not.toBeNull()
    expect(user?.username).toBe('testuser')
    expect(user?.id).toBe(123)
  })

  it('should return null user if no token', async () => {
    const user = await auth.getStoredUser()
    expect(user).toBeNull()
  })
})
