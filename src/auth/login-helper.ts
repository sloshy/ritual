import type { ArchidektAuth } from './ArchidektAuth'
import type { ArchidektCredentials } from './interfaces'
import { getErrorMessage } from '../util/errors'

/** The slice of {@link ArchidektAuth} a credentialed login needs. */
export type LoginService = Pick<ArchidektAuth, 'login' | 'getStoredUser'>

/** How a credentialed login attempt ended (credentials already in hand). */
export type LoginResult =
  | { outcome: 'success'; username: string | undefined }
  | { outcome: 'failed'; error: string }

/**
 * Perform the actual Archidekt login with credentials already in hand. Prints
 * nothing — the CLI reports the outcome — so the interactive prompt flow and
 * the headless `--username`/`--password-stdin` path share one attempt.
 */
export async function loginWithCredentials(
  auth: LoginService,
  credentials: ArchidektCredentials,
): Promise<LoginResult> {
  try {
    await auth.login(credentials)
    const user = await auth.getStoredUser()
    return { outcome: 'success', username: user?.username }
  } catch (error: unknown) {
    return { outcome: 'failed', error: getErrorMessage(error) }
  }
}
