import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runCli } from './helpers/cli'
import { OFFLINE_ENV } from './helpers/offline-env'
import { createWorkspace, removeWorkspace } from './helpers/workspace'

type LoginStatusPayload = { loggedIn: boolean; username?: string }
type LoginLogoutPayload = { loggedOut: boolean; username?: string }

/** Write a stored Archidekt token file the way `FileTokenStore.save` would. */
async function seedStoredLogin(workspace: string, username: string): Promise<void> {
  const loginsDir = path.join(workspace, '.logins')
  await fs.mkdir(loginsDir, { recursive: true })
  await fs.writeFile(
    path.join(loginsDir, 'archidekt.json'),
    JSON.stringify({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      user: { id: 1, username },
    }),
  )
}

let dir: string

beforeEach(async () => {
  dir = await createWorkspace()
})

afterEach(async () => {
  await removeWorkspace(dir)
})

describe('login CLI headless paths (Integration)', () => {
  test('archidekt with --password-stdin but no --username is a usage error', async () => {
    const result = await runCli(
      ['login', 'archidekt', '--password-stdin'],
      dir,
      OFFLINE_ENV,
      'pw\n',
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('both --username and --password-stdin')
  })

  test('archidekt with --username but no --password-stdin is a usage error', async () => {
    const result = await runCli(['login', 'archidekt', '--username', 'tester'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('both --username and --password-stdin')
  })

  test('archidekt without credential flags and without a terminal points at the headless flags', async () => {
    const result = await runCli(['login', 'archidekt'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('--username')
    expect(result.stderr).toContain('--password-stdin')
  })

  test('an empty password on stdin is a usage error before any login attempt', async () => {
    const result = await runCli(
      ['login', 'archidekt', '--username', 'tester', '--password-stdin'],
      dir,
      OFFLINE_ENV,
      '',
    )
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('empty')
  })

  test('status without a stored login reports logged out and exits 3', async () => {
    const text = await runCli(['login', 'status'], dir, OFFLINE_ENV)
    expect(text.exitCode).toBe(3)
    expect(text.stdout).toContain('Not logged in.')

    const json = await runCli(['login', 'status', '--output', 'json'], dir, OFFLINE_ENV)
    expect(json.exitCode).toBe(3)
    expect(JSON.parse(json.stdout) as LoginStatusPayload).toEqual({ loggedIn: false })
  })

  test('status reads the stored token and reports the username', async () => {
    await seedStoredLogin(dir, 'tester')

    const text = await runCli(['login', 'status'], dir, OFFLINE_ENV)
    expect(text.exitCode).toBe(0)
    expect(text.stdout).toContain('Logged in to Archidekt as tester')

    const json = await runCli(['login', 'status', '--output', 'json'], dir, OFFLINE_ENV)
    expect(json.exitCode).toBe(0)
    expect(JSON.parse(json.stdout) as LoginStatusPayload).toEqual({
      loggedIn: true,
      username: 'tester',
    })
  })

  // The status line is the command's whole payload, so `status` registers no
  // `--quiet` — the shared convention forbids a flag that would hide it.
  test('status registers no --quiet flag, and reports absence without one', async () => {
    const rejected = await runCli(['login', 'status', '--quiet'], dir, OFFLINE_ENV)
    expect(rejected.exitCode).toBe(2)
    expect(rejected.stderr).toContain("unknown option '--quiet'")

    const loggedOut = await runCli(['login', 'status'], dir, OFFLINE_ENV)
    expect(loggedOut.exitCode).toBe(3)
    expect(loggedOut.stdout).toContain('Not logged in.')

    const loggedOutJson = await runCli(['login', 'status', '--output', 'json'], dir, OFFLINE_ENV)
    expect(loggedOutJson.exitCode).toBe(3)
    // toStrictEqual, not toEqual: `username` must be *absent*, not undefined.
    expect(JSON.parse(loggedOutJson.stdout) as LoginStatusPayload).toStrictEqual({
      loggedIn: false,
    })
  })

  test('logout --quiet drops the confirmation line but never the payload', async () => {
    await seedStoredLogin(dir, 'tester')
    const quiet = await runCli(['login', 'logout', '--quiet'], dir, OFFLINE_ENV)
    expect(quiet.exitCode).toBe(0)
    expect(quiet.stdout).toBe('')
    expect(quiet.stderr).toBe('')
    expect(await Bun.file(path.join(dir, '.logins', 'archidekt.json')).exists()).toBe(false)

    await seedStoredLogin(dir, 'tester')
    const quietJson = await runCli(
      ['login', 'logout', '--quiet', '--output', 'json'],
      dir,
      OFFLINE_ENV,
    )
    expect(quietJson.exitCode).toBe(0)
    expect(JSON.parse(quietJson.stdout) as LoginLogoutPayload).toStrictEqual({
      loggedOut: true,
      username: 'tester',
    })
  })

  test('logout clears the stored token and reports who was logged out', async () => {
    await seedStoredLogin(dir, 'tester')

    const result = await runCli(['login', 'logout'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('tester')

    // logout carries the same scripting flags as its sibling `status`.
    await seedStoredLogin(dir, 'tester')
    const json = await runCli(['login', 'logout', '--output', 'json'], dir, OFFLINE_ENV)
    expect(json.exitCode).toBe(0)
    expect(JSON.parse(json.stdout) as LoginLogoutPayload).toEqual({
      loggedOut: true,
      username: 'tester',
    })

    const tokenExists = await Bun.file(path.join(dir, '.logins', 'archidekt.json')).exists()
    expect(tokenExists).toBe(false)

    const status = await runCli(['login', 'status', '--output', 'json'], dir, OFFLINE_ENV)
    expect(status.exitCode).toBe(3)
    expect(JSON.parse(status.stdout) as LoginStatusPayload).toEqual({ loggedIn: false })
  })

  test('logout without a stored login reports nothing to clear and exits 0', async () => {
    const result = await runCli(['login', 'logout'], dir, OFFLINE_ENV)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No stored Archidekt login')
  })
})
