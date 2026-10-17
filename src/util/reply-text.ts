/**
 * Text another program sent — a remote server's reply, a child process's
 * output — made safe to read and to quote inside one line of an error.
 *
 * Shared HTTP (and subprocess) plumbing: the cache clients quote a cache
 * server's or feed host's failed reply with it, the Archidekt login quotes
 * Archidekt's reason, and `self-update` quotes GitHub's release data and the
 * new binary's output. Reads are bounded, so an endless or enormous body costs
 * no more than its budget, and quotes are capped and stripped of control
 * characters, so a hostile server or a proxy page can neither flood nor
 * restyle the terminal that prints them.
 */

import { stripVTControlCharacters } from 'node:util'

/** The most of a failed reply's body {@link readReplyText} reads (bytes); the rest is never fetched. */
export const MAX_REPLY_BYTES = 16 * 1024

/** The most of a reply's raw text an error quotes by default (characters, before the ellipsis). */
export const MAX_QUOTED_CHARS = 1024

/** Whether a code point is a C0 or C1 control character (newlines and tabs included). */
function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f)
}

/**
 * Text another program sent, made safe to print inside one line of an error:
 * escape sequences removed, every other control character (a line break
 * included) a space, runs of spaces collapsed, the ends trimmed, and at most
 * `maxChars` code points kept — an ellipsis marks a cut.
 */
export function quotedReply(text: string, maxChars: number = MAX_QUOTED_CHARS): string {
  let clean = ''
  for (const char of stripVTControlCharacters(text)) {
    clean += isControl(char.codePointAt(0) ?? 0) ? ' ' : char
  }
  clean = clean.replace(/ {2,}/g, ' ').trim()
  const chars = [...clean]
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : clean
}

/** `text` as JSON, or `undefined` when it is not JSON. */
export function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A body as text, reading at most `maxBytes`: the bytes are counted as they
 * arrive and the rest is cancelled. A connection that drops mid-body rejects,
 * as `Response.text()` would.
 */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  return readUpTo(response, maxBytes, 'reject')
}

/**
 * A failed reply's body as text, reading at most `maxBytes`
 * ({@link MAX_REPLY_BYTES} by default). Never rejects: a connection that
 * drops mid-reply yields what arrived, since a failure's reply is evidence, not
 * data. A cut-off body is not JSON, so a caller parsing it quotes it instead.
 */
export async function readReplyText(
  response: Response,
  maxBytes: number = MAX_REPLY_BYTES,
): Promise<string> {
  return readUpTo(response, maxBytes, 'keep')
}

/** What a read does when the connection drops part way. */
type DropPolicy = 'reject' | 'keep'

async function readUpTo(response: Response, maxBytes: number, onDrop: DropPolicy): Promise<string> {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const room = maxBytes - total
      total += value.byteLength
      if (value.byteLength >= room) {
        text += decoder.decode(value.subarray(0, room))
        await reader.cancel()
        return text
      }
      text += decoder.decode(value, { stream: true })
    }
  } catch (error) {
    if (onDrop === 'reject') throw error
  }
  return text + decoder.decode()
}
