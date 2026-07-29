import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'

/** Error fields the admin handlers include in their non-OK JSON responses. */
export interface ApiErrorBody {
  message?: string
  conflict?: boolean
}

/**
 * Translate an admin HTTP status + error body into a {@link ProtocolError}. Client
 * errors (400/404/409) map to `InvalidParams` so the agent learns the call was
 * malformed or the target is gone/stale; everything else maps to `InternalError`.
 * A thrown `ProtocolError` inside a tool handler is surfaced by the SDK as an
 * `isError` tool result carrying this message, so the text is the agent-facing
 * explanation.
 */
export function apiErrorToMcp(status: number, body: ApiErrorBody): ProtocolError {
  const message = body.message ?? `Admin request failed (HTTP ${status})`
  const code =
    status === 400 || status === 404 || status === 409
      ? ProtocolErrorCode.InvalidParams
      : ProtocolErrorCode.InternalError
  return new ProtocolError(code, message)
}
