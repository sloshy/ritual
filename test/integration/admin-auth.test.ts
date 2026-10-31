import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
import type { MessageKey } from '../../src/i18n/messages/en'
import path from 'node:path'
import {
  createAdminUser,
  verifyAdminUser,
  adminUserExists,
  getAdminUsername,
  isTotpEnabled,
  setTotpSecret,
} from '../../src/admin/auth'
import { startAdminServer } from '../../src/admin/server'
import { getSetupToken } from '../../src/admin/setup-token'
import { handleSetup } from '../../src/admin/api/setup'
import { handleLogin } from '../../src/admin/api/auth-login'
import { handleTotpVerifySetup } from '../../src/admin/api/totp'
import { handleArchidektLogin } from '../../src/admin/api/login'
import type { ApiErrorResponse } from '../../src/api/http'
import { createSession, getSessionCookieName } from '../../src/admin/session'
import { bindWorkspace, writeConfig, type BoundWorkspace } from '../helpers/workspace'
import { keyedRefusal } from '../helpers/api-message'
import { globalRateLimiter } from '../../src/admin/rate-limit'

/**
 * The auth helpers write a real credentials file, so they belong here rather
 * than in the unit suite — and on a throwaway workspace rather than a fixed
 * directory under `test/`, which two suites running at once would share (and
 * which raced ESLint's directory scan).
 */

let ws: BoundWorkspace

describe('admin auth (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('adminUserExists returns false when no admin exists', async () => {
    expect(await adminUserExists()).toBe(false)
  })

  test('createAdminUser creates a user that can be verified', async () => {
    await createAdminUser('admin', 'test1234')

    expect(await adminUserExists()).toBe(true)
    expect(await verifyAdminUser('admin', 'test1234')).toBe(true)
  })

  test('verifyAdminUser rejects wrong password', async () => {
    await createAdminUser('admin', 'correctpassword')

    expect(await verifyAdminUser('admin', 'wrongpass')).toBe(false)
  })

  test('verifyAdminUser rejects wrong username', async () => {
    await createAdminUser('admin', 'test1234')

    expect(await verifyAdminUser('notadmin', 'test1234')).toBe(false)
  })

  test('createAdminUser rejects password shorter than 8 characters', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(createAdminUser('admin', 'seven77')).rejects.toThrow(
      'Password must be at least 8 characters',
    )
  })

  test('createAdminUser accepts a password of exactly 8 characters', async () => {
    await createAdminUser('admin', 'eight888')
    expect(await verifyAdminUser('admin', 'eight888')).toBe(true)
  })

  test('createAdminUser rejects creating a second admin', async () => {
    await createAdminUser('admin', 'test1234')
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(createAdminUser('admin2', 'test5678')).rejects.toThrow('Admin user already exists')
  })

  test('getAdminUsername returns the stored username', async () => {
    await createAdminUser('myadmin', 'test1234')
    expect(await getAdminUsername()).toBe('myadmin')
  })

  test('getAdminUsername returns null when no admin exists', async () => {
    expect(await getAdminUsername()).toBeNull()
  })

  test('verifyAdminUser returns false when no admin exists', async () => {
    expect(await verifyAdminUser('admin', 'test')).toBe(false)
  })

  test('isTotpEnabled returns false for pending TOTP secret', async () => {
    await createAdminUser('admin', 'test1234')
    await setTotpSecret('pending:JBSWY3DPEHPK3PXP')
    expect(await isTotpEnabled()).toBe(false)
  })

  test('isTotpEnabled returns true for activated TOTP secret', async () => {
    await createAdminUser('admin', 'test1234')
    await setTotpSecret('JBSWY3DPEHPK3PXP')
    expect(await isTotpEnabled()).toBe(true)
  })
})

