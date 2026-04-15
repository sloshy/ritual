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
} from '../../../src/admin/auth'
import { setBaseDir } from '../../../src/base-dir'

const testDir = path.join(import.meta.dir, '../../.test-admin-auth')

describe('admin auth', () => {
  const originalCwd = process.cwd()

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true })
    setBaseDir(testDir)
  })

  afterEach(async () => {
    setBaseDir(originalCwd)
    await fs.rm(testDir, { recursive: true, force: true })
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
    expect(createAdminUser('admin', 'short')).rejects.toThrow(
      'Password must be at least 8 characters',
    )
  })

  test('createAdminUser rejects creating a second admin', async () => {
    await createAdminUser('admin', 'test1234')
    expect(createAdminUser('admin2', 'test5678')).rejects.toThrow('Admin user already exists')
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
