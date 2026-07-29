import { expect } from 'bun:test'
import type { CallToolResult } from '@modelcontextprotocol/client'

/**
 * Shared helpers for unwrapping the MCP content-block envelope in tests.
 * Used by the unit suite (in-memory transport) and both transport integration
 * suites, so the envelope shape is asserted in exactly one place.
 */

/** First text block of a tool result — the standard content-envelope unwrap. */
export function firstText(result: CallToolResult): string {
  const block = result.content[0]
  return block && block.type === 'text' ? block.text : ''
}

/** Parse the first text block of a tool result as JSON. */
export function toolJson(result: CallToolResult): unknown {
  return JSON.parse(firstText(result))
}

/**
 * Assert a call was rejected by the tool's input schema before reaching the
 * handler. The SDK's rejection wording is not contractual, so this pins only
 * what is: the result is an error, and it names the offending field or rule.
 */
export function expectSchemaRejection(result: CallToolResult, offender: RegExp | string): void {
  expect(result.isError).toBe(true)
  if (typeof offender === 'string') {
    expect(firstText(result)).toContain(offender)
  } else {
    expect(firstText(result)).toMatch(offender)
  }
}
