import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { callApi } from '../../../src/mcp/dispatch'
import { apiErrorToMcp } from '../../../src/mcp/errors'
import { setupRitualTestEnv, type RitualTestEnv } from './harness'

describe('apiErrorToMcp', () => {
  test('maps client-error statuses to InvalidParams and keeps the message', () => {
    for (const status of [400, 404, 409]) {
      const err = apiErrorToMcp(status, { message: `boom ${status}` })
      expect(err).toBeInstanceOf(McpError)
      expect(err.code).toBe(ErrorCode.InvalidParams)
      expect(err.message).toContain(`boom ${status}`)
    }
  })

  test('maps server errors to InternalError and supplies a fallback message', () => {
    const err = apiErrorToMcp(500, {})
    expect(err.code).toBe(ErrorCode.InternalError)
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

  test('throws an McpError for a 404 from a handler', async () => {
    let thrown: unknown
    try {
      await callApi('GET', '/api/deck/does-not-exist')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(McpError)
    expect((thrown as McpError).message.toLowerCase()).toContain('not found')
  })

  test('throws an McpError when no route matches', async () => {
    let thrown: unknown
    try {
      await callApi('GET', '/api/not-a-real-route')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(McpError)
    expect((thrown as McpError).message).toContain('No admin route')
  })
})
