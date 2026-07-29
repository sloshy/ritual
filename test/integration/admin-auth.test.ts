import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createAdminUser,
  verifyAdminUser,
  adminUserExists,
  getAdminUsername,
  isTotpEnabled,
  setTotpSecret,
} from '../../src/admin/auth'
import { startAdminServer } from '../../src/admin/server'
import { bindWorkspace, type BoundWorkspace } from './helpers/workspace'

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
