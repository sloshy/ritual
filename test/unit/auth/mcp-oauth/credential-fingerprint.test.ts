import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { adminAuthPath } from '../../../../src/auth/logins-dir'
import {
  createFingerprintReader,
  credentialFingerprint,
  fingerprintOfCredentialsText,
} from '../../../../src/auth/mcp-oauth/credential-fingerprint'
import { bindWorkspace, writeLoginFile, type BoundWorkspace } from '../../../helpers/workspace'

describe('credentialFingerprint', () => {
  test('changes with the password hash and with an active TOTP secret', () => {
    const base = credentialFingerprint('$2b$hash-1', undefined)
    expect(credentialFingerprint('$2b$hash-2', undefined)).not.toBe(base)
    expect(credentialFingerprint('$2b$hash-1', 'JBSWY3DPEHPK3PXP')).not.toBe(base)
  })

  test('a pending enrollment is not active, so starting one changes nothing', () => {
    expect(credentialFingerprint('$2b$hash-1', 'pending:JBSWY3DPEHPK3PXP')).toBe(
      credentialFingerprint('$2b$hash-1', undefined),
    )
  })

  test('the username is not part of it; an unusable file has none', () => {
    const one = fingerprintOfCredentialsText(JSON.stringify({ username: 'a', passwordHash: 'h' }))
    const two = fingerprintOfCredentialsText(JSON.stringify({ username: 'b', passwordHash: 'h' }))
    expect(one).toBe(two)
    expect(fingerprintOfCredentialsText('{')).toBeUndefined()
    expect(fingerprintOfCredentialsText(JSON.stringify({ username: 'a' }))).toBeUndefined()
  })
})

describe('createFingerprintReader', () => {
  let ws: BoundWorkspace
  beforeEach(async () => {
    ws = await bindWorkspace({ dirs: [], config: false })
  })
  afterEach(async () => ws.dispose())

  test('follows the file through rewrites, and fails closed when it is gone', async () => {
    const read = createFingerprintReader()
    expect(await read()).toBeUndefined()
    await writeLoginFile(
      ws.dir,
      'admin-auth.json',
      JSON.stringify({ username: 'a', passwordHash: 'h1' }),
    )
    const first = await read()
    expect(first).toBe(credentialFingerprint('h1', undefined))
    // Replaced by rename, as every writer does: a new inode, so it is re-read.
    const next = `${adminAuthPath()}.next`
    await fs.writeFile(next, JSON.stringify({ username: 'a', passwordHash: 'h2' }))
    await fs.rename(next, adminAuthPath())
    expect(await read()).toBe(credentialFingerprint('h2', undefined))
    await fs.rm(adminAuthPath())
    expect(await read()).toBeUndefined()
  })
})
