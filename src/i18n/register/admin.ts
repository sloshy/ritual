/**
 * Message registration for the **admin** SPA (plan §4.2).
 *
 * Everything the public site registers, plus `admin`. The public site's set is
 * reused rather than re-listed because the admin embeds the shared
 * `src/site/**` views wholesale — a fragment the public site needs is one the
 * admin bundle already contains.
 *
 * Not `cli`/`help`: the admin talks to the CLI's HTTP API, it does not render
 * the CLI's output.
 */

import { adminMessages } from '../messages/en/admin'
import { registerMessages } from '../runtime'
import { registerSiteMessages } from './site'

/**
 * Register the namespaces the admin speaks. Called at module scope in
 * `src/admin/site/app.tsx`, before the app renders.
 */
export function registerAdminMessages(): void {
  registerSiteMessages()
  registerMessages(adminMessages)
}
