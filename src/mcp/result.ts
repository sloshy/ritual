import type { CallToolResult } from '@modelcontextprotocol/server'

/** Wrap JSON-serializable data as a single pretty-printed text content block. */
export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

/** Wrap a short human-readable message as a text content block. */
export function textResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }] }
}