describe('admin custom-art route (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  /**
   * A session cookie for the in-process server. Sessions live in a module-level
   * map, so minting one directly is the same thing `POST /api/login` does —
   * without a password round trip in a test that is about the art route.
   */
  function sessionHeader(): Record<string, string> {
    const session = createSession('admin', '127.0.0.1')
    return { Cookie: `${getSessionCookieName()}=${session.token}` }
  }

  /** The art directory, plus one image the route is allowed to hand out. */
  async function seedArt(): Promise<void> {
    await fs.mkdir(path.join(ws.dir, 'art'), { recursive: true })
    await fs.writeFile(path.join(ws.dir, 'art', 'bolt.png'), 'bolt-bytes')
  }

  test('serves the art directory only to a session', async () => {
    // The editor previews local art through this route, so it is one of the few
    // admin routes outside /api/ — and must still refuse an anonymous caller
    // rather than falling through to the static/SPA handler.
    await createAdminUser('admin', 'test1234')
    await seedArt()

    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/art/bolt.png`)
      expect(response.status).toBe(401)
    } finally {
      await server.stop(true)
    }
  })

  test('hands a session the image bytes with the extension’s content type', async () => {
    await createAdminUser('admin', 'test1234')
    await seedArt()

    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/art/bolt.png`, {
        headers: sessionHeader(),
      })
      expect(response.status).toBe(200)
      // The type comes from the allowlist's table, not from sniffing: an
      // `<img>` in the editor will not render a file served as octet-stream.
      expect(response.headers.get('Content-Type')).toBe('image/png')
      expect(await response.text()).toBe('bolt-bytes')
    } finally {
      await server.stop(true)
    }
  })

  test('404s an authenticated traversal, even with a real image to escape to', async () => {
    // Planted *outside* the art directory and given an allowed extension, so a
    // route that resolved the `..` would answer 200 with these bytes. Without
    // the file this test would pass on the extension gate alone and prove
    // nothing about the guard.
    await createAdminUser('admin', 'test1234')
    await seedArt()
    await fs.writeFile(path.join(ws.dir, 'outside.png'), 'outside-bytes')

    // An empty static root, unlike the sibling tests: `%2E%2E` is collapsed by
    // URL parsing itself, so that request never reaches the art route at all —
    // and with the workspace as `distDir` the *static* handler would serve the
    // planted file, turning a passing guard into a failing test.
    const distDir = path.join(ws.dir, 'dist')
    await fs.mkdir(distDir, { recursive: true })

    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir })
    try {
      const base = `http://127.0.0.1:${server.port}`
      const headers = sessionHeader()
      for (const suffix of ['..%2Foutside.png', '..%5Coutside.png', '%2E%2E/outside.png']) {
        const response = await fetch(`${base}/art/${suffix}`, { headers })
        expect(response.status).toBe(404)
        expect(await response.text()).not.toContain('outside-bytes')
      }
    } finally {
      await server.stop(true)
    }
  })

  test('refuses an anonymous write to a card’s art', async () => {
    await createAdminUser('admin', 'test1234')
    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/art/collection/binder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: 1, art: null }),
      })
      expect(response.status).toBe(401)
    } finally {
      await server.stop(true)
    }
  })
})

describe('admin server shutdown (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  test('stop() releases the port, so `ritual admin --mcp`’s SIGINT handler can', async () => {
    // The seam `startAdminServer` grew this phase: it returns a handle rather
    // than swallowing the listener, because `ritual admin --mcp` runs two of them
    // and has to stop both. A `stop` that did not actually close would leave a
    // bound port behind and the next start would fail.
    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    const url = `http://127.0.0.1:${server.port}/api/lists`
    expect((await fetch(url)).status).toBeLessThan(500)

    await server.stop(true)

    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test's expect().rejects.toThrow() resolves at runtime but the Matchers type doesn't expose Promise.
    await expect(fetch(url)).rejects.toThrow()
  })
})

