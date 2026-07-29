import path from 'node:path'
import fs from 'node:fs/promises'
import { isRunningFromSource } from '../runtime'
import { matchRoute, type HttpMethod } from '../routing'
import { adminUserExists } from './auth'
import { loadRitualConfig, getCollectionsDir, getDecksDir, getWantedDir } from '../ritual-config'
import { parseSessionCookie, validateSession } from './session'
import { handleStatus, handleListDecks } from './api/status'
import { handleImportDeck } from './api/import-deck'
import { handleImportCsv } from './api/import-csv'
import { handleImportChanges } from './api/import-changes'
import { handleExport } from './api/export'
import { handleBuildSite } from './api/build-site'
import { handleCacheRefresh, handleCacheRefreshStream, handleCacheStatus } from './api/cache'
import { handleDeckSyncRun, handleDeckSyncStatus, handleDeckSyncStream } from './api/deck-sync'
import {
  handleCollectionSyncRun,
  handleCollectionSyncStatus,
  handleCollectionSyncStream,
} from './api/collection-sync'
import { handleArchidektLogin, handleArchidektStatus } from './api/login'
import { handleGetConfig, handleUpdateConfig } from './api/config'
import { handleSetup } from './api/setup'
import { getBaseDir } from '../base-dir'
import type { RouteProgressSink } from '../progress'
import {
  handleTotpSetup,
  handleTotpVerifySetup,
  handleTotpDisable,
  handleTotpStatus,
} from './api/totp'
import { handleLogin, handleLogout } from './api/auth-login'
import { handleGetAuditLog } from './api/audit'
import { handleAutocomplete } from '../api/autocomplete'
import { handleDeckLoad } from './api/deck-load'
import { handleCardPrintings } from '../api/card-printings'
import { handleCardDetails } from '../api/card-details'
import { handleCardSearch } from '../api/card-search'
import { handleCardPrice } from '../api/card-price'
import { handleDeckSave } from './api/deck-save'
import { handleDeckCreate } from './api/deck-create'
import { handleListCollections } from './api/collection-list'
import { handleCollectionLoad } from './api/collection-load'
import { handleCollectionSave } from './api/collection-save'
import { handleListWantedLists } from './api/wanted-list'
import { handleWantedListLoad } from './api/wanted-load'
import { handleWantedListSave } from './api/wanted-save'
import { handleMoveCommit, handleRemoveCommit, handleSelectedMove } from './api/move'
import { handleCardIndex } from './api/card-index'
import { handleMetadataSave } from './api/metadata'
import { handleLists } from './api/lists'
import { handleDiff } from './api/diff'
import { handleHistoryLoad, handleHistorySave } from './api/history'
import { handlePriceSummary, handlePriceList } from './api/price'
import {
  handleListCreate,
  handleListRename,
  handleListDelete,
  type ListLifecycleConfig,
} from './api/list-lifecycle'
import { resolveDeckFile, resolveFlatListFile } from './api/list-file'

const COLLECTION_CFG: ListLifecycleConfig = {
  kind: 'collection',
  getDir: getCollectionsDir,
  label: 'collection',
  resolveFile: resolveFlatListFile,
}

const WANTED_CFG: ListLifecycleConfig = {
  kind: 'wanted',
  getDir: getWantedDir,
  label: 'wanted list',
  resolveFile: resolveFlatListFile,
}

const DECK_CFG: ListLifecycleConfig = {
  kind: 'deck',
  getDir: getDecksDir,
  label: 'deck',
  resolveFile: resolveDeckFile,
}

interface AdminServerOptions {
  port: number
  host: string
  distDir: string
}

export type RouteHandler = (req: Request, context: RequestContext) => Promise<Response>

export interface RequestContext {
  clientIp: string
  sessionToken: string | null
  /**
   * Progress sink for an IN-PROCESS caller (the MCP adapter). Absent for HTTP
   * requests, which get progress over the feature's SSE route instead.
   *
   * Shaped for a future `io.modelcontextprotocol/tasks` adoption: a task-backed
   * call would drive the same sink from its status updates.
   */
  onProgress?: RouteProgressSink
  /**
   * Cancellation for an in-process caller. Only `POST /api/build-site` honours it
   * today — an aborted sync leaves remote records mutated and an aborted cache
   * refresh holds a lock, so those keep running to completion. Same tasks-ready
   * note as {@link RequestContext.onProgress}.
   */
  signal?: AbortSignal
}

type SocketAddress = { address: string }
type RequestIPServer = { requestIP?: (req: Request) => SocketAddress | null }

export interface Route {
  method: HttpMethod
  path: string
  handler: RouteHandler
  requiresAuth: boolean
}

