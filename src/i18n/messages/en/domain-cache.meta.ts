/** Translator metadata for {@link domainCacheMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainCacheMessages } from './domain-cache'

const UPLOAD_CONTEXT =
  'Part of the card-cache check a collection-sync push runs before uploading a CSV to Archidekt (a card-collection website). Shown in the CLI, in the sync report scripts and agents read, and on the admin Sync Collection page.'

const SERVER_CONTEXT =
  'An error from the remote cache server Ritual was pointed at with --cache-server; reported by the CLI and by the admin API. "Cache server" is that server.'

export const domainCacheMeta = {
  'domain.cache.downloadFailed': {
    description:
      "Downloading Scryfall's bulk card data into the local card cache failed. {error} is the underlying error, already worded (it may be a network or server message).",
  },
  'domain.cache.uploadNeedsEmptyCache': {
    description: `${UPLOAD_CONTEXT} Why the cache must be refreshed: it holds no cards at all. "Scryfall IDs" are card identifiers from Scryfall, a card database.`,
  },
  'domain.cache.uploadNeedsFreshCache': {
    description: `${UPLOAD_CONTEXT} Why the cache must be refreshed: it is more than a day old. {age} is a rendered duration such as "2 days, 3 hours".`,
  },
  'domain.cache.uploadRefreshing': {
    description: `${UPLOAD_CONTEXT} {reason} is one of the two "Archidekt CSV uploads are configured…" sentences; this adds that the cache is being refreshed now. "it" is the card cache.`,
  },
  'domain.cache.uploadRemedy': {
    description: `${UPLOAD_CONTEXT} The push is refused. {reason} is the sentence saying why (the cache is empty or stale, or the download failed); this appends what to do. The command and the flag are literal and are not translated.`,
  },
  'domain.cache.uploadStillEmpty': {
    description: `${UPLOAD_CONTEXT} The push is refused because the cache refresh finished but left no cards, so no CSV row could be identified.`,
  },
  'domain.cache.lockTimedOut': {
    description:
      'A cache refresh gave up waiting for another Ritual process to release the cache-write lock. {timeout} is a rendered duration such as "5 minutes"; {holder} is either a quoted operation with its process id and host, or "another process". Shown in the CLI, the admin site and to MCP clients.',
  },
  'domain.cache.lockHolder': {
    description:
      'Names the process holding the cache lock, inside the lock time-out message. {operation} is what that process is doing, recorded in English by it (e.g. "bulk card cache download"); {pid} is its process id; {hostname} is its machine\'s name. "pid" is the technical abbreviation for process id.',
  },
  'domain.cache.lockHolderUnknown': {
    description:
      'Stands in for the process holding the cache lock when it cannot be identified, inside the lock time-out message ("…held by another process.").',
  },
  'domain.cache.serverRequestFailed': {
    description: `${SERVER_CONTEXT} {status} is the HTTP status code, {method} the HTTP method (GET, PUT…) and {url} the request URL — all literal.`,
  },
  'domain.cache.serverRequestFailedWithBody': {
    description: `${SERVER_CONTEXT} The same failure as the previous message, followed by the server's own reply in {body}. {status}, {method} and {url} are literal.`,
  },
  'domain.cache.serverStreamPricesOnly': {
    description: `${SERVER_CONTEXT} An internal error: the streaming lookup was used on a cache other than the prices cache. "streamGetMany" is a function name and is not translated.`,
  },
  'domain.cache.serverStreamNoBody': {
    description: `${SERVER_CONTEXT} The server answered the streaming price lookup with an empty response.`,
  },
  'domain.cache.serverStreamError': {
    description: `${SERVER_CONTEXT} The server reported an error part way through a streaming price lookup; {error} is its own text.`,
  },
  'domain.cache.serverStreamTooLarge': {
    description: `${SERVER_CONTEXT} The streaming price lookup sent more data at once than Ritual will hold, so it was stopped.`,
  },
} satisfies MetaFor<typeof domainCacheMessages>
