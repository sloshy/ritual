/**
 * Reading what a cache server answered when it failed: the refusal body of an
 * HTTP error, or the data of a price stream's `error` event.
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

import { stripVTControlCharacters } from 'node:util'
import { isRecord } from '../util/json'
import {
  nestReceived,
  readSyncMessage,
  syncMessage,
  type SyncMessage,
  type SyncMessageRef,
  type SyncText,
} from '../sync/message'

/** The most of a failed reply's body the client reads (bytes); the rest is never fetched. */
export const MAX_REPLY_BYTES = 16 * 1024

/** The most of a reply's raw text an error quotes (characters, before the ellipsis). */
export const MAX_QUOTED_CHARS = 1024

/** Whether a code point is a C0 or C1 control character (newlines and tabs included). */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
}

/**
 * Text a server sent, made safe to print inside one line of an error: escape
 * sequences removed, every other control character a space, runs of spaces
 * collapsed, and at most {@link MAX_QUOTED_CHARS} characters kept.
 */
export function quotedReply(text: string): string {
  let clean = ''
  for (const char of stripVTControlCharacters(text)) {
    clean += isControl(char.codePointAt(0) ?? 0) ? ' ' : char
  }
  clean = clean.replace(/ {2,}/g, ' ').trim()
  const chars = [...clean]
  return chars.length > MAX_QUOTED_CHARS ? `${chars.slice(0, MAX_QUOTED_CHARS).join('')}…` : clean
}

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

/** `text` as JSON, or `undefined` when it is not JSON. */
function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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

/**
 * A failed reply's body as text, reading at most {@link MAX_REPLY_BYTES}: the
 * bytes are counted as they arrive and the rest is cancelled, so an endless or
 * enormous error page costs no more than the budget. A cut-off body is not
 * JSON, so {@link replyParam} quotes it.
 */
export async function readReplyText(response: Response): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const room = MAX_REPLY_BYTES - total
      total += value.byteLength
      if (value.byteLength >= room) {
        text += decoder.decode(value.subarray(0, room))
        await reader.cancel()
        return text
      }
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // A connection dropped mid-reply: quote what arrived.
  }
  return text + decoder.decode()
}
