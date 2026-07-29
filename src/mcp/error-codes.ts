import { ProtocolErrorCode } from '@modelcontextprotocol/server'

/**
 * Ritual's own JSON-RPC error codes, in one place.
 *
 * MCP 2026-07-28 reserves `-32020..-32099` for the spec and grandfathers
 * existing SDK codes inside `-32000..-32019` (the SDK owns e.g. `-32002` for
 * resource-not-found there), so Ritual's codes must sit in that implementation
 * band *and* avoid the SDK's own. {@link NotProtocolCode} turns a future
 * collision into a compile error.
 */

/** Rejects any code the SDK's `ProtocolErrorCode` enum already claims. */
export type NotProtocolCode<C extends number> = C extends ProtocolErrorCode ? never : C

/** The HTTP wrapper rejected the request before the transport saw it: no token. */
export const UNAUTHORIZED_ERROR_CODE = -32_010 satisfies NotProtocolCode<-32_010>

/** The HTTP wrapper rejected the request before the transport saw it: wrong path. */
export const NOT_FOUND_ERROR_CODE = -32_011 satisfies NotProtocolCode<-32_011>

/**
 * A list changed under the caller, so the write was rejected to protect the
 * other edit. Distinct from `InvalidParams` on purpose: nothing about the call
 * was wrong, and the right response is to re-read and retry rather than to fix
 * an argument.
 *
 * **Internal only — this code never reaches the wire.** It is raised inside a
 * tool body and caught by `runTool`, which converts it into an `isError` result
 * whose structured payload carries `code: "conflict"`; the numeric code is spent
 * on the way and no client ever sees it. It lives in this registry all the same,
 * because it has to stay out of the SDK's band and out of the two codes below.
 * Consequently it is deliberately **not** part of {@link RitualWireErrorCode}.
 */
export const CONFLICT_ERROR_CODE = -32_012 satisfies NotProtocolCode<-32_012>

/**
 * The codes Ritual itself puts in a JSON-RPC error body.
 *
 * Both are raised by the HTTP wrapper *before* the transport is reached, which
 * is exactly what makes them wire codes: there is no tool result to fold them
 * into. `CONFLICT_ERROR_CODE` is not one of them (see its own note).
 */
export type RitualWireErrorCode = typeof UNAUTHORIZED_ERROR_CODE | typeof NOT_FOUND_ERROR_CODE
