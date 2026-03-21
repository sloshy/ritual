import path from 'node:path'
import { adminUserExists } from './auth'
import { loadConfig } from './config'
import { parseSessionCookie, validateSession } from './session'
import { handleStatus, handleListDecks } from './api/status'
import { handleImportDeck } from './api/import-deck'
import { handleBuildSite } from './api/build-site'
import { handleCacheRefresh, handleCacheRefreshStream } from './api/cache'
import { handleArchidektLogin } from './api/login'
import { handleGetConfig, handleUpdateConfig } from './api/config'
import { handleSetup } from './api/setup'
import { handleSearchCards } from './api/search-cards'
import {
  handleTotpSetup,
  handleTotpVerifySetup,
  handleTotpDisable,
  handleTotpStatus,
} from './api/totp'
import { handleLogin, handleLogout } from './api/auth-login'
import { handleGetAuditLog } from './api/audit'
import { handleAutocomplete } from './api/autocomplete'
import { handleDeckLoad } from './api/deck-load'
import { handleCardPrintings } from './api/card-printings'
import { handleCardPrice } from './api/card-price'
import { handleDeckSave } from './api/deck-save'
import { handleDeckCreate } from './api/deck-create'
import { handleDeckRename } from './api/deck-rename'
import { handleDeckDelete } from './api/deck-delete'
import { handleListCollections } from './api/collection-list'
import { handleCollectionLoad } from './api/collection-load'
import { handleCollectionSave } from './api/collection-save'
import { handleListWantedLists } from './api/wanted-list'
import { handleWantedListLoad } from './api/wanted-load'
import { handleWantedListSave } from './api/wanted-save'

interface AdminServerOptions {
  port: number
  host: string
  distDir: string
}

type RouteHandler = (req: Request, context: RequestContext) => Promise<Response>

interface RequestContext {
  clientIp: string
  sessionToken: string | null
}

type SocketAddress = { address: string }
type RequestIPServer = { requestIP?: (req: Request) => SocketAddress | null }

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

interface Route {
  method: HttpMethod
  path: string
  handler: RouteHandler
  requiresAuth: boolean
}

const routes: Route[] = [
  { method: 'GET', path: '/api/status', handler: handleStatus, requiresAuth: false },
  { method: 'POST', path: '/api/setup', handler: handleSetup, requiresAuth: false },
  {
    method: 'POST',
    path: '/api/login',
    handler: (req, ctx) => handleLogin(req, ctx.clientIp),
    requiresAuth: false,
  },
  {
    method: 'POST',
    path: '/api/logout',
    handler: (_req, ctx) => handleLogout(ctx.sessionToken ?? ''),
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/decks', handler: handleListDecks, requiresAuth: true },
  { method: 'POST', path: '/api/import-deck', handler: handleImportDeck, requiresAuth: true },
  { method: 'POST', path: '/api/build-site', handler: handleBuildSite, requiresAuth: true },
  {
    method: 'GET',
    path: '/api/cache/refresh/stream',
    handler: handleCacheRefreshStream,
    requiresAuth: true,
  },
  { method: 'POST', path: '/api/cache/refresh', handler: handleCacheRefresh, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/login/archidekt',
    handler: handleArchidektLogin,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/config', handler: handleGetConfig, requiresAuth: true },
  { method: 'PUT', path: '/api/config', handler: handleUpdateConfig, requiresAuth: true },
  { method: 'POST', path: '/api/search-cards', handler: handleSearchCards, requiresAuth: true },
  { method: 'POST', path: '/api/totp/setup', handler: handleTotpSetup, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/totp/verify-setup',
    handler: handleTotpVerifySetup,
    requiresAuth: true,
  },
  { method: 'POST', path: '/api/totp/disable', handler: handleTotpDisable, requiresAuth: true },
  { method: 'GET', path: '/api/totp/status', handler: handleTotpStatus, requiresAuth: true },
  { method: 'GET', path: '/api/audit-log', handler: handleGetAuditLog, requiresAuth: true },
  { method: 'GET', path: '/api/autocomplete', handler: handleAutocomplete, requiresAuth: true },
  { method: 'GET', path: '/api/card-printings', handler: handleCardPrintings, requiresAuth: true },
  { method: 'GET', path: '/api/card-price', handler: handleCardPrice, requiresAuth: true },
  { method: 'GET', path: '/api/collections', handler: handleListCollections, requiresAuth: true },
  {
    method: 'GET',
    path: '/api/collection/:slug',
    handler: handleCollectionLoad,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/collection/:slug/save',
    handler: handleCollectionSave,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/deck/:slug', handler: handleDeckLoad, requiresAuth: true },
  { method: 'POST', path: '/api/deck/create', handler: handleDeckCreate, requiresAuth: true },
  { method: 'POST', path: '/api/deck/:slug/save', handler: handleDeckSave, requiresAuth: true },
  { method: 'POST', path: '/api/deck/:slug/rename', handler: handleDeckRename, requiresAuth: true },
  { method: 'DELETE', path: '/api/deck/:slug', handler: handleDeckDelete, requiresAuth: true },
  {
    method: 'GET',
    path: '/api/wanted',
    handler: handleListWantedLists,
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/wanted/:slug',
    handler: handleWantedListLoad,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/wanted/:slug/save',
    handler: handleWantedListSave,
    requiresAuth: true,
  },
]

export function getClientIp(req: Request, server: RequestIPServer, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers.get('X-Forwarded-For')
    if (forwarded) {
      // Trust the rightmost entry (appended by the reverse proxy),
      // not the leftmost (which is client-controlled)
      const parts = forwarded.split(',')
      const last = parts[parts.length - 1]?.trim()
      if (last) return last
    }
  }
  if (server.requestIP) {
    const ip = server.requestIP(req)
    if (ip) return ip.address
  }
  return 'unknown'
}

export function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.startsWith('*') && pattern.endsWith('*')) {
    return value.toLowerCase().includes(pattern.slice(1, -1).toLowerCase())
  }
  if (pattern.startsWith('*')) {
    return value.toLowerCase().endsWith(pattern.slice(1).toLowerCase())
  }
  if (pattern.endsWith('*')) {
    return value.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
  }
  return value.toLowerCase() === pattern.toLowerCase()
}

