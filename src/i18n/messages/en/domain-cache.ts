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
 * The bulk card-cache refresh's progress lines and failures are here too: the
 * admin Cache Refresh page streams them (`/api/cache/refresh/stream`) and
 * renders them from their key, and MCP `refresh_cache` reads them in English.
 * So are the Scryfall request failures a Ritual server can surface: a
 * timed-out request or a failed symbology fetch through an admin route, a
 * failed price batch nested in a cache server's reply to its client. (A failed
 * printing fetch is keyed the same way; today only the CLI reports it.) So is
 * why a cache server refused a request (`domain.cache.serverReply.*`): it goes
 * out in English beside its key, and the client words it in its own language.
 * A cache-feed host's refusals (`domain.cache.feedReply.*`) go out the same way.
 *
 * Commands (`ritual cache preload-all`), flags (`--refresh auto`), Scryfall
 * bulk names, process ids, host names, HTTP methods and URLs are machine
 * vocabulary and stay as they are inside the sentences that mention them.
 */

import type { MessageCatalogShape } from '../../types'

export const domainCacheMessages = {
  // ── Refresh ───────────────────────────────────────────────────────────
  'domain.cache.downloadFailed': 'Card cache download failed: {error}',

  // ── The bulk refresh's progress lines ─────────────────────────────────
  'domain.cache.refresh.fetchingMetadata': 'Fetching bulk data metadata from Scryfall…',
  'domain.cache.refresh.downloadingTags': 'Downloading oracle/art tags…',
  'domain.cache.refresh.downloadSize': 'Download size: {size} MiB (compressed)',
  'domain.cache.refresh.processing': 'Processing: {percentage}% ({received}/{total} MiB)',
  'domain.cache.refresh.processingUnsized': 'Processing: {received} MiB',
  'domain.cache.refresh.saving': 'Saving to cache…',
  'domain.cache.refresh.done': 'Done! Card cache populated.',

  // ── The bulk refresh's failures ───────────────────────────────────────
  'domain.cache.refresh.cancelled':
    'The cache refresh was cancelled; the existing card cache was left as it was.',
  'domain.cache.refresh.noBulkUri': 'Could not find {bulk} bulk data URI',
  'domain.cache.refresh.manifestFailed': 'Failed to fetch bulk manifest: {status} {statusText}',
  'domain.cache.refresh.bulkFetchFailed': 'Failed to fetch bulk data: {status} {statusText}',
  'domain.cache.refresh.bulkNoBody': 'Bulk data response has no body',
  'domain.cache.refresh.invalidJsonLine': 'Invalid JSONL: line {line} is not valid JSON',
  'domain.cache.refresh.tagsAborted':
    'Tag refresh aborted: could not download the oracle/art tag bulks.',

  // ── Scryfall requests ─────────────────────────────────────────────────
  'domain.cache.scryfall.timedOut': 'Scryfall request timed out after {timeout}: {url}',
  'domain.cache.scryfall.symbologyFailed': 'Failed to fetch symbology: {status} {statusText}',
  'domain.cache.scryfall.printingFailed': 'Failed to fetch printing: {status} {statusText}',
  'domain.cache.scryfall.pricesFailed': 'Failed to fetch batch prices: {status} {statusText}',
  'domain.cache.scryfall.pricesNotFound': 'Scryfall could not find prices for: {names}',

  // ── The Card Kingdom buylist feed ─────────────────────────────────────
  'domain.cache.cardKingdom.noFeed': 'No Card Kingdom buylist has been downloaded yet.',
  'domain.cache.cardKingdom.missingAdvice':
    '{lead} Re-run with {flag} to download it (~{size} MB).',
  'domain.cache.cardKingdom.missingApiAdvice':
    '{lead} Refresh the Card Kingdom buylist first: the {tool} tool, {route}, or `{command}` on the CLI.',
  'domain.cache.cardKingdom.downloadFailed': 'Card Kingdom feed download failed: {error}',
  'domain.cache.cardKingdom.downloadHttpFailed': 'Card Kingdom feed download failed: HTTP {status}',
  'domain.cache.cardKingdom.notJson': 'Card Kingdom feed was not valid JSON: {error}',
  'domain.cache.cardKingdom.feed.notObject': 'Invalid Card Kingdom feed: expected a JSON object',
  'domain.cache.cardKingdom.feed.noMeta': 'Invalid Card Kingdom feed: missing meta object',
  'domain.cache.cardKingdom.feed.noData': 'Invalid Card Kingdom feed: missing data array',
  'domain.cache.cardKingdom.feed.noProducts': 'Invalid Card Kingdom feed: no readable products',
  'domain.cache.cardKingdom.feed.productSkipped':
    'Skipped Card Kingdom product data[{index}]: {reason}',
  'domain.cache.cardKingdom.feed.moreSkipped': {
    $plural: 'count',
    one: 'Skipped {count} more malformed Card Kingdom product',
    other: 'Skipped {count} more malformed Card Kingdom products',
  },
  'domain.cache.cardKingdom.product.notObject': 'not an object',
  'domain.cache.cardKingdom.product.noId': 'missing numeric id',
  'domain.cache.cardKingdom.product.noSku': 'missing string sku',
  'domain.cache.cardKingdom.product.noName': 'missing card name',
  'domain.cache.cardKingdom.product.noEdition': 'missing edition',
  'domain.cache.cardKingdom.product.unreadable': "unreadable {field} '{value}'",

  // ── The CSV upload's freshness gate ───────────────────────────────────
  'domain.cache.uploadNeedsEmptyCache':
    'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is empty.',
  'domain.cache.uploadNeedsFreshCache':
    'Archidekt CSV uploads are configured to require Scryfall IDs from the local card cache, which is {age} old.',
  'domain.cache.uploadRefreshing': '{reason} Refreshing it from Scryfall first...',
  'domain.cache.uploadRemedy': '{reason} Run `{command}`, or re-run with {flag}.',
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
  'domain.cache.serverStreamEntryError': "Cache server stream error for '{key}': {error}",
  'domain.cache.serverStreamTooLarge': 'Cache server stream buffer exceeded maximum size',

  // What a Ritual cache server answers a refused request with: English on the
  // wire, `messageKey` beside it, rendered by the client in its own language as
  // the reply inside `serverRequestFailedWithBody`.
  'domain.cache.serverReply.notFound': 'Not found.',
  'domain.cache.serverReply.invalidSection': 'Invalid cache section.',
  'domain.cache.serverReply.invalidRoute': 'Invalid cache route.',
  'domain.cache.serverReply.methodNotAllowed': 'Method not allowed.',
  'domain.cache.serverReply.keyRequired': 'Cache key is required.',
  'domain.cache.serverReply.keysRequired': 'At least one cache key is required.',
  'domain.cache.serverReply.keyMalformed': 'Cache key is not validly URL-encoded.',
  'domain.cache.serverReply.bodyNotJson': 'Expected a JSON request body.',
  'domain.cache.serverReply.bodyNotObject': 'Expected the request body to be a JSON object.',
  'domain.cache.serverReply.entriesExpected': "Expected JSON body with 'entries' object.",
  'domain.cache.serverReply.replaceNotBoolean': "Expected 'replace' to be a boolean.",
  'domain.cache.serverReply.keysExpected': "Expected JSON body with 'keys' string array.",
  'domain.cache.serverReply.valueExpected': "Expected JSON body with 'value'.",
  'domain.cache.serverReply.internalError': 'Internal server error.',
  'domain.cache.serverReply.httpDenied':
    'HTTP requests are denied ({flag}). Pre-populate the cache for testing.',

  // What a cache-feed host (`cache feed host`) answers a refused request with:
  // English on the wire with `messageKey` beside it, like a cache server's
  // replies. Its readers act on the HTTP status.
  'domain.cache.feedReply.notFound': 'Not found.',
  'domain.cache.feedReply.fileNotListed': 'The feed does not list this file.',
  'domain.cache.feedReply.torrentNotListed': 'The feed does not list this torrent.',
  'domain.cache.feedReply.methodNotAllowed': 'Method not allowed.',
  'domain.cache.feedReply.pathMalformed': 'The requested name is not validly URL-encoded.',
  'domain.cache.feedReply.notGenerated': 'The feed has not been generated yet.',
  'domain.cache.feedReply.rangeNotSatisfiable': 'The requested byte range cannot be served.',
  'domain.cache.feedReply.internalError': 'Internal server error.',
} as const satisfies MessageCatalogShape
