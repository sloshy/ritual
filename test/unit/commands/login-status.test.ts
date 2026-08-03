import { describe, expect, test } from 'bun:test'
import { describeLoginStatus } from '../../../src/commands/login'
import type { ArchidektLoginStatus } from '../../../src/auth/interfaces'

/**
 * `login status`'s text rendering. The command answers "will my next sync
 * authenticate?", so its line is about token validity rather than about a token
 * file existing — the exit codes that go with each case are pinned end to end in
 * `test/integration/login.test.ts`.
 */

function status(overrides: Partial<ArchidektLoginStatus> = {}): ArchidektLoginStatus {
  return {
    loggedIn: true,
    username: 'tester',
    accessTokenExpiration: '2026-08-03T00:00:00.000Z',
    accessTokenValid: true,
    refreshTokenExpiration: '2026-09-01T00:00:00.000Z',
    refreshTokenValid: true,
    loginRequired: false,
    ...overrides,
  }
}

describe('describeLoginStatus', () => {
  test('names the account and how long the session is good for', () => {
    expect(describeLoginStatus(status())).toBe(
      'Logged in to Archidekt as tester (session valid until 2026-08-03T00:00:00.000Z)',
    )
  })

  test('an expired access token with a live refresh token is still a working session', () => {
    expect(describeLoginStatus(status({ accessTokenValid: false }))).toBe(
      'Logged in to Archidekt as tester (access token expired; it refreshes on the next request)',
    )
  })

  test('a dead session says so and names the command that fixes it', () => {
    const line = describeLoginStatus(
      status({ accessTokenValid: false, refreshTokenValid: false, loginRequired: true }),
    )
    expect(line).toBe(
      'Logged in to Archidekt as tester (session expired — run "ritual login archidekt")',
    )
  })

  test('reports a stored login that names no account', () => {
    expect(describeLoginStatus(status({ username: null, accessTokenExpiration: null }))).toBe(
      'Logged in to Archidekt (the stored login does not name an account)',
    )
  })

  test('no stored login at all', () => {
    expect(
      describeLoginStatus({
        loggedIn: false,
        username: null,
        accessTokenExpiration: null,
        accessTokenValid: false,
        refreshTokenExpiration: null,
        refreshTokenValid: false,
        loginRequired: true,
      }),
    ).toBe('Not logged in.')
  })
})
