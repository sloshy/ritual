/** Translator metadata for {@link domainCacheMessages}. See `src/i18n/types.ts`. */

import type { MetaFor } from '../../types'
import type { domainCacheMessages } from './domain-cache'

const UPLOAD_CONTEXT =
  'Part of the card-cache check a collection-sync push runs before uploading a CSV to Archidekt (a card-collection website). Shown in the CLI, in the sync report scripts and agents read, and on the admin Sync Collection page.'

const SERVER_CONTEXT =
  'An error from the remote cache server Ritual was pointed at with --cache-server; reported by the CLI and by the admin API. "Cache server" is that server.'

const PROGRESS_CONTEXT =
  "A progress line of a card-cache refresh: Ritual downloading Scryfall's (a card database's) bulk card data into its local card cache. Shown on the admin Cache Refresh page while the refresh runs, in the CLI, and to MCP clients as a progress note."

const REFRESH_FAILURE_CONTEXT =
  'Why a card-cache refresh (downloading Scryfall\'s bulk card data into the local card cache) failed. A Scryfall "bulk" is one of the large data files Scryfall publishes.'

const REFRESH_FAILURE_SHOWN =
  'Shown in the CLI, on the admin Cache Refresh page and to MCP clients.'

const HTTP_STATUS_NOTE =
  '{status} is the HTTP status code (e.g. 500) and {statusText} its standard English reason phrase (e.g. "Internal Server Error", possibly empty), both as the server sent them.'

const REQUEST_CONTEXT =
  "A request to Scryfall, the card database Ritual reads card data from, failed. Shown in the CLI, and wherever a Ritual server made the request: in the admin site and to MCP clients, or nested in a cache server's reply to another Ritual process."

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
  'domain.cache.serverStreamEntryError': {
    description: `${SERVER_CONTEXT} The server could not resolve one entry of a streaming price lookup. {key} is that entry's cache key — a card name, possibly with a currency after a colon (e.g. "Sol Ring:usd") — literal; {error} is the server's own reason, already worded.`,
  },
  'domain.cache.serverStreamTooLarge': {
    description: `${SERVER_CONTEXT} The streaming price lookup sent more data at once than Ritual will hold, so it was stopped.`,
  },
  'domain.cache.refresh.fetchingMetadata': {
    description: `${PROGRESS_CONTEXT} The first step: asking Scryfall which bulk files exist and where to download them.`,
  },
  'domain.cache.refresh.downloadingTags': {
    description: `${PROGRESS_CONTEXT} Downloading Scryfall's "oracle tags" (tags on a card's rules text) and "art tags" (tags on its artwork), which are attached to each cached card.`,
  },
  'domain.cache.refresh.downloadSize': {
    description: `${PROGRESS_CONTEXT} How large the compressed download is. {size} is a number with two decimals (e.g. "72.50"), already formatted for the language; "MiB" is the binary-megabyte unit symbol.`,
  },
  'domain.cache.refresh.processing': {
    description: `${PROGRESS_CONTEXT} Repeated as the download streams in and its cards are processed. {percentage} is a whole number from 0 to 100 (the line adds the % sign); {received} and {total} are how much of the compressed download has arrived and its whole size, numbers with two decimals already formatted for the language. "MiB" is the binary-megabyte unit symbol.`,
  },
  'domain.cache.refresh.processingUnsized': {
    description: `${PROGRESS_CONTEXT} Repeated as the download streams in when the server did not say how large it is, so there is no percentage. {received} is how much has arrived, a number with two decimals already formatted for the language. "MiB" is the binary-megabyte unit symbol.`,
  },
  'domain.cache.refresh.saving': {
    description: `${PROGRESS_CONTEXT} Every card has been processed; the new card cache is being written to disk.`,
  },
  'domain.cache.refresh.done': {
    description: `${PROGRESS_CONTEXT} The last line: the refresh finished and the card cache now holds the downloaded cards.`,
  },
  'domain.cache.refresh.cancelled': {
    description: `${REFRESH_FAILURE_CONTEXT} Its caller cancelled it (an MCP client, which reads this as the cancelled call's error); nothing was changed.`,
  },
  'domain.cache.refresh.noBulkUri': {
    description: `${REFRESH_FAILURE_CONTEXT} ${REFRESH_FAILURE_SHOWN} Scryfall's list of bulk files did not include the one Ritual needs. {bulk} is that file's literal Scryfall name ("default_cards" or "all_cards"); "URI" is its download address.`,
  },
  'domain.cache.refresh.manifestFailed': {
    description: `${REFRESH_FAILURE_CONTEXT} ${REFRESH_FAILURE_SHOWN} Scryfall refused the request for its list of bulk files (the "bulk manifest"). ${HTTP_STATUS_NOTE}`,
  },
  'domain.cache.refresh.bulkFetchFailed': {
    description: `${REFRESH_FAILURE_CONTEXT} ${REFRESH_FAILURE_SHOWN} Scryfall refused the download of the bulk card file itself. ${HTTP_STATUS_NOTE}`,
  },
  'domain.cache.refresh.bulkNoBody': {
    description: `${REFRESH_FAILURE_CONTEXT} ${REFRESH_FAILURE_SHOWN} Scryfall answered the bulk card download with an empty response.`,
  },
  'domain.cache.refresh.invalidJsonLine': {
    description: `${REFRESH_FAILURE_CONTEXT} ${REFRESH_FAILURE_SHOWN} The downloaded file is in JSONL format (one JSON value per line) and one line could not be read. {line} is that line's number. "JSONL" and "JSON" are format names and are not translated.`,
  },
  'domain.cache.refresh.tagsAborted': {
    description:
      'A refresh of only the card tags (Scryfall\'s "oracle tags" and "art tags", attached to each card in the local card cache) stopped because those tag files could not be downloaded. Shown in the CLI (`ritual cache refresh-tags`). A tag "bulk" is the file Scryfall publishes them in.',
  },
  'domain.cache.scryfall.timedOut': {
    description: `${REQUEST_CONTEXT} Scryfall did not answer in time. {timeout} is a rendered duration such as "15 seconds"; {url} is the request's address, literal.`,
  },
  'domain.cache.scryfall.symbologyFailed': {
    description: `${REQUEST_CONTEXT} The request was for Scryfall's "symbology": the list of mana and other symbols printed on cards. ${HTTP_STATUS_NOTE}`,
  },
  'domain.cache.scryfall.printingFailed': {
    description: `${REQUEST_CONTEXT} The request was for one printing of a card (one edition, by set code and collector number). ${HTTP_STATUS_NOTE}`,
  },
  'domain.cache.scryfall.pricesFailed': {
    description: `${REQUEST_CONTEXT} The request was for the current prices of a batch of cards. ${HTTP_STATUS_NOTE}`,
  },
  'domain.cache.scryfall.pricesNotFound': {
    description: `${REQUEST_CONTEXT} Scryfall knew no card by some of the names whose prices were asked for. {names} is the list of those card names (in English, as Scryfall spells them), already joined for the language.`,
  },
} satisfies MetaFor<typeof domainCacheMessages>
