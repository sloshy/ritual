import prompts from 'prompts'
import { ArchidektAuth } from './ArchidektAuth'
import type { ArchidektCredentials } from './interfaces'
import { getErrorMessage } from '../errors'
import { inputRequiredError, promptsUnavailable } from '../no-input'

/** How a credentialed login attempt ended (credentials already in hand). */
export type LoginOutcome = 'success' | 'failed'

/** How an interactive login ended; `cancelled` means the prompt was aborted. */
export type LoginPromptOutcome = LoginOutcome | 'cancelled'

/**
 * Perform the actual Archidekt login with credentials already in hand,
 * reporting the result on the console. Shared by the interactive prompt flow
 * and the headless `--username`/`--password-stdin` path.
 */
export async function loginWithCredentials(
  auth: ArchidektAuth,
  credentials: ArchidektCredentials,
): Promise<LoginOutcome> {
  try {
    await auth.login(credentials)
    const user = await auth.getStoredUser()
    console.log(`Login successful! Logged in as ${user?.username}`)
    return 'success'
  } catch (error: unknown) {
    const msg = getErrorMessage(error)
    console.error('Login failed:', msg)
    return 'failed'
  }
}

export async function promptForLoginOutcome(auth: ArchidektAuth): Promise<LoginPromptOutcome> {
  // Returning 'cancelled' here would be a silent no-op; a headless run must
  // fail loudly and point at the non-interactive credential flags instead.
  if (promptsUnavailable()) {
    throw inputRequiredError(
      'Archidekt login credentials — pass --username and --password-stdin instead',
    )
  }
  const response = await prompts([
    {
      type: 'text',
      name: 'username',
      message: 'Username or Email',
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
    },
  ])

  if (!response.username || !response.password) {
    console.error('Cancelled.')
    return 'cancelled'
  }

  return loginWithCredentials(auth, {
    username: response.username,
    password: response.password,
  })
}
