import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { callApi, callApiData } from '../../../src/mcp/dispatch'
import { withConflictRetry } from '../../../src/mcp/mutations'
import { CONFLICT_ERROR_CODE } from '../../../src/mcp/error-codes'
import { apiErrorToMcp, isConflictError, type McpErrorDetail } from '../../../src/mcp/errors'
import { runTool, type ToolErrorPayload } from '../../../src/mcp/result'
import { toolError } from '../../mcp-test-utils'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

describe('apiErrorToMcp', () => {
  test('maps client-error statuses to InvalidParams and keeps the message', () => {
    for (const status of [400, 404]) {
      const err = apiErrorToMcp(status, { message: `boom ${status}` })
      expect(ProtocolError.isInstance(err)).toBe(true)
      expect(err.code).toBe(ProtocolErrorCode.InvalidParams)
      expect(err.message).toContain(`boom ${status}`)
    }
  })

  test('maps server errors to InternalError and supplies a fallback message', () => {
    const err = apiErrorToMcp(500, {})
    expect(err.code).toBe(ProtocolErrorCode.InternalError)
    expect(err.message).toContain('500')
  })

  // A lost concurrency race is not a bad request: nothing about the call was
  // wrong, and the fix is to re-read and retry rather than to change an argument.
  test('maps a conflict to its own code, by flag or by status', () => {
    expect(apiErrorToMcp(409, { message: 'modified' }).code).toBe(CONFLICT_ERROR_CODE)
    expect(apiErrorToMcp(400, { message: 'modified', conflict: true }).code).toBe(
      CONFLICT_ERROR_CODE,
    )
  })

  test('isConflictError recognizes only the conflict code', () => {
    expect(isConflictError(apiErrorToMcp(409, {}))).toBe(true)
    expect(isConflictError(apiErrorToMcp(400, {}))).toBe(false)
    expect(isConflictError(apiErrorToMcp(500, {}))).toBe(false)
    expect(isConflictError(new Error('plain'))).toBe(false)
  })
})

describe('callApi', () => {
  let env: RitualTestEnv

  beforeEach(async () => {
    env = await setupRitualTestEnv()
  })
  afterEach(async () => {
    await env.cleanup()
  })

  test('returns the parsed JSON body of a matched route', async () => {
    const data = (await callApi('GET', '/api/decks')) as { decks: { slug: string }[] }
    expect(data.decks.map((d) => d.slug)).toContain('test-deck')
  })

  test('throws a ProtocolError for a 404 from a handler', async () => {
    let thrown: unknown
    try {
      await callApi('GET', '/api/deck/does-not-exist')
    } catch (err) {
      thrown = err
    }
    expect(ProtocolError.isInstance(thrown)).toBe(true)
    expect((thrown as ProtocolError).message.toLowerCase()).toContain('not found')
  })

  test('callApiData strips the constant success envelope', async () => {
    // Every tool result is a handler body minus `success`; the strip lives in one
    // place so no tool echoes a key that is `true` on every body that gets here.
    const data = await callApiData<{ success: true; decks: { slug: string }[] }>(
      'GET',
      '/api/decks',
    )
    expect(Object.keys(data)).not.toContain('success')
    expect(data.decks.map((d) => d.slug)).toContain('test-deck')
  })

  test('callApiData still throws on a 2xx body reporting failure', async () => {
    // The strip must not become a way for a `success: false` body to be handed
    // back as if it were a result.
    let thrown: unknown
    try {
      await callApiData('GET', '/api/deck/does-not-exist')
    } catch (error) {
      thrown = error
    }
    expect(ProtocolError.isInstance(thrown)).toBe(true)
  })

  test('throws a ProtocolError when no route matches', async () => {
    let thrown: unknown
    try {
      await callApi('GET', '/api/not-a-real-route')
    } catch (err) {
      thrown = err
    }
    expect(ProtocolError.isInstance(thrown)).toBe(true)
    expect((thrown as ProtocolError).message).toContain('No admin route')
  })
})

/**
 * The single automatic retry every list mutation runs behind. Pinned here rather
 * than through a tool call: the interesting property is how many attempts run
 * for a given failure, which a real concurrent editor cannot be made to produce
 * deterministically.
 */
describe('withConflictRetry', () => {
  test('does not retry a call that succeeds', async () => {
    let attempts = 0
    const result = await withConflictRetry(() => {
      attempts++
      return Promise.resolve('ok')
    })
    expect(result).toBe('ok')
    expect(attempts).toBe(1)
  })

  test('retries once after a conflict and returns the second attempt', async () => {
    let attempts = 0
    const result = await withConflictRetry(() => {
      attempts++
      if (attempts === 1) return Promise.reject(apiErrorToMcp(409, { message: 'modified' }))
      return Promise.resolve('ok')
    })
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })

  test('propagates a second conflict rather than retrying forever', async () => {
    // Two losses in a row mean a live concurrent editor; retrying past that
    // would let the agent overwrite work it never saw.
    let attempts = 0
    let thrown: unknown
    try {
      await withConflictRetry(() => {
        attempts++
        return Promise.reject(apiErrorToMcp(409, { message: 'modified' }))
      })
    } catch (error) {
      thrown = error
    }
    expect(attempts).toBe(2)
    expect(isConflictError(thrown)).toBe(true)
  })

  // The `-32012` code is internal by SDK design: `tools/call` catches every
  // in-tool ProtocolError and returns an `isError` text result, discarding the
  // numeric code. What a client actually sees is this payload — so this is the
  // conflict contract, and the code below it is only the retry signal.
  test('a surviving conflict becomes a structured conflict result', async () => {
    const result = await runTool(() =>
      withConflictRetry(() => Promise.reject(apiErrorToMcp(409, { message: 'modified' }))),
    )
    expect(result.isError).toBe(true)
    const payload = result.structuredContent as ToolErrorPayload
    expect(payload).toEqual({
      error: true,
      code: 'conflict',
      message: 'modified',
      conflict: true,
      recovery: 'Re-read the list with get_list, then re-apply your change.',
    })
    // The one-line text a client without structured-output support shows.
    expect(result.content).toEqual([{ type: 'text', text: 'modified' }])
  })

  test('an unmatched-batch rejection carries its per-change list', async () => {
    const detail: McpErrorDetail = { unmatched: ['Remove Ghost Card (no-target)'] }
    const result = await runTool(() =>
      Promise.reject(
        new ProtocolError(ProtocolErrorCode.InvalidParams, 'Nothing was saved.', detail),
      ),
    )
    const payload = toolError(result)
    expect(payload.code).toBe('invalid-request')
    expect(payload.unmatched).toEqual(['Remove Ghost Card (no-target)'])
  })

  // The one error `runTool` must NOT swallow: it is a protocol handshake the SDK
  // re-raises to the client, and turning it into an `isError` result would strand
  // the elicitation with nothing waiting on the other side.
  test('re-throws an elicitation request instead of structuring it', async () => {
    const elicitation = new ProtocolError(
      ProtocolErrorCode.UrlElicitationRequired,
      'authorize at https://example.test',
    )
    let thrown: unknown
    try {
      await runTool(() => Promise.reject(elicitation))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(elicitation)
  })

  test('never retries a failure that is not a conflict', async () => {
    let attempts = 0
    let thrown: unknown
    try {
      await withConflictRetry(() => {
        attempts++
        return Promise.reject(apiErrorToMcp(400, { message: 'nothing matched' }))
      })
    } catch (error) {
      thrown = error
    }
    expect(attempts).toBe(1)
    expect((thrown as ProtocolError).code).toBe(ProtocolErrorCode.InvalidParams)
  })
})
