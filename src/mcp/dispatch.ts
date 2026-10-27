import { dispatchRoute, type RequestContext } from '../admin/server'
import type { BuildClaim } from '../admin/api/build-site'
import type { HttpMethod } from '../util/routing'
import { buildSyntheticRequest } from '../util/synthetic-request'
import { apiErrorToMcp, parseUnmatched, type ApiErrorBody, type McpErrorDetail } from './errors'
import type { OmitSuccess } from './types'
import type { RouteProgressSink } from '../util/progress'
import { isRecord } from '../util/json'

/**
 * Synthetic request context for in-process calls. The MCP server is a local,
 * trusted process the user launched themselves, so authentication is bypassed —
 * {@link dispatchRoute} performs no auth, IP filtering, or session checks.
 */
const MCP_CONTEXT: RequestContext = { clientIp: 'mcp', sessionToken: null }

/** Origin for synthetic request URLs. Nothing leaves the process, so the host is arbitrary. */
const SYNTHETIC_ORIGIN = 'http://ritual-mcp'

/**
 * The error fields of a refusal body. A body that is not an object carries
 * none, so {@link apiErrorToMcp} supplies its one "Admin request failed"
 * sentence.
 */
function errorBody(data: unknown): ApiErrorBody {
  if (!isRecord(data)) return {}
  return {
    message: typeof data.message === 'string' ? data.message : undefined,
    conflict: data.conflict === true,
  }
}

/**
 * The structured detail a refusal body carries for the tool wrapper: the save
 * routes' per-change `unmatched` list, when the batch was refused as a whole.
 * Exported for its unit test: no real route sends a malformed `unmatched`.
 */
export function errorDetail(data: unknown): McpErrorDetail | undefined {
  const unmatched = parseUnmatched(data)
  return unmatched === undefined ? undefined : { unmatched }
}

/**
 * Invoke an admin API route in-process and return its parsed JSON body. The HTTP
 * socket, auth, and IP filtering are all bypassed; the same route handlers that
 * back the web admin run directly here (see {@link dispatchRoute}). A non-2xx
 * response, a `{ success: false }` body, or an unmatched route is thrown as an
 * {@link import('@modelcontextprotocol/server').ProtocolError} so the calling
 * tool surfaces it as an `isError` result rather than a silent failure.
 */
export async function callApi(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: CallApiOptions,
): Promise<unknown> {
  const req = buildSyntheticRequest(SYNTHETIC_ORIGIN, method, path, body)

  const dispatched = await dispatchRoute(req, callContext(options))
  if (!dispatched.matched) {
    // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
    throw apiErrorToMcp(404, { message: `No admin route for ${method} ${path}` })
  }
  const response = dispatched.response

  const text = await response.text()
  let data: unknown = null
  if (text.length > 0) {
    try {
      data = JSON.parse(text)
    } catch {
      // A handler returned a non-JSON body (e.g. a bare-text error response);
      // keep the documented contract of throwing a ProtocolError.
      throw apiErrorToMcp(502, {
        // i18n-exempt: a transport error addressed to the agent, English by contract like the tool descriptions
        message: `Admin route ${method} ${path} returned a non-JSON body (HTTP ${response.status}).`,
      })
    }
  }

  if (!response.ok) {
    throw apiErrorToMcp(response.status, errorBody(data), errorDetail(data))
  }
  // A few handlers report failure with a 2xx + `success: false`; treat those as
  // client errors so they still surface as tool errors instead of "succeeding".
  if (isRecord(data) && data.success === false) {
    throw apiErrorToMcp(response.status === 200 ? 400 : response.status, errorBody(data))
  }
  return data
}

/** Per-call extras the in-process dispatcher forwards to the route handler. */
export interface CallApiOptions {
  /** Where the handler reports progress; omit when the caller wants none. */
  onProgress?: RouteProgressSink
  /** Cancels the call when the client cancelled the tool request. */
  signal?: AbortSignal
  /** A build slot already claimed for this call (see `RequestContext.buildClaim`). */
  buildClaim?: BuildClaim
}

/**
 * The context for one in-process call: the shared constant when the caller wants
 * nothing extra (the overwhelmingly common case), a fresh object otherwise.
 *
 * The extras are copied by name rather than spread. `CallApiOptions` and
 * `RequestContext` are separate types that happen to overlap here, and a spread
 * would silently forward any future `CallApiOptions` field into the request
 * context — including one that shadows `clientIp` or `sessionToken`.
 */
function callContext(options?: CallApiOptions): RequestContext {
  if (!options) return MCP_CONTEXT
  const { onProgress, signal, buildClaim } = options
  if (onProgress === undefined && signal === undefined && buildClaim === undefined) {
    return MCP_CONTEXT
  }
  return { ...MCP_CONTEXT, onProgress, signal, buildClaim }
}

/** The envelope key every admin body carries, and the only one a tool strips. */
type SuccessEnvelope = { success?: unknown }

/**
 * {@link callApi} for the common case: a handler body that is the tool's result
 * once the `success` envelope is off.
 *
 * The key is a constant on every body that gets this far — `callApi` throws on a
 * non-2xx *and* on a 2xx carrying `success: false` — so echoing it would tell an
 * agent nothing and cost a field on every one of two dozen tools. The strip used
 * to be written out at each of those call sites, one `const { success: _success,
 * ...rest }` at a time; one place is one place for the reasoning to live, and
 * {@link OmitSuccess} keeps the returned type honest.
 */
export async function callApiData<T extends object>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options?: CallApiOptions,
): Promise<OmitSuccess<T>> {
  const data = (await callApi(method, path, body, options)) as T & SuccessEnvelope
  const { success: _success, ...rest } = data
  return rest as OmitSuccess<T>
}