export function matchesList(value: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(value, p))
}

function matchRoute(routePath: string, requestPath: string): boolean {
  if (routePath === requestPath) return true
  const routeParts = routePath.split('/')
  const requestParts = requestPath.split('/')
  if (routeParts.length !== requestParts.length) return false
  return routeParts.every((part, i) => part.startsWith(':') || part === requestParts[i])
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function handleRequest(
  req: Request,
  server: RequestIPServer,
  distDir: string,
): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method

  // Load config first — needed for trustProxy and filtering
  const config = await loadConfig()
  const clientIp = getClientIp(req, server, config.trustProxy)
  const userAgent = req.headers.get('User-Agent') ?? ''

  // IP and User-Agent filtering
  if (config.ipDenyList.length > 0 && matchesList(clientIp, config.ipDenyList)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (config.ipAllowList.length > 0 && !matchesList(clientIp, config.ipAllowList)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (config.userAgentDenyList.length > 0 && matchesList(userAgent, config.userAgentDenyList)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (config.userAgentAllowList.length > 0 && !matchesList(userAgent, config.userAgentAllowList)) {
    return new Response('Forbidden', { status: 403 })
  }

  // Match API routes
  const route = routes.find((r) => r.method === method && matchRoute(r.path, url.pathname))
  const sessionToken = parseSessionCookie(req.headers.get('Cookie'))

  if (route) {
    if (route.requiresAuth) {
      const hasAdmin = await adminUserExists()
      if (!hasAdmin) {
        return Response.json(
          { error: 'Setup required. Create an admin account first.' },
          { status: 403 },
        )
      }

      // Session-based auth: validate the session cookie
      if (!sessionToken || !validateSession(sessionToken)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const context: RequestContext = { clientIp, sessionToken }
    return route.handler(req, context)
  }

  // Serve static SPA files
  const filePath = path.join(distDir, url.pathname)
  const file = Bun.file(filePath)
  if (await file.exists()) {
    return new Response(file)
  }

  // SPA fallback
  const indexFile = Bun.file(path.join(distDir, 'index.html'))
  if (await indexFile.exists()) {
    return new Response(indexFile)
  }

  return new Response('Not Found', { status: 404 })
}

export function startAdminServer(options: AdminServerOptions): void {
  const { port, host, distDir } = options

  const server = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const response = await handleRequest(req, server, distDir)
      return withSecurityHeaders(response)
    },
    error(error) {
      console.error('Unhandled server error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    },
  })

  console.log(`Ritual Admin running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)
}