export const routes: Route[] = [
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
  { method: 'POST', path: '/api/import-csv', handler: handleImportCsv, requiresAuth: true },
  { method: 'POST', path: '/api/import-changes', handler: handleImportChanges, requiresAuth: true },
  { method: 'POST', path: '/api/export', handler: handleExport, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/build-site',
    handler: (_req, ctx) => handleBuildSite(ctx.onProgress, ctx.signal),
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/cache/refresh/stream',
    handler: handleCacheRefreshStream,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/cache/status', handler: handleCacheStatus, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/cache/refresh',
    handler: (_req, ctx) => handleCacheRefresh(ctx.onProgress),
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/deck-sync/stream',
    handler: handleDeckSyncStream,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/deck-sync', handler: handleDeckSyncStatus, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/deck-sync',
    handler: (req, ctx) => handleDeckSyncRun(req, ctx.onProgress),
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/collection-sync/stream',
    handler: handleCollectionSyncStream,
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/collection-sync',
    handler: handleCollectionSyncStatus,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/collection-sync',
    handler: (req, ctx) => handleCollectionSyncRun(req, ctx.onProgress),
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/login/archidekt',
    handler: handleArchidektLogin,
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/login/archidekt',
    handler: handleArchidektStatus,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/config', handler: handleGetConfig, requiresAuth: true },
  { method: 'PUT', path: '/api/config', handler: handleUpdateConfig, requiresAuth: true },
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
  { method: 'GET', path: '/api/card-details', handler: handleCardDetails, requiresAuth: true },
  { method: 'GET', path: '/api/card-search', handler: handleCardSearch, requiresAuth: true },
  { method: 'GET', path: '/api/collections', handler: handleListCollections, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/collection/create',
    handler: (req) => handleListCreate(req, COLLECTION_CFG),
    requiresAuth: true,
  },
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
  {
    method: 'POST',
    path: '/api/collection/:slug/rename',
    handler: (req) => handleListRename(req, COLLECTION_CFG),
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    path: '/api/collection/:slug',
    handler: (req) => handleListDelete(req, COLLECTION_CFG),
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/deck/:slug', handler: handleDeckLoad, requiresAuth: true },
  { method: 'POST', path: '/api/deck/create', handler: handleDeckCreate, requiresAuth: true },
  { method: 'POST', path: '/api/deck/:slug/save', handler: handleDeckSave, requiresAuth: true },
  {
    method: 'POST',
    path: '/api/deck/:slug/rename',
    handler: (req) => handleListRename(req, DECK_CFG),
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    path: '/api/deck/:slug',
    handler: (req) => handleListDelete(req, DECK_CFG),
    requiresAuth: true,
  },
  {
    method: 'GET',
    path: '/api/wanted',
    handler: handleListWantedLists,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/wanted/create',
    handler: (req) => handleListCreate(req, WANTED_CFG),
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
  {
    method: 'POST',
    path: '/api/wanted/:slug/rename',
    handler: (req) => handleListRename(req, WANTED_CFG),
    requiresAuth: true,
  },
  {
    method: 'DELETE',
    path: '/api/wanted/:slug',
    handler: (req) => handleListDelete(req, WANTED_CFG),
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/lists', handler: handleLists, requiresAuth: true },
  { method: 'GET', path: '/api/diff', handler: handleDiff, requiresAuth: true },
  { method: 'GET', path: '/api/card-index', handler: handleCardIndex, requiresAuth: true },
  { method: 'POST', path: '/api/move/commit', handler: handleMoveCommit, requiresAuth: true },
  { method: 'POST', path: '/api/move/selected', handler: handleSelectedMove, requiresAuth: true },
  { method: 'POST', path: '/api/remove/commit', handler: handleRemoveCommit, requiresAuth: true },
  {
    method: 'GET',
    path: '/api/history/:type/:slug',
    handler: handleHistoryLoad,
    requiresAuth: true,
  },
  {
    method: 'POST',
    path: '/api/history/:type/:slug/save',
    handler: handleHistorySave,
    requiresAuth: true,
  },
  {
    method: 'PUT',
    path: '/api/metadata/:type/:slug',
    handler: handleMetadataSave,
    requiresAuth: true,
  },
  { method: 'GET', path: '/api/price/summary', handler: handlePriceSummary, requiresAuth: true },
  {
    method: 'GET',
    path: '/api/price/:type/:slug',
    handler: handlePriceList,
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

/** Outcome of dispatching a request against the in-process route table. */
export type DispatchResult = { matched: true; response: Response } | { matched: false }

/**
 * Match `req` against the API route table and invoke the matching handler with `context`,
 * performing NO authentication, IP/User-Agent filtering, or static-file fallback — those
 * remain in {@link handleRequest}. Shared by the HTTP admin server and the in-process MCP
 * adapter (`src/mcp/dispatch.ts`), which synthesizes requests and trusts the local caller.
 */
export async function dispatchRoute(
  req: Request,
  context: RequestContext,
): Promise<DispatchResult> {
  const url = new URL(req.url)
  const route = routes.find((r) => r.method === req.method && matchRoute(r.path, url.pathname))
  if (!route) return { matched: false }
  return { matched: true, response: await route.handler(req, context) }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://cards.scryfall.io https://svgs.scryfall.io",
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

/**
 * Identifies this server process. Sent to the live-reload client on every SSE (re)connect; the
 * client reloads only when it sees a *different* id — i.e. an actual server restart. Reconnects
 * to the same process (e.g. after an idle-timeout drop) carry the same id and do nothing.
 */
const BOOT_ID = crypto.randomUUID()

/**
 * Dev-only live-reload client (served at `/__dev_reload.js`). An external script rather than
 * inline so it satisfies the `script-src 'self'` CSP. It holds an SSE connection open and reloads
 * the page when the server's boot id changes, so source edits (CSS or TSX) appear after the dev
 * orchestrator restarts the server — without a manual refresh, and without spurious reloads when
 * the connection merely reconnects.
 */
const DEV_RELOAD_CLIENT = `(() => {
  let bootId = null;
  const es = new EventSource('/__dev_reload');
  es.addEventListener('boot', (e) => {
    if (bootId === null) { bootId = e.data; return; }
    if (e.data !== bootId) location.reload();
  });
})();`

/** Serve the live-reload client script or its SSE stream. Only mounted when running from source. */
function handleDevReload(pathname: string): Response {
  if (pathname === '/__dev_reload.js') {
    return new Response(DEV_RELOAD_CLIENT, {
      headers: { 'Content-Type': 'text/javascript;charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  // SSE stream: announce the boot id, then emit keep-alive comments so the connection isn't
  // closed by Bun's idle timeout (which would otherwise churn reconnects). `retry: 1000` makes
  // the browser reconnect promptly after the process exits on restart.
  const encoder = new TextEncoder()
  let keepAlive: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`retry: 1000\nevent: boot\ndata: ${BOOT_ID}\n\n`))
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'))
        } catch {
          // Consumer gone — stop pinging a closed stream.
          if (keepAlive) clearInterval(keepAlive)
        }
      }, 5_000)
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  })
}

async function handleRequest(
  req: Request,
  server: RequestIPServer,
  distDir: string,
): Promise<Response> {
  const url = new URL(req.url)
  const method = req.method

  // Dev-only live-reload endpoints, handled before config/auth so they stay cheap on the
  // frequent SSE reconnects and work on any page (including login).
  if (isRunningFromSource() && url.pathname.startsWith('/__dev_reload')) {
    return handleDevReload(url.pathname)
  }

  // Load config first — needed for trustProxy and filtering
  const config = await loadRitualConfig()
  const clientIp = getClientIp(req, server, config.admin.trustProxy)
  const userAgent = req.headers.get('User-Agent') ?? ''

  // IP and User-Agent filtering
  if (config.admin.ipDenyList.length > 0 && matchesList(clientIp, config.admin.ipDenyList)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (config.admin.ipAllowList.length > 0 && !matchesList(clientIp, config.admin.ipAllowList)) {
    return new Response('Forbidden', { status: 403 })
  }
  if (
    config.admin.userAgentDenyList.length > 0 &&
    matchesList(userAgent, config.admin.userAgentDenyList)
  ) {
    return new Response('Forbidden', { status: 403 })
  }
  if (
    config.admin.userAgentAllowList.length > 0 &&
    !matchesList(userAgent, config.admin.userAgentAllowList)
  ) {
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

    // `route` matched above, so dispatchRoute necessarily matches too; the auth-free
    // dispatcher is shared with the MCP adapter so both go through one code path.
    //
    // `req.signal` is deliberately NOT forwarded as the context's `signal`. It
    // would make a browser disconnect cancel the handler — and the one handler
    // that honours cancellation is the site build, so closing the tab (or a
    // reload, or a proxy timing out an idle connection) would kill a build the
    // user meant to finish. The MCP adapter passes a signal explicitly, because
    // there an abort is an explicit `notifications/cancelled` rather than a
    // socket closing. Wiring this would be a behaviour change, not a fix.
    const result = await dispatchRoute(req, { clientIp, sessionToken })
    return result.matched ? result.response : new Response('Not Found', { status: 404 })
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

/**
 * A running admin server: the Bun listener plus its teardown.
 *
 * Returned rather than swallowed so a caller running more than one listener —
 * `ritual admin --mcp` runs the admin server alongside the MCP HTTP server —
 * can stop both on SIGINT/SIGTERM instead of leaking a bound port.
 */
export interface AdminServer {
  readonly server: Bun.Server<undefined>
  readonly port: number
  /**
   * Stop the listener. Passing `true` also drops in-flight connections, which is
   * what lets the dev live-reload SSE stream's `cancel()` run and clear its
   * keep-alive interval — without it the process stays alive holding a timer.
   */
  stop(closeActiveConnections?: boolean): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

export async function startAdminServer(options: AdminServerOptions): Promise<AdminServer> {
  const { port, host, distDir } = options

  await Promise.all(
    ['decks', 'collections', 'wanted'].map((dir) =>
      fs.mkdir(path.join(getBaseDir(), dir), { recursive: true }),
    ),
  )

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

  const stop = async (closeActiveConnections?: boolean): Promise<void> => {
    await server.stop(closeActiveConnections)
  }

  return {
    server,
    port: server.port ?? port,
    stop,
    [Symbol.asyncDispose]: () => stop(true),
  }
}
