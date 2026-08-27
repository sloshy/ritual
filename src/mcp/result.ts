import {
  ProtocolError,
  ProtocolErrorCode,
  fromJsonSchema,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server'
import { getErrorMessage } from '../util/errors'
import { isConflictError, mcpErrorDetail } from './errors'
import { TOOL_OUTPUT_SCHEMAS } from './schema-json'
import type { McpToolName } from './tools/names'

/**
 * How every tool returns.
 *
 * **Success is structured-only.** The SDK's SEP-2106 text auto-append fires only
 * for a *non-object* `structuredContent`, and every Ritual output schema is
 * object-rooted, so no client is ever handed a synthesized text block — writing
 * one ourselves would simply put the same JSON on the wire twice. `content` is
 * therefore an empty array (the key is required by `CallToolResult`, and the SDK
 * stamps it anyway before wire validation).
 *
 * **Failure carries both.** The one-line message costs almost nothing, is what a
 * client without structured-output support shows a user, and the structured
 * {@link ToolErrorPayload} beside it is what an agent branches on. `isError`
 * results are exempt from output-schema validation, which is why the payload is
 * formalized as `TOOL_ERROR_OUTPUT` in `schema-json.ts` rather than being an arm
 * of each tool's own schema.
 */

/**
 * The `outputSchema` a tool advertises, looked up by the name it registers under.
 *
 * Indexing {@link TOOL_OUTPUT_SCHEMAS} rather than naming a constant is what
 * keeps the two in step: the map is keyed by `McpToolName`, so a tool whose
 * schema was never authored is a compile error here as well as there.
 *
 * `T` buys less than it looks like. `fromJsonSchema` cannot infer a type from
 * raw JSON Schema, so `T` is whatever the call site declares, unchecked against
 * the schema this returns — a handler is free to promise a shape the advertised
 * schema would reject. What actually holds name and registration together is a
 * runtime pin: `output-schemas.test.ts`'s "every tool advertises the schema this
 * module authored, byte for byte" reads `tools/list` off a live connection and
 * compares each tool's schema against this map, key set included.
 */
export function outputSchemaFor<T>(name: McpToolName): StandardSchemaWithJSON<T, T> {
  return fromJsonSchema<T>(TOOL_OUTPUT_SCHEMAS[name])
}

/** Why a tool call failed, in the three cases an agent responds to differently. */
export type ToolErrorCode = 'conflict' | 'invalid-request' | 'internal'

/** A tool failure, as the structured half of an `isError` result. */
export interface ToolErrorPayload {
  error: true
  code: ToolErrorCode
  message: string
  /** Only on `code: 'conflict'` — a lost optimistic-concurrency race, after the one retry. */
  conflict?: true
  /** The next action, when there is a concrete one. */
  recovery?: string
  /** Changes that did not apply, when an all-or-nothing batch was rejected. */
  unmatched?: string[]
}

const CONFLICT_RECOVERY = 'Re-read the list with get_list, then re-apply your change.'

/** The single success wrapper: structured only, no duplicate text block. */
export function structuredResult<T extends object>(data: T): CallToolResult {
  return { content: [], structuredContent: data }
}

/** The single failure wrapper: message as text, payload as `structuredContent`. */
export function structuredError(payload: ToolErrorPayload): CallToolResult {
  return {
    content: [{ type: 'text', text: payload.message }],
    structuredContent: payload,
    isError: true,
  }
}

/** Classify a thrown error into the payload a client branches on. */
export function toToolErrorPayload(error: unknown): ToolErrorPayload {
  const message = getErrorMessage(error)
  if (isConflictError(error)) {
    return {
      error: true,
      code: 'conflict',
      message,
      conflict: true,
      recovery: CONFLICT_RECOVERY,
    }
  }
  const invalid = ProtocolError.isInstance(error) && error.code === ProtocolErrorCode.InvalidParams
  const payload: ToolErrorPayload = {
    error: true,
    code: invalid ? 'invalid-request' : 'internal',
    message,
  }
  const detail = mcpErrorDetail(error)
  if (detail?.unmatched !== undefined) payload.unmatched = detail.unmatched
  return payload
}

/**
 * Run a tool body, structure its result, and map any thrown error to a
 * structured failure. Every tool callback returns through this — declaring an
 * `outputSchema` while returning a bare result is a *runtime* break with no
 * compile-time signal, so there is exactly one way to return.
 */
export async function runTool<T extends object>(fn: () => Promise<T>): Promise<CallToolResult> {
  try {
    return structuredResult(await fn())
  } catch (error) {
    // The SDK re-throws this one itself; it is a protocol handshake, not a
    // tool failure, and swallowing it would strand the elicitation.
    if (
      ProtocolError.isInstance(error) &&
      error.code === ProtocolErrorCode.UrlElicitationRequired
    ) {
      throw error
    }
    return structuredError(toToolErrorPayload(error))
  }
}