describe('admin server refusals (Integration)', () => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  // The server refuses before any route runs in the same envelope every route
  // uses — English `message` plus the key it was rendered from — so the admin
  // page renders the refusal in its reader's language and a script can match on
  // the key instead of the prose.
  test('a signed-in route refuses with the shared keyed envelope, before and after setup', async () => {
    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const url = `http://127.0.0.1:${server.port}/api/lists`
      const beforeSetup = await fetch(url)
      expect(beforeSetup.status).toBe(403)
      const setupBody = (await beforeSetup.json()) as ApiErrorResponse
      expect(setupBody.success).toBe(false)
      expect(setupBody.messageKey).toBe('admin.api.server.setupRequired')
      expect(keyedRefusal(setupBody)).toBe('Setup required. Create an admin account first.')

      await createAdminUser('admin', 'test1234')
      const anonymous = await fetch(url)
      expect(anonymous.status).toBe(401)
      const body = (await anonymous.json()) as ApiErrorResponse
      expect(body.messageKey).toBe('admin.api.server.unauthorized')
      expect(keyedRefusal(body)).toBe('Unauthorized')
    } finally {
      await server.stop(true)
    }
  })

  test('a path with no route and no built site answers 404 in the shared envelope', async () => {
    // `ws.dir` holds no `index.html`, so nothing serves the SPA fallback either.
    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/api/no-such-route`)
      expect(resp.status).toBe(404)
      const body = (await resp.json()) as ApiErrorResponse
      expect(body.messageKey).toBe('admin.api.server.notFound')
      expect(keyedRefusal(body)).toBe('Not found')
    } finally {
      await server.stop(true)
    }
  })

  test('an address the deny list turns away answers 403 in the shared envelope', async () => {
    await writeConfig(ws.dir, { admin: { ipDenyList: ['127.0.0.1'] } })
    const server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/api/status`)
      expect(resp.status).toBe(403)
      const body = (await resp.json()) as ApiErrorResponse
      expect(body.messageKey).toBe('admin.api.server.forbidden')
      expect(keyedRefusal(body)).toBe('Forbidden')
    } finally {
      await server.stop(true)
    }
  })

  // A browser's API request from another site is refused before any route
  // runs — `/api/setup` included, which needs no session — while the admin
  // page's own requests and non-browser clients reach the route. The rule's
  // cases are pinned in test/unit/admin/same-origin.test.ts.
  describe('cross-site requests', () => {
    /** A setup request carrying the real setup token: reaching the route creates the account. */
    const setup = (base: string, headers: Record<string, string>): Promise<Response> =>
      fetch(`${base}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          username: 'mallory',
          password: 'test1234',
          setupToken: getSetupToken(),
        }),
      })

    // One per header the check reads.
    test.each<Record<string, string>>([
      { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' },
      { Origin: 'https://evil.example' },
    ])('are refused with 403 before the route: %p', async (headers) => {
      await using server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      const resp = await setup(`http://127.0.0.1:${server.port}`, headers)

      expect(resp.status).toBe(403)
      expect(((await resp.json()) as ApiErrorResponse).messageKey).toBe(
        'admin.api.server.crossSite',
      )
      // The request carried the real token, so only the refusal kept the account from existing.
      expect(await adminUserExists()).toBe(false)
    })

    test('the same setup from the admin page itself creates the account', async () => {
      await using server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      const resp = await setup(`http://127.0.0.1:${server.port}`, {
        'Sec-Fetch-Site': 'same-origin',
      })

      expect(resp.status).toBe(200)
      expect(await adminUserExists()).toBe(true)
    })

    test('a same-origin write and a non-browser one reach the route', async () => {
      await createAdminUser('admin', 'test1234')
      await using server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      const origin = `http://127.0.0.1:${server.port}`
      // A signed-in sign-out, each with a session of its own: 200 means the
      // write reached its route.
      const reached = async (headers: Record<string, string>): Promise<boolean> => {
        const { token } = createSession('admin', '127.0.0.1')
        const resp = await fetch(`${origin}/api/logout`, {
          method: 'POST',
          headers: { Cookie: `${getSessionCookieName()}=${token}`, ...headers },
        })
        return resp.status === 200
      }
      // `Origin` alone proves the host Bun sees is the one a browser addressed.
      expect(await reached({ Origin: origin })).toBeTrue()
      expect(await reached({})).toBeTrue()
    })

    // A few GET routes act (the sync, cache-refresh and build streams), so an
    // API read from another site is refused too; the site's own files are not.
    test('an API read from another site is refused, a page load is not', async () => {
      await fs.writeFile(path.join(ws.dir, 'index.html'), '<!DOCTYPE html><title>Admin</title>')
      await using server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      const foreign = { 'Sec-Fetch-Site': 'cross-site' }

      const api = await fetch(`http://127.0.0.1:${server.port}/api/status`, { headers: foreign })
      expect(api.status).toBe(403)
      const page = await fetch(`http://127.0.0.1:${server.port}/`, { headers: foreign })
      expect(page.status).toBe(200)
    })

    // Behind a proxy, the browser addressed the proxy's host: `admin.trustProxy`
    // is what lets the check read it from `X-Forwarded-Host`.
    test('admin.trustProxy reaches the check', async () => {
      const proxied = {
        Origin: 'https://admin.example.com',
        'X-Forwarded-Host': 'admin.example.com',
      }

      await writeConfig(ws.dir, { admin: { trustProxy: true } })
      await using trusting = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      expect((await setup(`http://127.0.0.1:${trusting.port}`, proxied)).status).toBe(200)
    })

    test('without admin.trustProxy the forwarded host is ignored', async () => {
      const proxied = {
        Origin: 'https://admin.example.com',
        'X-Forwarded-Host': 'admin.example.com',
      }

      await using server = await startAdminServer({ port: 0, host: '127.0.0.1', distDir: ws.dir })
      expect((await setup(`http://127.0.0.1:${server.port}`, proxied)).status).toBe(403)
    })
  })

  // The Bun `error` hook's 500 answers with the same envelope
  // (`admin.api.server.internalError`) but is left untested: no route can be
  // made to throw past `apiHandler` from outside without a test-only seam.

  test('a locked-out sign-in answers 429 in the shared envelope, with the lock it has left', async () => {
    // An address no other suite uses: the login rate limiter is process-wide.
    const ip = '10.99.0.3'
    for (let attempt = 0; attempt < 5; attempt += 1) globalRateLimiter.recordFailure(ip, 5, 5)
    try {
      const resp = await handleLogin(
        new Request('http://localhost/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'test1234' }),
        }),
        ip,
      )
      expect(resp.status).toBe(429)
      const body = (await resp.json()) as ApiErrorResponse & { retryAfterSeconds: number }
      expect(body.success).toBe(false)
      expect(keyedRefusal(body)).toBe('Too many failed attempts. Try again later.')
      expect(body.messageKey).toBe('admin.api.login.rateLimited')
      expect(body.retryAfterSeconds).toBeGreaterThan(0)
      expect(resp.headers.get('Retry-After')).toBe(String(body.retryAfterSeconds))
    } finally {
      globalRateLimiter.recordSuccess(ip)
    }
  })
})

