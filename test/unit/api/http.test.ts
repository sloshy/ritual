import { describe, expect, test } from 'bun:test'
import { readJsonObjectBody, type ApiErrorResponse } from '../../../src/api/http'

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
