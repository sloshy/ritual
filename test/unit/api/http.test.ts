import { describe, expect, test } from 'bun:test'
import {
  errorResponse,
  readBodyText,
  readJsonObjectBody,
  type ApiErrorResponse,
  type BodyText,
} from '../../../src/api/http'

import { ExitCode, localizedCommandError } from '../../../src/util/errors'
import { withSyntheticLocale } from '../../helpers/sync-text'
/**
 * The shared JSON-body route prologue. Its two refusal messages are pinned here
 * rather than in each adopting handler's suite: they are the *shared* wording,
 * and a handler test asserting them would only re-pin what this owns.
 */

/** Build a POST request carrying `raw` verbatim as its body. */
function post(raw: string): Request {
  return new Request('http://localhost/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  })
}

/** A refusal, unpacked for assertion. */
type Refusal = { status: number; body: ApiErrorResponse }

/** The refusal body a non-ok outcome carries, failing the test if it succeeded. */
async function refuse(raw: string): Promise<Refusal> {
  const result = await readJsonObjectBody(post(raw))
  if (result.ok) throw new Error('expected a refusal, got a parsed body')
  return {
    status: result.response.status,
    body: (await result.response.json()) as ApiErrorResponse,
  }
}

describe('readJsonObjectBody', () => {
  test('parses a JSON object through', async () => {
    const result = await readJsonObjectBody(post('{"format":"csv","write":true}'))
    expect(result.ok && result.body).toEqual({ format: 'csv', write: true })
  })

  test('unparseable JSON is refused as a 400', async () => {
    const { status, body } = await refuse('{not json')
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be JSON.')
  })

  // The cap runs first, so a body that would *also* fail to parse comes back as
  // 413 rather than 400 — the order every large-upload refusal depends on.
  test('an oversized declared body is refused before parse', async () => {
    const req = new Request('http://localhost/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '99999' },
      body: '{not json',
    })

    const result = await readJsonObjectBody(req, 10)
    if (result.ok) throw new Error('expected a refusal, got a parsed body')
    expect(result.response.status).toBe(413)
    expect(((await result.response.json()) as ApiErrorResponse).message).toBe(
      'Request body too large (limit 10 bytes)',
    )
  })

  test.each([
    ['an array', '[1,2]'],
    ['a bare string', '"nope"'],
    ['null', 'null'],
  ])('%s parses but is not an object', async (_label, raw) => {
    const { status, body } = await refuse(raw)
    expect(status).toBe(400)
    expect(body.message).toBe('Request body must be a JSON object.')
  })
})

/** A stream of `x` bytes that never ends, recording how it was consumed. */
type ProbedStream = {
  stream: ReadableStream<Uint8Array>
  pulled: () => number
  cancelled: () => boolean
}

function endlessStream(chunkSize: number): ProbedStream {
  const chunk = new Uint8Array(chunkSize).fill(0x78)
  let pulled = 0
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller): void {
        pulled += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel(): void {
        cancelled = true
      },
    },
    // No read-ahead, so `pulled` counts exactly what the reader asked for.
    { highWaterMark: 0 },
  )
  return { stream, pulled: () => pulled, cancelled: () => cancelled }
}

/** A finite stream that delivers `chunks` one read at a time. */
function chunkedStream(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  const queue = [...chunks]
  return new ReadableStream<Uint8Array>({
    pull(controller): void {
      const next = queue.shift()
      if (next === undefined) controller.close()
      else controller.enqueue(next)
    },
  })
}

/** A POST whose body is `body` and whose `Content-Length` is `declared` (absent when undefined). */
function postBody(body: BodyInit, declared?: string): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (declared !== undefined) headers.set('Content-Length', declared)
  return new Request('http://localhost/api/save', { method: 'POST', headers, body })
}

/** The refusal's status, failing the test if the read succeeded. */
function refusedStatus(result: BodyText): number {
  if (result.ok) throw new Error('expected a refusal, got a body')
  return result.response.status
}

