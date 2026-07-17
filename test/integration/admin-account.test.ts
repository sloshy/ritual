import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { createWorkspace, removeWorkspace } from './helpers/workspace'

type AdminSetupJson = {
  username: string
  created: boolean
}

type AdminResetPasswordJson = {
  username: string
  passwordReset: boolean
}

type AdminDisableTotpJson = {
  totpDisabled: boolean
}

type ErrorJson = {
  error: { code: string; message: string }
}

type StoredCredentials = {
  username: string
  passwordHash: string
  totpSecret?: string
}

function authFilePath(dir: string): string {
  return path.join(dir, '.logins', 'admin-auth.json')
}

async function readAuthFile(dir: string): Promise<StoredCredentials> {
  const content = await fs.readFile(authFilePath(dir), 'utf-8')
  return JSON.parse(content) as StoredCredentials
}

async function seedAuthFile(dir: string, credentials: StoredCredentials): Promise<void> {
  const loginsDir = path.join(dir, '.logins')
  await fs.mkdir(loginsDir, { recursive: true, mode: 0o700 })
  await fs.writeFile(authFilePath(dir), JSON.stringify(credentials, null, 2), { mode: 0o600 })
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('admin setup CLI (Integration)', () => {
  test('creates the credentials file with 0600 mode and emits JSON', async () => {
    const result = await runCli(
      ['admin', 'setup', '--username', 'ops', '--password-stdin', '--output', 'json'],
      dir,
      undefined,
      'hunter2222\n',
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as AdminSetupJson
    expect(json).toEqual({ username: 'ops', created: true })

    const stat = await fs.stat(authFilePath(dir))
    expect(stat.mode & 0o777).toBe(0o600)

    const credentials = await readAuthFile(dir)
    expect(credentials.username).toBe('ops')
    // The trailing newline from the pipe must be stripped, nothing else.
    expect(await Bun.password.verify('hunter2222', credentials.passwordHash)).toBe(true)

    const audit = await fs.readFile(path.join(dir, '.logins', 'admin-audit.log'), 'utf-8')
    expect(audit).toContain('Admin account created via CLI')
  })

  test('second setup fails with a runtime error (exit 1)', async () => {
    await seedAuthFile(dir, { username: 'ops', passwordHash: 'irrelevant' })
    const result = await runCli(
      ['admin', 'setup', '--username', 'other', '--password-stdin', '--output', 'json'],
      dir,
      undefined,
      'hunter2222\n',
    )
    expect(result.exitCode).toBe(1)
    const json = JSON.parse(result.stderr) as ErrorJson
    expect(json.error.code).toBe('runtime_error')
    expect(json.error.message).toContain('already exists')
  })

  test('without --username fails with a usage error (exit 2)', async () => {
    const result = await runCli(
      ['admin', 'setup', '--password-stdin'],
      dir,
      undefined,
      'hunter2222\n',
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--username is required')
  })

  test('too-short password fails with a usage error (exit 2)', async () => {
    const result = await runCli(
      ['admin', 'setup', '--username', 'ops', '--password-stdin'],
      dir,
      undefined,
      'short\n',
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('at least 8 characters')
  })

  test('without --password-stdin on a non-TTY refuses with a usage error (exit 2)', async () => {
    const result = await runCli(['admin', 'setup', '--username', 'ops'], dir)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--password-stdin')
  })
})

describe('admin reset-password CLI (Integration)', () => {
  test('fails with not-found (exit 3) when no admin user exists', async () => {
    const result = await runCli(
      ['admin', 'reset-password', '--password-stdin', '--output', 'json'],
      dir,
      undefined,
      'hunter2222\n',
    )
    expect(result.exitCode).toBe(3)
    const json = JSON.parse(result.stderr) as ErrorJson
    expect(json.error.code).toBe('not_found')
    expect(json.error.message).toContain('ritual admin setup')
  })

  test('rehashes the password and preserves a pending totpSecret verbatim', async () => {
    await seedAuthFile(dir, {
      username: 'ops',
      passwordHash: 'old-hash',
      totpSecret: 'pending:JBSWY3DPEHPK3PXP',
    })

    // Leading/trailing spaces are part of the password: only the single
    // trailing pipe newline may be stripped.
    const password = '  spaced out password  '
    const result = await runCli(
      ['admin', 'reset-password', '--password-stdin', '--output', 'json'],
      dir,
      undefined,
      `${password}\n`,
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as AdminResetPasswordJson
    expect(json).toEqual({ username: 'ops', passwordReset: true })

    const credentials = await readAuthFile(dir)
    expect(credentials.username).toBe('ops')
    expect(credentials.totpSecret).toBe('pending:JBSWY3DPEHPK3PXP')
    expect(await Bun.password.verify(password, credentials.passwordHash)).toBe(true)

    const stat = await fs.stat(authFilePath(dir))
    expect(stat.mode & 0o777).toBe(0o600)
  })

  test('--username replaces the stored username', async () => {
    await seedAuthFile(dir, { username: 'ops', passwordHash: 'old-hash' })
    const result = await runCli(
      ['admin', 'reset-password', '--username', 'root', '--password-stdin', '--output', 'json'],
      dir,
      undefined,
      'hunter2222\n',
    )
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as AdminResetPasswordJson
    expect(json.username).toBe('root')
    const credentials = await readAuthFile(dir)
    expect(credentials.username).toBe('root')
  })
})

describe('admin disable-totp CLI (Integration)', () => {
  test('fails with not-found (exit 3) when no admin user exists', async () => {
    const result = await runCli(['admin', 'disable-totp', '--output', 'json'], dir)
    expect(result.exitCode).toBe(3)
    const json = JSON.parse(result.stderr) as ErrorJson
    expect(json.error.code).toBe('not_found')
  })

  test('fails with a runtime error (exit 1) when no TOTP secret is stored', async () => {
    await seedAuthFile(dir, { username: 'ops', passwordHash: 'old-hash' })
    const result = await runCli(['admin', 'disable-totp', '--output', 'json'], dir)
    expect(result.exitCode).toBe(1)
    const json = JSON.parse(result.stderr) as ErrorJson
    expect(json.error.code).toBe('runtime_error')
    expect(json.error.message).toContain('TOTP is not enabled')
  })

  test('clears an active TOTP secret', async () => {
    await seedAuthFile(dir, {
      username: 'ops',
      passwordHash: 'old-hash',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    })
    const result = await runCli(['admin', 'disable-totp', '--output', 'json'], dir)
    expect(result.exitCode).toBe(0)
    const json = JSON.parse(result.stdout) as AdminDisableTotpJson
    expect(json).toEqual({ totpDisabled: true })

    const credentials = await readAuthFile(dir)
    expect('totpSecret' in credentials).toBe(false)
    expect(credentials.username).toBe('ops')
  })

  test('clears a stuck pending TOTP enrollment too', async () => {
    await seedAuthFile(dir, {
      username: 'ops',
      passwordHash: 'old-hash',
      totpSecret: 'pending:JBSWY3DPEHPK3PXP',
    })
    const result = await runCli(['admin', 'disable-totp', '--output', 'json'], dir)
    expect(result.exitCode).toBe(0)
    const credentials = await readAuthFile(dir)
    expect('totpSecret' in credentials).toBe(false)
  })
})

describe('admin parent command (Integration)', () => {
  test('--help still shows the server options and the account subcommands', async () => {
    const result = await runCli(['admin', '--help'], dir)
    expect(result.exitCode).toBe(0)
    // Bare `ritual admin` server invocation is untouched.
    expect(result.stdout).toContain('--port')
    expect(result.stdout).toContain('--host')
    expect(result.stdout).toContain('--mcp-token')
    // The account subcommands are registered underneath it.
    expect(result.stdout).toContain('setup')
    expect(result.stdout).toContain('reset-password')
    expect(result.stdout).toContain('disable-totp')
  })
})
