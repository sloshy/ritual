/**
 * Message registration for the **admin** SPA.
 *
 * Everything the public site registers, plus `admin`, its `admin-api` fragment
 * and the `domain-cache` and `domain-sync` fragments. `admin-api` is the prose the admin HTTP API
 * authors: every response carries it as English plus its key and params, and the
 * admin re-renders that key in the reader's language. The public site's set is
 * reused rather than re-listed because the admin embeds the shared `src/site/**`
 * views wholesale — a fragment the public site needs is one the admin bundle
 * already contains. `domain-sync` is the
 * sync engines' text: the engines send every log line and result reason as
 * English plus its key and params, and the admin's Sync Decks and Sync
 * Collection pages render those keys — streamed or from a finished report — in
 * the reader's language. The public site never syncs, so it is left out of that
 * bundle. `domain-cache` is the card cache's text that reaches a server
 * response: a sync's CSV-upload cache check and the errors a cache refresh
 * raises (a lock time-out), which the Sync Collection and Cache Refresh pages
 * render from their key the same way; the public site never refreshes a cache.
 *
 * Not `cli`/`help`: the admin talks to the CLI's HTTP API, it does not render
 * the CLI's output.
 */

import { adminMessages } from '../messages/en/admin'
import { adminApiMessages } from '../messages/en/admin-api'
import { domainCacheMessages } from '../messages/en/domain-cache'
import { domainSyncMessages } from '../messages/en/domain-sync'
import { registerMessages } from '../runtime'
import { registerSiteMessages } from './site'

/**
 * Register the namespaces the admin speaks. Called at module scope in
 * `src/admin/site/app.tsx`, before the app renders.
 */
export function registerAdminMessages(): void {
  registerSiteMessages()
  registerMessages(adminMessages, adminApiMessages, domainCacheMessages, domainSyncMessages)
}
