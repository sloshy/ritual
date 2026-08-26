import { matchRoute } from '../util/routing'
import { serveSpaFallback, serveStaticFile, type StaticSiteServer } from './static'
import { createLiveSiteData } from './live-data'
import { buildSiteRoutes } from './routes'

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
        return withHeaders(Response.json({ error: 'Not found' }, { status: 404 }), {
          ...BASE_HEADERS,
          ...CORS_HEADERS,
        })
      }

      const staticResponse =
        (await serveStaticFile(distDir, url.pathname)) ?? (await serveSpaFallback(distDir))
      return withHeaders(staticResponse ?? new Response('Not Found', { status: 404 }), BASE_HEADERS)
    },
    error(error) {
      console.error('Unhandled server error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    },
  })
}
