/**
 * `domain.cache.*` — the card cache's text that reaches a reader other than the
 * CLI's own console: the CSV-upload freshness gate a collection-sync push runs
 * (its progress line and its refusal land in the sync report and on the admin
 * Sync Collection page), and the errors the cache layer throws up to a route
 * (a cache-lock timeout, a failed cache-server request), which the admin API
 * and MCP answer with in English plus the key.
 *
 * A fragment of the domain namespace, registered by the CLI and the admin SPA,
 * which renders these from their key in the reader's language — never the
 * public site, which neither syncs nor refreshes a cache. The cache layer's
 * console-only text (prompts, progress, operator logs) lives in `cli-infra`.
 *
 * Commands (`ritual cache preload-all`), flags (`--refresh auto`), Scryfall
 * bulk names, process ids, host names, HTTP methods and URLs are machine
 * vocabulary and stay as they are inside the sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainCacheMessages = {
  // ── Refresh ───────────────────────────────────────────────────────────
  'domain.cache.downloadFailed': 'Card cache download failed: {error}',

  // ── The CSV upload's freshness gate ───────────────────────────────────
  'domain.cache.uploadNeedsEmptyCache':
    'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty.',
  'domain.cache.uploadNeedsFreshCache':
    'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is {age} old.',
  'domain.cache.uploadRefreshing': '{reason} Refreshing it from Scryfall first...',
  'domain.cache.uploadRemedy':
    '{reason} Run `ritual cache preload-all`, or re-run with --refresh auto.',
  'domain.cache.uploadStillEmpty':
    'The card cache is still empty after a refresh, so no CSV row could be keyed by a Scryfall id.',

  // ── The cache-write lock ──────────────────────────────────────────────
  'domain.cache.lockTimedOut':
    'Timed out after {timeout} waiting for the cache lock held by {holder}. If no other ritual process is running, delete the lock file manually.',
  'domain.cache.lockHolder': '"{operation}" (pid {pid} on {hostname})',
  'domain.cache.lockHolderUnknown': 'another process',

  // ── A remote cache server (`--cache-server`) ──────────────────────────
  'domain.cache.serverRequestFailed': 'Cache server request failed ({status}) {method} {url}',
  'domain.cache.serverRequestFailedWithBody':
    'Cache server request failed ({status}) {method} {url}: {body}',
  'domain.cache.serverStreamPricesOnly': 'streamGetMany is only supported for prices cache.',
  'domain.cache.serverStreamNoBody': 'Cache server stream response body is missing.',
  'domain.cache.serverStreamError': 'Cache server stream error: {error}',
  'domain.cache.serverStreamTooLarge': 'Cache server stream buffer exceeded maximum size',
} as const satisfies MessageCatalogShape
