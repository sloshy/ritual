import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs/promises'
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
import { createSession, getSessionCookieName } from '../../src/admin/session'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'

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
