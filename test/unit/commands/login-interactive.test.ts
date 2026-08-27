import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import prompts from 'prompts'
import { registerLoginCommand, runInteractiveLogin } from '../../../src/commands/login'
import { ExitCode } from '../../../src/util/errors'
import { runInProcess } from '../../integration/helpers/cli'
import type { LoginService } from '../../../src/auth/login-helper'
import type { ArchidektCredentials } from '../../../src/auth/interfaces'
import { stubTty } from '../../test-utils'

// The prompt answers come from prompts.inject; ask() still wants a terminal.
stubTty({ stdin: true })

type AuthDoubleOptions = {
  /** Make the login attempt throw with this message. */
  fail?: string
  /** Report no stored account after the login, as a token without a name would. */
  unnamed?: boolean
}

/** An auth double that records the credentials and either stores a user or throws. */
function authDouble(
  options: AuthDoubleOptions = {},
): LoginService & { logins: ArchidektCredentials[] } {
  const double = {
    logins: [] as ArchidektCredentials[],
    login: async (credentials: ArchidektCredentials): Promise<void> => {
      double.logins.push(credentials)
      if (options.fail !== undefined) throw new Error(options.fail)
    },
    getStoredUser: async () => (options.unnamed ? null : { id: 1, username: 'tester' }),
  }
  return double
}

describe('runInteractiveLogin', () => {
  const log = spyOn(console, 'log').mockImplementation(() => {})
  const error = spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => {
    log.mockClear()
    error.mockClear()
  })

  afterAll(() => {
    log.mockRestore()
    error.mockRestore()
  })

  test('a successful login reports the stored account', async () => {
    const auth = authDouble()
    prompts.inject(['user', 'pw'])

    expect(await runInteractiveLogin(auth)).toBe('success')
    expect(auth.logins).toEqual([{ username: 'user', password: 'pw' }])
    expect(log).toHaveBeenCalledWith('Login successful! Logged in as tester')
  })

  test('a login that stored no account name says so without a dangling "as"', async () => {
    prompts.inject(['user', 'pw'])

    expect(await runInteractiveLogin(authDouble({ unnamed: true }))).toBe('success')
    expect(log).toHaveBeenCalledWith('Login successful!')
  })

  test('a failed login reports the reason', async () => {
    prompts.inject(['user', 'pw'])

    expect(await runInteractiveLogin(authDouble({ fail: 'bad password' }))).toBe('failed')
    expect(error).toHaveBeenCalledWith('Login failed: bad password')
  })

  test('an escaped prompt is a cancel, with no login attempted', async () => {
    const auth = authDouble()
    prompts.inject([new Error('cancelled')])

    expect(await runInteractiveLogin(auth)).toBe('cancelled')
    expect(auth.logins).toEqual([])
    expect(error).toHaveBeenCalledWith('Cancelled.')
  })

  test('the command maps a cancelled prompt to the usage exit code', async () => {
    // `--force-login` skips the stored-session short-circuit, so the prompt is
    // reached without reading any token file; the escape ends the run before
    // any login is attempted. (The success and failed outcomes need a stubbed
    // auth service behind the real command and are pinned above on the
    // helper's return value instead.)
    prompts.inject([new Error('cancelled')])

    const code = await runInProcess(registerLoginCommand, ['login', 'archidekt', '--force-login'])

    expect(code).toBe(ExitCode.UsageError)
    expect(error).toHaveBeenCalledWith('Cancelled.')
  })
})
