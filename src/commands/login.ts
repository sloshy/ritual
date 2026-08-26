import { Command } from 'commander'

import { ArchidektAuth } from '../auth/ArchidektAuth'
import type { ArchidektLoginStatus } from '../auth/interfaces'
import { FileTokenStore } from '../auth/FileTokenStore'
import { loginWithCredentials, promptForLoginOutcome } from '../auth/login-helper'
import { localizedCommandError } from '../util/errors'
import { t } from '../i18n/t'
import { runCommandAction } from './card-target'
import { readPasswordFromStdin } from './prompts-helpers'
import {
  addOutputOption,
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type LoginArchidektOptions = {
  forceLogin?: boolean
  username?: string
  passwordStdin?: boolean
}

/** Both `login status` and `login logout` take only the scripting flags. */
type LoginScriptingOptions = Partial<ScriptingOptions>

/**
 * JSON payload for `login status`: the stored Archidekt login and how usable it
 * is. The admin surface (`GET /api/login/archidekt`) answers the same
 * question from the same {@link ArchidektAuth.getStatus} snapshot, so the two
 * share one shape rather than each projecting its own subset — the CLI's
 * question ("will my next sync authenticate?") needs every field.
 */
type LoginStatusOutput = ArchidektLoginStatus

/** JSON payload for `login logout`: whether a stored login was actually cleared. */
type LoginLogoutOutput = {
  loggedOut: boolean
  username?: string
}

const TEXT_SCRIPTING: ScriptingOptions = { output: 'text', quiet: false }

function makeAuth(): ArchidektAuth {
  return new ArchidektAuth(new FileTokenStore())
}

async function runArchidektLogin(options: LoginArchidektOptions): Promise<void> {
  const auth = makeAuth()
  const headless = options.username !== undefined || options.passwordStdin === true

  // Explicit credentials always perform a fresh login; the existing-session
  // short-circuit only applies to the plain interactive invocation.
  if (!options.forceLogin && !headless) {
    try {
      const user = await auth.getStoredUser()
      if (user) {
        const token = await auth.getToken()
        if (token) {
          console.log(t('cli.login.loggedInAs', { username: user.username }))
          return
        }
        console.log(t('cli.login.sessionExpiredFor', { username: user.username }))
      }
    } catch {
      // Ignore errors during check, proceed to login
    }
  }

  if (headless) {
    if (options.username === undefined || options.passwordStdin !== true) {
      throw localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'cli.login.needsCredentialFlags',
      )
    }
    const password = await readPasswordFromStdin()
    if (password.length === 0) {
      throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.login.emptyPassword')
    }
    const outcome = await loginWithCredentials(auth, { username: options.username, password })
    if (outcome === 'failed') {
      process.exitCode = ExitCode.RuntimeError
    }
    return
  }

  const outcome = await promptForLoginOutcome(auth)
  if (outcome === 'cancelled') {
    process.exitCode = ExitCode.UsageError
    return
  }
  if (outcome === 'failed') {
    process.exitCode = ExitCode.RuntimeError
    return
  }
}

/** The account half of the status line: whoever the stored token names. */
function describeAccount(status: ArchidektLoginStatus): string {
  return status.username === null
    ? t('cli.login.accountUnnamed')
    : t('cli.login.accountNamed', { username: status.username })
}

/**
 * The status line for a stored login, which is about whether the *next* sync
 * authenticates rather than about the file existing: an expired access token
 * that a valid refresh token can renew is still a working session, and only a
 * login where neither token is usable asks for a fresh sign-in.
 */
export function describeLoginStatus(status: ArchidektLoginStatus): string {
  if (!status.loggedIn) return t('cli.login.notLoggedIn')
  const account = describeAccount(status)
  if (status.loginRequired) {
    return t('cli.login.statusExpired', { account })
  }
  if (!status.accessTokenValid) {
    return t('cli.login.statusRefreshable', { account })
  }
  return status.accessTokenExpiration === null
    ? account
    : t('cli.login.statusValidUntil', {
        account,
        expiration: status.accessTokenExpiration,
      })
}

async function runLoginStatus(scripting: ScriptingOptions): Promise<void> {
  // Entirely offline: `getStatus` reads the stored token's own `exp` claims.
  const status = await makeAuth().getStatus()
  // Three outcomes, three exit codes, so a script branches on the code alone:
  // 0 = a session the next sync can use, 1 = a stored login that can no longer
  // authenticate (re-login needed), 3 = nothing stored at all. The status line
  // is the command's entire payload, so it prints in every mode — `login
  // status` registers no `--quiet` to hide it with, and a script that wants
  // pure silence redirects stdout.
  if (!status.loggedIn) {
    process.exitCode = ExitCode.NotFound
  } else if (status.loginRequired) {
    process.exitCode = ExitCode.RuntimeError
  }
  if (scripting.output === 'text') {
    emitOutput(describeLoginStatus(status), scripting)
    return
  }
  const payload: LoginStatusOutput = status
  emitOutput(payload, scripting)
}

async function runLoginLogout(scripting: ScriptingOptions): Promise<void> {
  const auth = makeAuth()
  const user = await auth.getStoredUser()
  await auth.logout()
  // The text line is a confirmation of an action, not a payload: `--quiet`
  // drops it, while the structured payload always emits.
  if (scripting.output === 'text') {
    if (scripting.quiet) return
    emitOutput(
      user ? t('cli.login.loggedOut', { username: user.username }) : t('cli.login.nothingToClear'),
      scripting,
    )
    return
  }
  const payload: LoginLogoutOutput = user
    ? { loggedOut: true, username: user.username }
    : { loggedOut: false }
  emitOutput(payload, scripting)
}

export function registerLoginCommand(program: Command): void {
  const loginCommand = program.command('login').description(t('help.login.description'))

  loginCommand
    .command('archidekt')
    .description(t('help.login.archidekt'))
    .option('-f, --force-login', t('help.login.forceLogin'))
    .option('--username <username>', t('help.login.username'))
    .option('--password-stdin', t('help.login.passwordStdin'), false)
    .action(async (options: LoginArchidektOptions) => {
      await runCommandAction(TEXT_SCRIPTING, () => runArchidektLogin(options))
    })

  // `--output` only: the status line is the whole payload, so there is no
  // non-essential chatter for `--quiet` to suppress.
  addOutputOption(loginCommand.command('status').description(t('help.login.status'))).action(
    async (options: LoginScriptingOptions) => {
      const scripting = normalizeScriptingOptions(options)
      await runCommandAction(scripting, () => runLoginStatus(scripting))
    },
  )

  addScriptingOptions(loginCommand.command('logout').description(t('help.login.logout'))).action(
    async (options: LoginScriptingOptions) => {
      const scripting = normalizeScriptingOptions(options)
      await runCommandAction(scripting, () => runLoginLogout(scripting))
    },
  )
}