/** An auth route, called the way the server's route table calls it. */
type AuthRouteCase = {
  route: string
  handler: (req: Request) => Promise<Response>
}

const AUTH_ROUTES: AuthRouteCase[] = [
  { route: '/api/setup', handler: handleSetup },
  // An address no other suite locks out: the login rate limiter is process-wide.
  { route: '/api/login', handler: (req) => handleLogin(req, '10.99.0.2') },
  { route: '/api/totp/verify-setup', handler: handleTotpVerifySetup },
  { route: '/api/login/archidekt', handler: handleArchidektLogin },
]

describe.each(AUTH_ROUTES)('POST $route body shape (Integration)', ({ route, handler }) => {
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })

  afterEach(async () => {
    await ws.dispose()
  })

  /** POST `body` as the route's JSON body, verbatim. */
  function post(body: string): Promise<Response> {
    return handler(
      new Request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    )
  }

  // A malformed body is the caller's mistake: a 400 that says so, never a 500
  // or a credentials refusal that would send the user re-typing a password.
  test.each<[string, string, MessageKey, string]>([
    [
      'a body that is not JSON',
      '{"username": ',
      'admin.api.body.notJson',
      'Request body must be JSON.',
    ],
    [
      'a JSON body that is not an object',
      '["admin", "hunter22"]',
      'admin.api.body.notObject',
      'Request body must be a JSON object.',
    ],
  ])('%s is a 400', async (_label, body, key, message) => {
    const resp = await post(body)
    expect(resp.status).toBe(400)
    const refusal = (await resp.json()) as ApiErrorResponse
    expect(keyedRefusal(refusal)).toBe(message)
    expect(refusal.messageKey).toBe(key)
  })
})
