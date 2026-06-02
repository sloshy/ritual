import { dispatchRoute, type HttpMethod, type RequestContext } from '../admin/server'
import { apiErrorToMcp, type ApiErrorBody } from './errors'

/**
 * Synthetic request context for in-process calls. The MCP server is a local,
 * trusted process the user launched themselves, so authentication is bypassed —
 * {@link dispatchRoute} performs no auth, IP filtering, or session checks.
 */
const MCP_CONTEXT: RequestContext = { clientIp: 'mcp', sessionToken: null }

/** Origin for synthetic request URLs. Nothing leaves the process, so the host is arbitrary. */
const SYNTHETIC_ORIGIN = 'http://ritual-mcp'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorBody(data: unknown, status: number): ApiErrorBody {
  if (isRecord(data)) {
    return {
      message: typeof data.message === 'string' ? data.message : undefined,
      conflict: data.conflict === true,
    }
  }
  return { message: `Admin request failed (HTTP ${status})` }
}

/**
 * Invoke an admin API route in-process and return its parsed JSON body. The HTTP
 * socket, auth, and IP filtering are all bypassed; the same route handlers that
 * back the web admin run directly here (see {@link dispatchRoute}). A non-2xx
 * response, a `{ success: false }` body, or an unmatched route is thrown as an
 * {@link import('@modelcontextprotocol/sdk/types.js').McpError} so the calling
 * tool surfaces it as an `isError` result rather than a silent failure.
 */
export async function callApi(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const req = new Request(`${SYNTHETIC_ORIGIN}${path}`, init)

  const dispatched = await dispatchRoute(req, MCP_CONTEXT)
  if (!dispatched.matched) {
    throw apiErrorToMcp(404, { message: `No admin route for ${method} ${path}` })
  }
  const response = dispatched.response

  const text = await response.text()
  const data: unknown = text.length > 0 ? JSON.parse(text) : null

  if (!response.ok) {
    throw apiErrorToMcp(response.status, errorBody(data, response.status))
  }
  // A few handlers report failure with a 2xx + `success: false`; treat those as
  // client errors so they still surface as tool errors instead of "succeeding".
  if (isRecord(data) && data.success === false) {
    throw apiErrorToMcp(response.status === 200 ? 400 : response.status, errorBody(data, 400))
  }
  return data
}
