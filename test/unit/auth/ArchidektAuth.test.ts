import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  ArchidektAuth,
  ArchidektAuthError,
  isCredentialRefusal,
} from '../../../src/auth/ArchidektAuth'
import type { TokenStore, ArchidektToken } from '../../../src/auth/interfaces'
import { MemoryLogger, resetLogger, setLogger } from '../../test-utils'
import { stubFetch, type StubbedFetch } from '../../helpers/stub-fetch'
import {
  pseudoCatalog,
  pseudoString,
  rejectedSyncMessage,
  withGuardedLocaleAsync,
} from '../../helpers/sync-text'

const LOGIN_URL = 'https://archidekt.com/api/rest-auth/login/'
const REFRESH_URL = 'https://archidekt.com/api/rest-auth/token/refresh/'

/** What Archidekt answers a login with the wrong password. */
const BAD_CREDENTIALS = '{"non_field_errors":["Unable to log in with provided credentials."]}'

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

  test('logout clears the stored token', async () => {
    const validToken: ArchidektToken = {
      access_token: 'accessRepo',
      refresh_token: 'refreshRepo',
      user: { id: 1, username: 'user' },
      access_token_expiration: new Date(Date.now() + 3600000).toISOString(),
    }
    await tokenStore.save('archidekt', validToken)

    await auth.logout()
    expect(await auth.getStoredUser()).toBeNull()
    expect(await auth.getToken()).toBeNull()
  })

  test('logout is a no-op when nothing is stored', async () => {
    await auth.logout()
    expect(await auth.getStoredUser()).toBeNull()
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

  describe('failures', () => {
    let stubbed: StubbedFetch | undefined
    let logger: MemoryLogger

    beforeEach(() => {
      logger = new MemoryLogger()
      setLogger(logger)
    })

    afterEach(() => {
      stubbed?.restore()
      stubbed = undefined
    })

    const EXPIRED_LOGIN: ArchidektToken = {
      access_token: 'expiredAccess',
      refresh_token: 'validRefresh',
      user: { id: 1, username: 'user' },
      access_token_expiration: new Date(Date.now() - 1000).toISOString(),
    }

    /** A stored login whose access token has expired, so the next `getToken` refreshes it. */
    async function storeExpiredLogin(): Promise<void> {
      await tokenStore.save('archidekt', EXPIRED_LOGIN)
    }

    /** The text of every line logged at `level`. */
    const logged = (target: MemoryLogger, level: 'info' | 'error'): unknown[] =>
      target.entries.filter((entry) => entry.level === level).map((entry) => entry.args)

    /** What `run` rejected with, as an Archidekt auth error: its message and Archidekt's status. */
    async function authFailure(run: Promise<unknown>): Promise<[unknown, number]> {
      const error = await run.then(
        () => new Error('expected the promise to reject'),
        (reason: unknown) => reason,
      )
      if (!(error instanceof ArchidektAuthError)) throw new Error(`not an auth error: ${error}`)
      return [error.syncMessage, error.upstreamStatus]
    }

    test('a refused login quotes Archidekt’s reason beside the status, keyed', async () => {
      stubbed = stubFetch({ [LOGIN_URL]: () => new Response(BAD_CREDENTIALS, { status: 400 }) })

      expect(await authFailure(auth.login({ username: 'u', password: 'p' }))).toEqual([
        {
          message:
            'Archidekt answered the login with HTTP 400: Unable to log in with provided credentials.',
          messageKey: 'domain.sync.auth.loginFailedWithReason',
          messageParams: { status: 400, reason: 'Unable to log in with provided credentials.' },
        },
        400,
      ])
      expect(await auth.getStoredUser()).toBeNull()
    })

    test('several reasons are joined as clauses, each kept as Archidekt sent it', async () => {
      const body = JSON.stringify({ non_field_errors: ['First.', 'Second.'], detail: 'Third.' })
      stubbed = stubFetch({ [LOGIN_URL]: () => new Response(body, { status: 400 }) })

      expect(await rejectedSyncMessage(auth.login({ username: 'u', password: 'p' }))).toEqual({
        message: 'Archidekt answered the login with HTTP 400: First.; Second.; Third.',
        messageKey: 'domain.sync.auth.loginFailedWithReason',
        messageParams: {
          status: 400,
          reason: { list: ['First.', 'Second.', 'Third.'], join: 'clauses' },
        },
      })
    })

    test.each<[string, string]>([
      ['an empty reply', ''],
      ['an HTML error page', '<html><body>Bad Gateway</body></html>'],
      ['JSON without a reason', '{"code":"oops","non_field_errors":[7]}'],
    ])('a login failure with %s names only the status', async (_label, body) => {
      stubbed = stubFetch({ [LOGIN_URL]: () => new Response(body, { status: 503 }) })

      expect(await authFailure(auth.login({ username: 'u', password: 'p' }))).toEqual([
        {
          message: 'Archidekt answered the login with HTTP 503',
          messageKey: 'domain.sync.auth.loginFailed',
          messageParams: { status: 503 },
        },
        503,
      ])
    })

    test('a quoted reason is put on one line and capped', async () => {
      const body = JSON.stringify({ detail: `bad\n\u001b[31m${'x'.repeat(400)}` })
      stubbed = stubFetch({ [LOGIN_URL]: () => new Response(body, { status: 401 }) })

      const message = await rejectedSyncMessage(auth.login({ username: 'u', password: 'p' }))

      expect(message.messageParams).toEqual({
        status: 401,
        reason: `bad ${'x'.repeat(296)}…`,
      })
    })

    test.each<[string, unknown]>([
      ['null', null],
      ['no tokens', { user: { id: 1, username: 'u' } }],
      ['a malformed account', { access_token: 'a', refresh_token: 'r', user: { id: 'one' } }],
    ])('a login reply with %s is refused, and nothing is stored', async (_label, reply) => {
      stubbed = stubFetch({ [LOGIN_URL]: () => Response.json(reply) })

      expect(await authFailure(auth.login({ username: 'u', password: 'p' }))).toEqual([
        {
          message: 'Archidekt answered the login without a usable session',
          messageKey: 'domain.sync.auth.loginReplyInvalid',
        },
        200,
      ])
      expect(await tokenStore.load('archidekt')).toBeNull()
    })

    test('a login stores only the session fields it read', async () => {
      stubbed = stubFetch({
        [LOGIN_URL]: () =>
          Response.json({
            access_token: 'a',
            refresh_token: 'r',
            user: { id: 7, username: 'tester', email: 'tester@example.test' },
            extra: 'dropped',
          }),
      })

      await auth.login({ username: 'u', password: 'p' })

      expect(await tokenStore.load<ArchidektToken>('archidekt')).toEqual({
        access_token: 'a',
        refresh_token: 'r',
        user: { id: 7, username: 'tester' },
      })
    })

    test('a refused refresh rejects with the status and Archidekt’s reason', async () => {
      stubbed = stubFetch({
        [REFRESH_URL]: () =>
          new Response('{"detail":"Token is invalid or expired"}', { status: 401 }),
      })

      expect(await authFailure(auth.refreshToken(EXPIRED_LOGIN))).toEqual([
        {
          message:
            'Archidekt answered the session refresh with HTTP 401: Token is invalid or expired',
          messageKey: 'domain.sync.auth.refreshFailedWithReason',
          messageParams: { status: 401, reason: 'Token is invalid or expired' },
        },
        401,
      ])
    })

    test.each<[string, () => Response, string]>([
      [
        'a refused refresh',
        () => new Response('{"detail":"Token is invalid or expired"}', { status: 401 }),
        'Archidekt answered the session refresh with HTTP 401: Token is invalid or expired',
      ],
      [
        'a refresh with an empty error reply',
        () => new Response('', { status: 500 }),
        'Archidekt answered the session refresh with HTTP 500',
      ],
      [
        'a refresh reply without an access token',
        () => Response.json({ refresh_token: 'newRefresh' }),
        'Archidekt answered the session refresh without an access token',
      ],
      [
        'a refresh reply of null',
        () => Response.json(null),
        'Archidekt answered the session refresh without an access token',
      ],
    ])('%s logs why and asks for a fresh login', async (_label, reply, reason) => {
      await storeExpiredLogin()
      stubbed = stubFetch({ [REFRESH_URL]: reply })

      expect(await auth.getToken()).toBeNull()

      expect(logged(logger, 'error')).toEqual([
        [`Could not refresh the Archidekt session: ${reason}`],
      ])
      expect((await tokenStore.load<ArchidektToken>('archidekt'))?.access_token).toBe(
        'expiredAccess',
      )
    })

    test('a refreshed session is logged', async () => {
      await storeExpiredLogin()
      stubbed = stubFetch({ [REFRESH_URL]: () => Response.json({ access: 'newAccess' }) })

      expect(await auth.getToken()).toBe('newAccess')
      expect(logged(logger, 'info')).toEqual([['Refreshed the Archidekt session.']])
    })

    test('a logger given to the service takes its lines, not the process’s', async () => {
      await storeExpiredLogin()
      stubbed = stubFetch({ [REFRESH_URL]: () => Response.json({ access: 'newAccess' }) })
      const own = new MemoryLogger()

      expect(await new ArchidektAuth(tokenStore, own).getToken()).toBe('newAccess')

      expect(logged(own, 'info')).toEqual([['Refreshed the Archidekt session.']])
      expect(logger.entries).toEqual([])
    })

    test('the refresh log reads in the process’s language, its reason too', async () => {
      await storeExpiredLogin()
      stubbed = stubFetch({ [REFRESH_URL]: () => new Response('', { status: 500 }) })

      await withGuardedLocaleAsync('en-XA', pseudoCatalog(), () => auth.getToken())

      const reason = pseudoString('domain.sync.auth.refreshFailed').replace('{status}', '500')
      expect(logged(logger, 'error')).toEqual([
        [pseudoString('domain.sync.auth.refreshError').replace('{error}', reason)],
      ])
    })
  })

  describe('isCredentialRefusal', () => {
    test.each<[number, boolean]>([
      [400, true],
      [401, true],
      [403, true],
      [429, false],
      [500, false],
      [503, false],
      [200, false],
    ])('%d → %p', (status, refusal) => {
      expect(isCredentialRefusal(status)).toBe(refusal)
    })
  })
})
