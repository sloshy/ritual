import { describe, expect, test } from 'bun:test'
import {
  MAX_QUOTED_CHARS,
  MAX_REPLY_BYTES,
  quotedReply,
  readReplyText,
  replyParam,
  streamFailureMessage,
} from '../../../src/cache/server-reply'
import { syncMessage, type SyncText } from '../../../src/sync/message'

/**
 * How the client reads a cache server's failure: a reply it can render whole is
 * nested by key, anything else is quoted — English as the server sent it, or the
 * raw text, capped and stripped of control characters.
 */

/** A Scryfall refusal as a cache server nests it: a known key with flat params. */
const PRICES_FAILED = {
  message: 'Failed to fetch batch prices: 503 Service Unavailable',
  messageKey: 'domain.cache.scryfall.pricesFailed',
  messageParams: { status: 503, statusText: 'Service Unavailable' },
} as const

type ReplyRow = { name: string; body: string; expected: SyncText }

/** A refusal body as the server sends it (`ApiErrorResponse`), with `fields` over the base. */
function refusalBody(fields: Record<string, unknown>): string {
  return JSON.stringify({ success: false, ...fields })
}

const REPLY_ROWS: ReplyRow[] = [
  {
    name: 'a known key is nested',
    body: refusalBody({
      message: 'Invalid cache route.',
      messageKey: 'domain.cache.serverReply.invalidRoute',
    }),
    expected: { messageKey: 'domain.cache.serverReply.invalidRoute' },
  },
  {
    name: 'a known key is nested with its params',
    body: refusalBody(PRICES_FAILED),
    expected: { messageKey: PRICES_FAILED.messageKey, messageParams: PRICES_FAILED.messageParams },
  },
  {
    name: 'an unknown key keeps the English',
    body: refusalBody({
      message: 'Scryfall is on holiday.',
      messageKey: 'domain.cache.scryfallOnHoliday',
    }),
    expected: 'Scryfall is on holiday.',
  },
  {
    name: 'a known key missing its params keeps the English',
    body: refusalBody({ message: PRICES_FAILED.message, messageKey: PRICES_FAILED.messageKey }),
    expected: PRICES_FAILED.message,
  },
  {
    name: 'a plural count that is not a number keeps the English',
    body: refusalBody({
      message: 'Completed cards.jsonl (lots peers).',
      messageKey: 'cli.cacheFeed.completed',
      messageParams: { file: 'cards.jsonl', count: 'lots' },
    }),
    expected: 'Completed cards.jsonl (lots peers).',
  },
  {
    name: 'a param kind this client does not know keeps the English',
    body: refusalBody({
      message: 'Download size: three fortnights MiB (compressed)',
      messageKey: 'domain.cache.refresh.downloadSize',
      messageParams: { size: { fortnights: 3 } },
    }),
    expected: 'Download size: three fortnights MiB (compressed)',
  },
  ...['"503"', '[503, "Service Unavailable"]', 'null'].map(
    (params): ReplyRow => ({
      name: `params that are not an object (${params}) keep the English`,
      body: `{"message":${JSON.stringify(PRICES_FAILED.message)},"messageKey":"${PRICES_FAILED.messageKey}","messageParams":${params}}`,
      expected: PRICES_FAILED.message,
    }),
  ),
  ...['constructor', 'toString', '__proto__'].map(
    (field): ReplyRow => ({
      name: `a prototype name as a selector value (${field}) keeps the English`,
      body: refusalBody({
        message: `Invalid cache lock: missing ${field}`,
        messageKey: 'cli.cacheLock.missingField',
        messageParams: { field },
      }),
      expected: `Invalid cache lock: missing ${field}`,
    }),
  ),
  {
    name: 'escape sequences are stripped from a nested message’s text params',
    body: refusalBody({
      ...PRICES_FAILED,
      messageParams: { status: 503, statusText: '\u001b[2JService\nUnavailable\u0007' },
    }),
    expected: {
      messageKey: PRICES_FAILED.messageKey,
      messageParams: { status: 503, statusText: 'Service Unavailable' },
    },
  },
  {
    name: 'a prototype name as the key keeps the English',
    body: refusalBody({ message: 'Constructed.', messageKey: 'constructor' }),
    expected: 'Constructed.',
  },
  {
    name: 'a key beside a message that is not text is quoted whole',
    body: '{"message":5,"messageKey":"domain.cache.serverReply.invalidRoute"}',
    expected: '{"message":5,"messageKey":"domain.cache.serverReply.invalidRoute"}',
  },
  {
    name: 'an older server’s keyless body is quoted',
    body: '{"error":"Cache key is required."}',
    expected: '{"error":"Cache key is required."}',
  },
  {
    name: 'a proxy’s HTML page is quoted on one line',
    body: '<html>\n<body>Bad Gateway</body>\n</html>\n',
    expected: '<html> <body>Bad Gateway</body> </html>',
  },
  { name: 'a JSON scalar is quoted', body: '42', expected: '42' },
  { name: 'a JSON array is quoted', body: '[1,2]', expected: '[1,2]' },
  { name: 'an empty object is quoted', body: '{}', expected: '{}' },
  { name: 'an empty body is empty', body: '', expected: '' },
  {
    name: 'escape sequences and control characters are stripped from quoted text',
    body: '\u001b[31mred\u001b[0m\r\nline\ttwo\u0007\u009b',
    expected: 'red line two',
  },
  {
    name: 'escape sequences are stripped from a server’s English too',
    body: refusalBody({ message: '\u001b[2JWiped.', messageKey: 'domain.cache.scryfallOnHoliday' }),
    expected: 'Wiped.',
  },
]

