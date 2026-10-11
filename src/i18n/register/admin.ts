/**
 * Message registration for the **admin** SPA.
 *
 * Everything the public site registers, plus `admin` and the `domain-sync`
 * fragment. The public site's set is reused rather than re-listed because the
 * admin embeds the shared `src/site/**` views wholesale — a fragment the public
 * site needs is one the admin bundle already contains. `domain-sync` is the
 * sync engines' text: the engines send every log line and result reason as
 * English plus its key and params, and the admin's Sync Decks and Sync
 * Collection pages render those keys — streamed or from a finished report — in
 * the reader's language. The public site never syncs, so it is left out of that
 * bundle.
 *
 * Not `cli`/`help`: the admin talks to the CLI's HTTP API, it does not render
 * the CLI's output.
 */

import { adminMessages } from '../messages/en/admin'
import { domainSyncMessages } from '../messages/en/domain-sync'
import { registerMessages } from '../runtime'
import { registerSiteMessages } from './site'

/**
 * Register the namespaces the admin speaks. Called at module scope in
 * `src/admin/site/app.tsx`, before the app renders.
 */
export function registerAdminMessages(): void {
  registerSiteMessages()
  registerMessages(adminMessages, domainSyncMessages)
}
