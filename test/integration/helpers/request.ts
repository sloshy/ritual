/**
 * Request-building helpers for admin handler suites.
 *
 * These are net-new rather than a consolidation — every suite hand-rolled its
 * own `new Request(...)` — and are adopted only in the suites that changed
 * alongside them. A sweep of all sixteen integration suites is deliberately not
 * bundled here; the remaining hand-rolled builders are not an oversight.
 */

/** The HTTP methods the admin routes accept. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/** Build a synthetic admin API request. A body is JSON-encoded with its Content-Type. */
export function apiRequest(method: HttpMethod, path: string, body?: unknown): Request {
  const url = path.startsWith('http') ? path : `http://localhost${path}`
  if (body === undefined) return new Request(url, { method })
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A handler's status paired with its parsed JSON body. */
export interface JsonCall<T> {
  status: number
  body: T
}

/**
 * Call a handler with a synthetic request and parse its JSON body. The status
 * comes back alongside the body so a test can assert both without re-reading
 * the response — a `Response` body may only be consumed once.
 */
export async function callJson<T>(
  handler: (req: Request) => Promise<Response>,
  method: HttpMethod,
  path: string,
  body?: unknown,
): Promise<JsonCall<T>> {
  const resp = await handler(apiRequest(method, path, body))
  return { status: resp.status, body: (await resp.json()) as T }
}