describe('a failed request’s reply', () => {
  for (const row of REPLY_ROWS) {
    test(row.name, () => {
      expect(replyParam(row.body)).toEqual(row.expected)
    })
  }

  test('an oversized text param of a nested message is cut to the quote budget', () => {
    const body = refusalBody({
      ...PRICES_FAILED,
      messageParams: { status: 503, statusText: 'x'.repeat(MAX_QUOTED_CHARS * 5) },
    })
    expect(replyParam(body)).toEqual({
      messageKey: PRICES_FAILED.messageKey,
      messageParams: { status: 503, statusText: `${'x'.repeat(MAX_QUOTED_CHARS)}…` },
    })
  })

  test('a stream error’s nested text params are quoted too', () => {
    const data = JSON.stringify({
      key: 'Sol Ring:usd',
      ...PRICES_FAILED,
      messageParams: { status: 503, statusText: '\u001b[31mDown\u001b[0m' },
    })
    expect(streamFailureMessage(data)).toEqual(
      syncMessage('domain.cache.serverStreamEntryError', {
        key: 'Sol Ring:usd',
        error: {
          messageKey: PRICES_FAILED.messageKey,
          messageParams: { status: 503, statusText: 'Down' },
        },
      }),
    )
  })

  test('an oversized reply is cut to the quote budget', () => {
    const quoted = replyParam('x'.repeat(MAX_QUOTED_CHARS * 5))
    expect(quoted).toBe(`${'x'.repeat(MAX_QUOTED_CHARS)}…`)
  })

  test('the budget counts characters, not UTF-16 halves', () => {
    expect(quotedReply('🂡'.repeat(MAX_QUOTED_CHARS + 1))).toBe(`${'🂡'.repeat(MAX_QUOTED_CHARS)}…`)
  })
})

describe('a price stream’s error event', () => {
  test('naming its entry nests the failure under the entry’s key', () => {
    expect(streamFailureMessage(JSON.stringify({ key: 'Sol Ring:usd', ...PRICES_FAILED }))).toEqual(
      syncMessage('domain.cache.serverStreamEntryError', {
        key: 'Sol Ring:usd',
        error: { messageKey: PRICES_FAILED.messageKey, messageParams: PRICES_FAILED.messageParams },
      }),
    )
  })

  test('without an entry is a failure of the whole stream', () => {
    expect(streamFailureMessage(JSON.stringify(PRICES_FAILED))).toEqual(
      syncMessage('domain.cache.serverStreamError', {
        error: { messageKey: PRICES_FAILED.messageKey, messageParams: PRICES_FAILED.messageParams },
      }),
    )
  })

  test('an entry key that is not text names no entry', () => {
    expect(streamFailureMessage(JSON.stringify({ key: 7, ...PRICES_FAILED }))).toEqual(
      syncMessage('domain.cache.serverStreamError', {
        error: { messageKey: PRICES_FAILED.messageKey, messageParams: PRICES_FAILED.messageParams },
      }),
    )
  })

  test('an unknown key keeps the English', () => {
    const data = JSON.stringify({ key: 'Sol Ring:usd', message: 'Gone.', messageKey: 'x.y' })
    expect(streamFailureMessage(data)).toEqual(
      syncMessage('domain.cache.serverStreamEntryError', { key: 'Sol Ring:usd', error: 'Gone.' }),
    )
  })

  test('data that is not an error event is quoted', () => {
    expect(streamFailureMessage('\u001b[1mboom\u001b[0m\nagain')).toEqual(
      syncMessage('domain.cache.serverStreamError', { error: 'boom again' }),
    )
  })
})

describe('reading a failed reply', () => {
  test('reads at most the byte budget', async () => {
    const text = await readReplyText(new Response('x'.repeat(MAX_REPLY_BYTES * 4)))
    expect(text).toHaveLength(MAX_REPLY_BYTES)
  })

  test('stops pulling a body that never ends', async () => {
    let pulls = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        controller.enqueue(new Uint8Array(1024).fill(0x61))
      },
    })
    const text = await readReplyText(new Response(endless))
    expect(text).toHaveLength(MAX_REPLY_BYTES)
    expect(pulls).toBeLessThan(MAX_REPLY_BYTES / 1024 + 3)
  })

  test('a reply with no body is empty', async () => {
    expect(await readReplyText(new Response(null, { status: 404 }))).toBe('')
  })
})
