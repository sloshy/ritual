import { expect } from 'bun:test'
import type { CallToolResult } from '@modelcontextprotocol/client'
import type { ToolErrorPayload } from '../src/mcp/result'

/**
 * Shared helpers for unwrapping the MCP tool-result envelope in tests.
 * Used by the unit suite (in-memory transport) and both transport integration
 * suites, so the envelope shape is asserted in exactly one place.
 *
 * Every tool returns `structuredContent`. A success carries **only** that (see
 * `src/mcp/result.ts`), so `toolData` is the normal unwrap; a failure carries
 * the message as a text block *and* the structured payload, and `toolError`
 * asserts the two agree.
 */

/** First text block of a tool result — empty on a success, which carries none. */
export function firstText(result: CallToolResult): string {
  const block = result.content[0]
  return block && block.type === 'text' ? block.text : ''
}

/** The structured half of a successful tool result. Fails the test on an error result. */
export function toolData<T = unknown>(result: CallToolResult): T {
  if (result.isError === true) {
    throw new Error(`Expected a successful tool result, got an error: ${firstText(result)}`)
  }
  expect(result.structuredContent).toBeDefined()
  return result.structuredContent as T
}

/**
 * The structured half of a failure. Asserts `isError`, and that the text block
 * a legacy client would show equals the structured `message` — the one place
 * both halves exist, so the one place they can disagree.
 */
export function toolError(result: CallToolResult): ToolErrorPayload {
  expect(result.isError).toBe(true)
  expect(result.structuredContent).toBeDefined()
  const payload = result.structuredContent as ToolErrorPayload
  expect(payload.error).toBe(true)
  expect(firstText(result)).toBe(payload.message)
  return payload
}

/** A successful result carries no duplicate text block — the structured-only decision. */
export function expectStructuredOnly(result: CallToolResult): void {
  expect(result.isError).toBeUndefined()
  expect(result.content).toEqual([])
  expect(result.structuredContent).toBeDefined()
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
