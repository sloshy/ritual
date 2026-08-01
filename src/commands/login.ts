import { Command } from 'commander'

import { ArchidektAuth } from '../auth/ArchidektAuth'
import { FileTokenStore } from '../auth/FileTokenStore'
import { loginWithCredentials, promptForLoginOutcome } from '../auth/login-helper'
import { CardCommandError } from '../errors'
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

/** JSON payload for `login status`: the stored Archidekt login, if any. */
type LoginStatusOutput = {
  loggedIn: boolean
  username?: string
}

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
          console.log(`Logged in as ${user.username}`)
          return
        }
        console.log(`Session for ${user.username} expired.`)
      }
    } catch {
      // Ignore errors during check, proceed to login
    }
  }

  if (headless) {
    if (options.username === undefined || options.passwordStdin !== true) {
      throw new CardCommandError(
        'usage_error',
        'Non-interactive login requires both --username and --password-stdin.',
        ExitCode.UsageError,
      )
    }
    const password = await readPasswordFromStdin()
    if (password.length === 0) {
      throw new CardCommandError(
        'usage_error',
        'The password read from stdin is empty.',
        ExitCode.UsageError,
      )
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

async function runLoginStatus(scripting: ScriptingOptions): Promise<void> {
  const user = await makeAuth().getStoredUser()
  // Exit 3 (NotFound) when no login is stored so scripts can branch on the exit
  // code alone. The status line is the command's entire payload, so it prints
  // in every mode — `login status` registers no `--quiet` to hide it with, and
  // a script that wants pure silence redirects stdout.
  if (!user) {
    process.exitCode = ExitCode.NotFound
  }
  if (scripting.output === 'text') {
    emitOutput(user ? `Logged in to Archidekt as ${user.username}` : 'Not logged in.', scripting)
    return
  }
  const payload: LoginStatusOutput = user
    ? { loggedIn: true, username: user.username }
    : { loggedIn: false }
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
      user
        ? `Logged out of Archidekt (was ${user.username}). Stored token cleared.`
        : 'No stored Archidekt login to clear.',
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
  const loginCommand = program.command('login').description('Login to a supported website')

  loginCommand
    .command('archidekt')
    .description('Login to Archidekt')
    .option('-f, --force-login', 'Force a new login even if a session exists')
    .option('--username <username>', 'Archidekt username or email (for scripting)')
    .option('--password-stdin', 'Read the password from stdin (for scripting)', false)
    .action(async (options: LoginArchidektOptions) => {
      await runCommandAction(TEXT_SCRIPTING, () => runArchidektLogin(options))
    })

  // `--output` only: the status line is the whole payload, so there is no
  // non-essential chatter for `--quiet` to suppress.
  addOutputOption(
    loginCommand.command('status').description('Show the stored Archidekt login, if any'),
  ).action(async (options: LoginScriptingOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runLoginStatus(scripting))
  })

  addScriptingOptions(
    loginCommand.command('logout').description('Clear the stored Archidekt login'),
  ).action(async (options: LoginScriptingOptions) => {
    const scripting = normalizeScriptingOptions(options)
    await runCommandAction(scripting, () => runLoginLogout(scripting))
  })
}