describe('readBodyText', () => {
  // The budget is measured, not trusted from a header: an in-process `Request`
  // declares no size, and neither does a chunked upload.
  test('an undeclared body is measured against the budget, inclusive at the limit', async () => {
    expect(postBody('x'.repeat(10)).headers.get('Content-Length')).toBeNull()

    expect(await readBodyText(postBody('x'.repeat(10)), 10)).toEqual({
      ok: true,
      text: 'x'.repeat(10),
    })
    expect(refusedStatus(await readBodyText(postBody('x'.repeat(11)), 10))).toBe(413)
  })

  test('a streamed body is cancelled as soon as it passes the budget', async () => {
    const probe = endlessStream(4)

    expect(refusedStatus(await readBodyText(postBody(probe.stream), 10))).toBe(413)
    // Three 4-byte chunks take it past 10; nothing after that is read.
    expect(probe.pulled()).toBe(12)
    expect(probe.cancelled()).toBe(true)
  })

  test('a declared size over the budget is refused before any of the body is read', async () => {
    const probe = endlessStream(4)

    expect(refusedStatus(await readBodyText(postBody(probe.stream, '11'), 10))).toBe(413)
    expect(probe.pulled()).toBe(0)
  })

  // A header that is present but unparseable must not read as "fits".
  test('a malformed declared size is refused', async () => {
    expect(refusedStatus(await readBodyText(postBody('{}', 'lots')))).toBe(413)
  })

  test('a body declaring exactly the budget is accepted', async () => {
    expect(await readBodyText(postBody('x'.repeat(10), '10'), 10)).toEqual({
      ok: true,
      text: 'x'.repeat(10),
    })
  })

  // The header is only an early refusal; the bytes that actually arrive are
  // what the budget holds against.
  test('a body larger than its declared size is refused once it passes the budget', async () => {
    const lying = postBody(chunkedStream([new Uint8Array(8).fill(0x78), new Uint8Array(8)]), '5')
    expect(lying.headers.get('Content-Length')).toBe('5')

    expect(refusedStatus(await readBodyText(lying, 10))).toBe(413)
  })

  test('a multi-byte character split across two chunks decodes whole', async () => {
    // '€' is E2 82 AC in UTF-8; the chunk boundary falls inside it.
    const split = chunkedStream([new Uint8Array([0x22, 0xe2, 0x82]), new Uint8Array([0xac, 0x22])])
    expect(await readBodyText(postBody(split))).toEqual({ ok: true, text: '"€"' })
  })

  test('a bodiless request reads as empty text', async () => {
    const req = new Request('http://localhost/api/save', { method: 'POST' })
    expect(await readBodyText(req)).toEqual({ ok: true, text: '' })
  })

  test('the budget counts bytes, not characters', async () => {
    // Four bytes per glyph in UTF-8: three glyphs fit 12, not 11.
    const text = '🂡🂢🂣'
    expect(await readBodyText(postBody(text), 12)).toEqual({ ok: true, text })
    expect(refusedStatus(await readBodyText(postBody(text), 11))).toBe(413)
  })
})

describe('errorResponse', () => {
  test('answers a keyed command error in English with its key, at its status', async () => {
    // Thrown in the process's own language, deep in an engine: the response is
    // still English plus the key, whatever route it surfaced through.
    const resp = withSyntheticLocale('xx', { 'admin.api.setup.userExists': 'Schon da' }, () => {
      const thrown = localizedCommandError(
        'usage_error',
        ExitCode.UsageError,
        'admin.api.setup.userExists',
      )
      expect(thrown.message).toBe('Schon da')
      return errorResponse(thrown)
    })
    expect(resp.status).toBe(400)
    expect(await resp.json()).toEqual({
      success: false,
      message: 'Admin user already exists',
      messageKey: 'admin.api.setup.userExists',
    })
  })

  test('answers anything else with its own text at 500', async () => {
    const resp = errorResponse(new Error('disk on fire'))
    expect(resp.status).toBe(500)
    expect(await resp.json()).toEqual({ success: false, message: 'disk on fire' })
  })
})
