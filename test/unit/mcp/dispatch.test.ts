import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { callApi } from '../../../src/mcp/dispatch'
import { apiErrorToMcp } from '../../../src/mcp/errors'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

describe('apiErrorToMcp', () => {
  test('maps client-error statuses to InvalidParams and keeps the message', () => {
    for (const status of [400, 404, 409]) {
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
