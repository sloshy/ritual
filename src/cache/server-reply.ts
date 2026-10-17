/**
 * Reading what a cache server answered when it failed: the refusal body of an
 * HTTP error, or the data of a price stream's `error` event. The bounded read
 * and the quoting itself are shared plumbing in `src/util/reply-text.ts`.
 *
 * A Ritual cache server answers both as the shared message triple — English
 * `message`, with `messageKey` / `messageParams` beside it — which the client
 * nests into its own error, so it reads in the client's language (see
 * `nestReceived`). Anything else is quoted as text: an older server's keyless
 * body, a proxy's HTML page, a reply cut off at the read budget. Quoted text —
 * and every text param of a nested message — is capped and stripped of control
 * characters, so a hostile server or a proxy page can neither flood nor restyle
 * the terminal that prints it.
 */

import { isRecord } from '../util/json'
import { parsedJson, quotedReply } from '../util/reply-text'
import {
  nestReceived,
  readSyncMessage,
  syncMessage,
  type SyncMessage,
  type SyncMessageRef,
  type SyncText,
} from '../sync/message'

/**
 * A value off the wire with every text leaf quoted (per {@link quotedReply}) and
 * everything else — numbers, the shape of nested messages and lists — kept.
 */
function quotedLeaves(value: unknown): unknown {
  if (typeof value === 'string') return quotedReply(value)
  if (Array.isArray(value)) return value.map(quotedLeaves)
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([name, leaf]) => [name, quotedLeaves(leaf)]))
  }
  return value
}

/**
 * A message the server sent, as a param: nested, or its English quoted. A
 * nested message's params are the server's text too — a status line, a name —
 * so each of their text leaves is quoted the same way.
 */
function receivedParam(message: SyncMessage): SyncText {
  const param = nestReceived(message)
  // The walk keeps the shape `nestReceived` checked; only text leaves change.
  return typeof param === 'string' ? quotedReply(param) : (quotedLeaves(param) as SyncMessageRef)
}

/**
 * A failed request's reply, as the `body` param of the client's error: the
 * server's refusal nested (or its English, per `nestReceived`), or the reply's
 * text quoted.
 */
export function replyParam(body: string): SyncText {
  const message = readSyncMessage(parsedJson(body))
  return message === null ? quotedReply(body) : receivedParam(message)
}

/**
 * A price stream's `error` event, as the client's error: the server's failure
 * (per {@link replyParam}), naming the cache key it was resolving when the
 * event carries one. Data that is not an error event is quoted.
 */
export function streamFailureMessage(data: string): SyncMessage {
  const parsed = parsedJson(data)
  const message = readSyncMessage(parsed)
  if (message === null) {
    return syncMessage('domain.cache.serverStreamError', { error: quotedReply(data) })
  }
  const error = receivedParam(message)
  return isRecord(parsed) && typeof parsed.key === 'string'
    ? syncMessage('domain.cache.serverStreamEntryError', { key: quotedReply(parsed.key), error })
    : syncMessage('domain.cache.serverStreamError', { error })
}
