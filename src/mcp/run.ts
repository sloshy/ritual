import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  ProtocolErrorCode,
} from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  CONFLICT_ERROR_CODE,
  NOT_FOUND_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type NotProtocolCode,
  type RitualWireErrorCode,
} from './error-codes'
import { isLoopbackHost } from './host'
import { buildMcpServer } from './server'
import { divertConsoleLogToStderr } from '../util/stdout-guard'

/**
 * Run the MCP server over stdio (the default transport for local agent clients).
 *
 * `serveStdio` pins one server instance per connection and picks the protocol era
 * from the opening exchange: a 2025-era `initialize` is served on the legacy leg
 * (the default `legacy: 'serve'`), a 2026-07-28 client is served statelessly.
 * Returns once the handle is up; the open stdin keeps the process alive.
 */
export function runStdioServer(): void {
  divertConsoleLogToStderr()
  // Stdio pins one server instance per connection, so it is the transport that
  // can actually deliver a resources/list_changed notification.
  const handle = serveStdio(() => buildMcpServer({ notifyListChanged: true }), {
    onerror: (error) => console.error('MCP stdio error:', error),
  })
  const closeHandle = (): void => {
    void Promise.resolve(handle.close()).catch((error: unknown) =>
      console.error('MCP stdio teardown failed:', error),
    )
  }
  process.on('SIGINT', closeHandle)
  process.on('SIGTERM', closeHandle)
}

/**
 * How an HTTP MCP request is authenticated before reaching the transport.
 * - `none`: no auth (intended for a localhost-only bind).
 * - `bearer`: requires `Authorization: Bearer <token>`. Used by both the standalone
 *   `ritual mcp --transport http` and the embedded `ritual admin --mcp` endpoints.
 */
export type McpHttpAuth = { kind: 'none' } | { kind: 'bearer'; token: string }

export interface HttpServerOptions {
  port: number
  host: string
  auth: McpHttpAuth
}

/**
 * A running MCP HTTP endpoint: the Bun listener plus the MCP handler whose
 * lifetime is tied to it. `stop` closes the listener first (no new
 * connections), then tears the handler down so in-flight per-request server
 * instances are not abandoned mid-exchange.
 */
export type McpHttpServer = {
  readonly server: Bun.Server<undefined>
  readonly port: number
  stop(closeActiveConnections?: boolean): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

// Ritual's error codes live in `error-codes.ts` so the tool layer (which raises
// the conflict code) and this transport wrapper share one registry. Re-exported
// because this module has been their import site.
export { NOT_FOUND_ERROR_CODE, UNAUTHORIZED_ERROR_CODE, CONFLICT_ERROR_CODE }
export type { NotProtocolCode, RitualWireErrorCode }

/** The JSON-RPC error envelope Ritual's pre-transport rejections put on the wire. */
export type RpcErrorBody = {
  jsonrpc: '2.0'
  error: { code: RitualWireErrorCode | ProtocolErrorCode; message: string }
  id: null
}

/** The single path the MCP Streamable HTTP endpoint is served from. */
const MCP_PATH = '/mcp'

function rpcErrorResponse(
  status: number,
  code: RitualWireErrorCode | ProtocolErrorCode,
  message: string,
): Response {
  const body: RpcErrorBody = { jsonrpc: '2.0', error: { code, message }, id: null }
  return Response.json(body, { status })
}

/** Authorize a request against the configured strategy. */
function isAuthorized(request: Request, auth: McpHttpAuth): boolean {
  switch (auth.kind) {
    case 'bearer':
      return request.headers.get('authorization') === `Bearer ${auth.token}`
    case 'none':
      return true
  }
}

/**
 * Run the MCP server over Streamable HTTP at `http://<host>:<port>/mcp`. Binds to
 * localhost by default; set a bearer token (and an exposed host) only when you
 * intend remote clients to connect. Resolves to a handle exposing the bound port
 * and a `stop` that also tears the MCP handler down; the process stays alive on
 * the open listener regardless.
 *
 * Serving is stateless: `createMcpHandler` builds one {@link buildMcpServer}
 * instance per HTTP request and tears it down with the response. There are no
 * sessions and no `Mcp-Session-Id`, so 2025-era clients (which still work — they
 * are served on the handler's legacy leg) get `405` for the standalone `GET /mcp`
 * SSE stream and `DELETE /mcp` session teardown, neither of which Ritual uses.
 *
 * That statelessness is also why this leg does **not** advertise
 * `resources.listChanged` while stdio does: a notification sent from a server
 * instance that is torn down with its response has no client connection to
 * reach, so claiming the capability here would be a promise Ritual cannot keep.
 */
export async function runHttpServer(options: HttpServerOptions): Promise<McpHttpServer> {
  const { port, host, auth } = options

  const handler = createMcpHandler(() => buildMcpServer(), {
    // The default; spelled out because it is what keeps 2025-era clients working.
    legacy: 'stateless',
    onerror: (error) => console.error('MCP HTTP error:', error),
  })

  // The SDK's allowlists cover `localhost`, `127.0.0.1`, and `[::1]`. A bind to
  // any other loopback address (`isLoopbackHost` accepts all of 127.0.0.0/8)
  // must still accept its own name, or every request would be rejected as a
  // rebinding attempt.
  const allowedHosts = [...new Set([...localhostAllowedHostnames(), host])]
  const allowedOrigins = [...new Set([...localhostAllowedOrigins(), host])]
  const loopbackOnly = isLoopbackHost(host)

  const server = Bun.serve({
    port,
    hostname: host,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== MCP_PATH) {
        return rpcErrorResponse(
          404,
          NOT_FOUND_ERROR_CODE,
          `Not found. Use the ${MCP_PATH} endpoint.`,
        )
      }
      // DNS-rebinding protection (Host + Origin, per the SDK's own mounting
      // guidance) applies to loopback binds only; a deliberately exposed host
      // is reached by its own name and guarded by the bearer token.
      if (loopbackOnly) {
        const rejection =
          hostHeaderValidationResponse(request, allowedHosts) ??
          originValidationResponse(request, allowedOrigins)
        if (rejection) return rejection
      }
      if (!isAuthorized(request, auth)) {
        return rpcErrorResponse(401, UNAUTHORIZED_ERROR_CODE, 'Unauthorized')
      }
      try {
        return await handler.fetch(request)
      } catch (error) {
        console.error('MCP HTTP request failed:', error)
        return rpcErrorResponse(500, ProtocolErrorCode.InternalError, 'Internal server error')
      }
    },
  })

  // Stop the listener before closing the handler: the reverse order aborts
  // in-flight exchanges while the socket still accepts new connections.
  const stop = async (closeActiveConnections?: boolean): Promise<void> => {
    try {
      await server.stop(closeActiveConnections)
    } finally {
      await handler.close()
    }
  }

  const boundPort = server.port ?? port
  console.error(`Ritual MCP server (HTTP) listening at http://${host}:${boundPort}${MCP_PATH}`)
  return { server, port: boundPort, stop, [Symbol.asyncDispose]: () => stop(true) }
}
