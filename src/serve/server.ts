import { matchRoute } from '../util/routing'
import { serveSiteFile, type StaticSiteServer } from './static'
import { createLiveSiteData } from './live-data'
import { buildSiteRoutes } from './routes'
import { apiError, MAX_BODY_SIZE, notFoundResponse } from '../api/http'
import { apiMessage } from '../api/result'
import { t } from '../i18n/t'
import { MAX_QUOTE_BODY_BYTES } from '../api/buylist'
import { MAX_PRICE_BODY_BYTES } from '../api/card-prices'

/**
 * The hard ceiling on a request body (`maxRequestBodySize`). The runtime refuses
 * a larger declared body before any handler runs, and a chunked one as it is
 * read (a body nothing reads is never buffered at all). These routes are
 * unauthenticated, so the ceiling is the largest route's own budget plus only
 * enough headroom that the route, not the runtime, answers a body just past its
 * budget — with its JSON refusal rather than an empty 413.
 */
export const MAX_SITE_REQUEST_BODY_SIZE =
  Math.max(MAX_BODY_SIZE, MAX_QUOTE_BODY_BYTES, MAX_PRICE_BODY_BYTES) + 16 * 1024

export type SiteServerOptions = {
  port: number
  hostname: string
  distDir: string
}

/**
 * All matched routes serve public JSON (no cookies, no auth), so a wildcard
 * origin is safe and lets a CDN-deployed static site call a separately hosted
 * API instance cross-origin.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Deliberately not the admin CSP: the public site loads remote Scryfall assets.
// Its theme and locale bootstrap is an external, same-origin `boot.js`, so a
// `script-src 'self'` policy would be satisfiable here — the image sources are
// what still are not.
const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

function withHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(extra)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The hosted public-site server: static dist/ assets plus a live, read-only,
 * unauthenticated data API (live list JSON + cache-backed card queries).
 * Request pipeline: CORS preflight → route match → `/api/*` 404 (never the SPA
 * fallback) → static file → SPA fallback.
 */
export function startSiteServer(options: SiteServerOptions): StaticSiteServer {
  const { port, hostname, distDir } = options
  const live = createLiveSiteData({ distDir })
  const routes = buildSiteRoutes(live, distDir)

  return Bun.serve({
    port,
    hostname,
    maxRequestBodySize: MAX_SITE_REQUEST_BODY_SIZE,
    async fetch(req) {
      const url = new URL(req.url)

      if (req.method === 'OPTIONS' && routes.some((r) => matchRoute(r.path, url.pathname))) {
        return new Response(null, { status: 204, headers: { ...BASE_HEADERS, ...CORS_HEADERS } })
      }

      const route = routes.find((r) => r.method === req.method && matchRoute(r.path, url.pathname))
      if (route) {
        const response = await route.handler(req)
        return withHeaders(response, { ...BASE_HEADERS, ...CORS_HEADERS })
      }

      if (url.pathname.startsWith('/api/')) {
        return withHeaders(notFoundResponse(), {
          ...BASE_HEADERS,
          ...CORS_HEADERS,
        })
      }

      return withHeaders(await serveSiteFile(distDir, url.pathname), BASE_HEADERS)
    },
    error(error) {
      console.error(t('cli.serve.serverError'), error)
      return apiError(apiMessage('admin.api.server.internalError'), 500)
    },
  })
}
