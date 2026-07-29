import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'
import { CONFLICT_ERROR_CODE } from './error-codes'

/**
 * Structured detail Ritual attaches to a thrown `ProtocolError`.
 *
 * Ritual's own `runTool` is what turns a thrown error into an `isError` tool
 * result (see `result.ts`); the SDK never sees it. That wrapper reads this
 * detail off the error on the way past, so a rejected batch can be reported as a
 * structured `unmatched` list rather than only inside a sentence.
 */
export interface McpErrorDetail {
  /** Per-change descriptions of an all-or-nothing batch that was rejected. */
  unmatched?: string[]
}

/**
 * Read the {@link McpErrorDetail} off a thrown error, if it carries one.
 *
 * `ProtocolError.data` is `unknown` — it can hold anything a thrower or an
 * upstream transport put there — so this is a parser, not a cast: a `data` that
 * is not an object, or whose `unmatched` is not an array of strings, yields
 * nothing rather than a payload whose `unmatched` would not survive being
 * rendered.
 */
export function mcpErrorDetail(error: unknown): McpErrorDetail | undefined {
  if (!ProtocolError.isInstance(error)) return undefined
  const { data } = error
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const { unmatched } = data as Record<string, unknown>
  if (unmatched === undefined) return {}
  if (!Array.isArray(unmatched) || unmatched.some((item) => typeof item !== 'string')) {
    return undefined
  }
  return { unmatched: unmatched as string[] }
}

/** Error fields the admin handlers include in their non-OK JSON responses. */
export interface ApiErrorBody {
  message?: string
  /** Set by `validateContentHash` when the file changed under the caller. */
  conflict?: boolean
}

/**
 * Translate an admin HTTP status + error body into a {@link ProtocolError}.
 *
 * A lost optimistic-concurrency race gets its own code: nothing about the call
 * was malformed, and the useful response is to re-read and retry rather than to
 * fix an argument, which is exactly what `InvalidParams` would have told the
 * agent to do. Other client errors (400/404) stay `InvalidParams`; everything
 * else is `InternalError`.
 *
 * A thrown `ProtocolError` inside a tool body is caught by Ritual's own
 * `runTool` and surfaced as an `isError` tool result carrying this message, so
 * the text is the agent-facing explanation. `detail` rides along as the error's
 * structured data for the same wrapper to read back — a caller that has detail
 * to attach passes it here rather than reconstructing the error itself.
 */
export function apiErrorToMcp(
  status: number,
  body: ApiErrorBody,
  detail?: McpErrorDetail,
): ProtocolError {
  const message = body.message ?? `Admin request failed (HTTP ${status})`
  if (body.conflict === true || status === 409) {
    return new ProtocolError(CONFLICT_ERROR_CODE, message, detail)
  }
  const code =
    status === 400 || status === 404
      ? ProtocolErrorCode.InvalidParams
      : ProtocolErrorCode.InternalError
  return new ProtocolError(code, message, detail)
}

/** True when the error is a lost optimistic-concurrency race, not a bad request. */
export function isConflictError(error: unknown): boolean {
  return ProtocolError.isInstance(error) && error.code === CONFLICT_ERROR_CODE
}
