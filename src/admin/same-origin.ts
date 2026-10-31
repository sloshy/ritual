/**
 * The admin server's cross-site request check: an API request a browser sent
 * from another site is refused before any route runs.
 *
 * The session cookie is `SameSite=Strict`, which already keeps a browser from
 * attaching it to a cross-site request. This check is the second line under it:
 * it also covers the routes that need no session (`/api/setup`, `/api/login`,
 * whose forgery would claim a fresh admin or sign the browser into another
 * account), a browser that ignores `SameSite`, and a *same-site* sibling (another
 * port or subdomain of the same host), which `SameSite` lets through.
 *
 * It applies to every `/api/*` request, whatever the method: a few `GET` routes
 * act as well as read — the sync, cache-refresh and build streams run what
 * their query asks for — so "only writes" would leave them open to an
 * `EventSource` from a sibling site. The admin page's own requests are all
 * same-origin, so they always pass.
 *
 * The browser says where a request came from, in two headers:
 *
 * - `Sec-Fetch-Site` (every current browser) is decided by the browser itself,
 *   so it holds behind a reverse proxy whatever host the proxy forwards: only
 *   `same-origin`, and `none` (a request the user made directly, such as a
 *   typed or bookmarked address), pass.
 * - Otherwise `Origin`, which a browser sends on every cross-origin request and
 *   on every `POST`: its host must be the one the request was addressed to —
 *   the `Host` header, or the proxy's `X-Forwarded-Host` when
 *   `admin.trustProxy` is on. Only the host is compared, not the scheme,
 *   because a proxy that terminates HTTPS forwards plain HTTP, and a default
 *   port (`:80`, `:443`) counts as no port. Behind a proxy that rewrites `Host`
 *   without `trustProxy`, an older browser's writes are refused here.
 *
 * A request with neither header did not come from a browser (a script, `curl`),
 * and cross-site request forgery needs a victim's browser, so it passes; it
 * still needs the session cookie for any route that requires one. The MCP
 * server never comes this way: it calls the route handlers in-process.
 */

import { lastForwarded } from './forwarded'

/** The `Sec-Fetch-Site` values a request is accepted from. */
const ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(['same-origin', 'none'])

/** A `name[:port]` host, lowercased, with a default port (`:80`, `:443`) dropped; null when empty. */
function normalizedHost(host: string): string | null {
  const lowered = host
    .trim()
    .toLowerCase()
    .replace(/:(80|443)$/, '')
  return lowered === '' ? null : lowered
}

/** The host the request was addressed to, or null when it names none. */
function requestHost(req: Request, trustProxy: boolean): string | null {
  const forwarded = trustProxy ? lastForwarded(req.headers.get('X-Forwarded-Host')) : null
  return normalizedHost(forwarded ?? req.headers.get('Host') ?? new URL(req.url).host)
}

/** The host of an `Origin` header value, or null for `null` or a malformed value. */
function originHost(origin: string): string | null {
  try {
    return normalizedHost(new URL(origin).host)
  } catch {
    return null
  }
}

/**
 * Whether `req` is a request a browser sent from another site (see the module
 * comment for the rule). `trustProxy` is `admin.trustProxy`.
 */
export function isCrossSiteRequest(req: Request, trustProxy: boolean): boolean {
  const fetchSite = req.headers.get('Sec-Fetch-Site')
  if (fetchSite !== null) return !ALLOWED_FETCH_SITES.has(fetchSite.trim().toLowerCase())
  const origin = req.headers.get('Origin')
  if (origin === null) return false
  const from = originHost(origin)
  return from === null || from !== requestHost(req, trustProxy)
}
