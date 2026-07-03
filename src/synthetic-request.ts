export type SyntheticRequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

/**
 * Build a synthetic {@link Request} for invoking an admin route handler
 * in-process (no HTTP socket): the MCP dispatch layer and the change-bundle
 * import engine both drive the admin API this way. A JSON body is attached
 * with the matching content type when given; the origin is arbitrary since
 * nothing leaves the process.
 */
export function buildSyntheticRequest(
  origin: string,
  method: SyntheticRequestMethod,
  path: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(`${origin}${path}`, init)
}
