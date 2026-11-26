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
import { MCP_PATH, publicMcpUrl, type McpPublicUrl } from './public-url'
import type { OAuthAuthorizationServer, OAuthServerSeams } from './oauth/authorization-server'
import { isBrowserOAuthPath, isOAuthPath } from './oauth/metadata'
import { createOAuthRouter, type OAuthRouter } from './oauth/router'
import type { OAuthStore } from '../auth/mcp-oauth/store'
import { buildMcpServer } from './server'
import { verifyTaskSupport } from './tasks/probe'
import { sharedTaskRuntime } from './tasks/runtime'
import { divertConsoleLogToStderr } from '../util/stdout-guard'
import { bearerMatches, type McpAuthenticator } from './bearer'
import { MAX_UPLOAD_BODY_SIZE } from '../admin/validation'
import { startServerOrThrow } from '../util/start-server'
import { apiMessage, type ApiMessageParams } from '../api/result'
import { t, type TranslateArgs } from '../i18n/t'
import type { MessageKey } from '../i18n/messages/en'

/**
 * Run the MCP server over stdio (the default transport for local agent clients).
 *
 * `serveStdio` pins one server instance per connection and picks the protocol era
 * from the opening exchange: a 2025-era `initialize` is served on the legacy leg
 * (the default `legacy: 'serve'`), a 2026-07-28 client is served statelessly.
 * Resolves once the handle is up; the open stdin keeps the process alive.
 * Task support is probed first (see `tasks/probe.ts`).
 */
export async function runStdioServer(): Promise<void> {
  divertConsoleLogToStderr()
  await verifyTaskSupport(sharedTaskRuntime)
  // Stdio pins one server instance per connection, so it is the transport that
  // can actually deliver a resources/list_changed notification.
  const handle = serveStdio(() => buildMcpServer({ notifyListChanged: true }), {
    onerror: (error) => console.error(t('cli.mcp.stdioError'), error),
  })
  // Closing the transport aborts a plain call in flight; a task runs on its
  // own signal, so it is stopped the same way — on a signal, and when the
  // client ends the session by closing stdin.
  process.stdin.once('end', () => sharedTaskRuntime.abortAll())
  const closeHandle = (): void => {
    sharedTaskRuntime.abortAll()
    void Promise.resolve(handle.close()).catch((error: unknown) =>
      console.error(t('cli.mcp.stdioTeardownFailed'), error),
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
 * - `oauth`: the embedded OAuth 2.1 authorization server (beta) is mounted on
 *   the same listener, and `/mcp` accepts its access tokens — plus the static
 *   `token`, when one is given. Needs {@link HttpServerOptions.publicUrl}.
 */
export type McpHttpAuth = { kind: 'none' } | { kind: 'bearer'; token: string } | McpOAuthHttpAuth

/**
 * The `oauth` strategy: the opened state, an optional static token, and the
 * authorization server's test seams ({@link OAuthServerSeams}: its clock,
 * random source, fingerprint reader, TOTP budget and consent-page caps).
 */
export type McpOAuthHttpAuth = OAuthServerSeams & {
  kind: 'oauth'
  store: OAuthStore
  token?: string
}

export interface HttpServerOptions {
  port: number
  host: string
  auth: McpHttpAuth
  /**
   * The external origin a tunnel or reverse proxy forwards to this listener.
   * On a loopback bind its hostname is allowed through the DNS-rebinding
   * checks beside the local names; the endpoint it implies is announced at
   * startup.
   */
  publicUrl?: McpPublicUrl
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
  /** The embedded authorization server, under the `oauth` strategy (revocation goes through it). */
  readonly oauth?: OAuthAuthorizationServer
  stop(closeActiveConnections?: boolean): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}

// Ritual's error codes live in `error-codes.ts` so the tool layer (which raises
// the conflict code) and this transport wrapper share one registry. Re-exported
// because this module has been their import site.
export { NOT_FOUND_ERROR_CODE, UNAUTHORIZED_ERROR_CODE, CONFLICT_ERROR_CODE }
export type { NotProtocolCode, RitualWireErrorCode }

/**
 * The catalog key a pre-transport rejection's English `message` was rendered
 * from, and its params — JSON-RPC's own `error.data` slot, so a client that
 * words errors in its reader's language can, the way every other Ritual server
 * reply carries its key beside the English.
 */
export type RpcErrorData = {
  messageKey: MessageKey
  messageParams?: ApiMessageParams
}

/** The JSON-RPC error object of a pre-transport rejection: its code, English message and key. */
export type RpcError = {
  code: RitualWireErrorCode | ProtocolErrorCode
  message: string
  data: RpcErrorData
}

/** The JSON-RPC error envelope Ritual's pre-transport rejections put on the wire. */
export type RpcErrorBody = {
  jsonrpc: '2.0'
  error: RpcError
  id: null
}

/**
 * The hard ceiling on an MCP request body (`maxRequestBodySize`). A tool call
 * carries its arguments inside JSON-RPC, so a file-sized argument (`import_csv`'s
 * CSV text) arrives as an escaped string — quotes and newlines double — and gets
 * twice the largest admin route budget. Each tool's dispatched route then holds
 * its own budget, measured in-process.
 */
export const MAX_MCP_REQUEST_BODY_SIZE = 2 * MAX_UPLOAD_BODY_SIZE + 64 * 1024

/**
 * A pre-transport rejection: English `message` whatever the server's UI
 * language — an MCP client, not the operator, reads it — with its key beside it
 * in `error.data`.
 */
function rpcErrorResponse<K extends MessageKey>(
  status: number,
  code: RitualWireErrorCode | ProtocolErrorCode,
  key: K,
  ...args: TranslateArgs<K>
): Response {
  const { message, messageParams } = apiMessage(key, ...args)
  const data: RpcErrorData =
    messageParams === undefined ? { messageKey: key } : { messageKey: key, messageParams }
  const body: RpcErrorBody = { jsonrpc: '2.0', error: { code, message, data }, id: null }
  return Response.json(body, { status })
}

/** The `401` every unauthenticated `/mcp` request gets, with the OAuth challenge when there is one. */
function unauthorizedResponse(challenge?: string): Response {
  const response = rpcErrorResponse(401, UNAUTHORIZED_ERROR_CODE, 'admin.api.server.unauthorized')
  if (challenge !== undefined) response.headers.set('WWW-Authenticate', challenge)
  return response
}

/** The authenticator of the static strategies: a bearer token, or none at all. */
function staticAuthenticator(auth: Exclude<McpHttpAuth, McpOAuthHttpAuth>): McpAuthenticator {
  switch (auth.kind) {
    case 'bearer':
      return (request) =>
        Promise.resolve({ ok: bearerMatches(request.headers.get('authorization'), auth.token) })
    case 'none':
      return () => Promise.resolve({ ok: true })
    default:
      return auth satisfies never
  }
}

/** The answer to a request whose URL (in practice its `Host` header) does not parse. */
function malformedRequestResponse(): Response {
  return rpcErrorResponse(400, ProtocolErrorCode.InvalidRequest, 'cli.mcp.malformedRequest')
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
  const { port, host, auth, publicUrl } = options

  let oauth: OAuthRouter | undefined
  let authenticate: McpAuthenticator
  if (auth.kind === 'oauth') {
    // The commands check this before calling; a caller that did not is a bug.
    if (publicUrl === undefined) throw new TypeError(t('cli.mcp.oauth.publicUrlMissing'))
    const { kind: _kind, token, ...serverOptions } = auth
    oauth = createOAuthRouter({
      ...serverOptions,
      publicUrl,
      ...(token === undefined ? {} : { staticToken: token }),
    })
    authenticate = oauth.authenticate
    await oauth.server.start()
  } else {
    authenticate = staticAuthenticator(auth)
  }

  // Before anything is served, so no client sees the Tasks extension
  // advertised by a server that would not honour it.
  await verifyTaskSupport(sharedTaskRuntime)
  const handler = createMcpHandler(() => buildMcpServer(), {
    // The default; spelled out because it is what keeps 2025-era clients working.
    legacy: 'stateless',
    onerror: (error) => console.error(t('cli.mcp.httpError'), error),
  })

  // The SDK's allowlists cover `localhost`, `127.0.0.1`, and `[::1]`. A bind to
  // any other loopback address (`isLoopbackHost` accepts all of 127.0.0.0/8)
  // must still accept its own name, or every request would be rejected as a
  // rebinding attempt.
  //
  // A public URL's hostname joins both lists. The SDK compares hostnames only
  // (port-agnostic, IPv6 bracketed, which is the form `URL.hostname` yields):
  // `Host: mcp.example.com:8443` and `Origin: https://mcp.example.com:8443`
  // both reduce to `mcp.example.com`, so a non-default port needs no entry of
  // its own, and any other hostname is still turned away.
  const publicHostnames = publicUrl === undefined ? [] : [publicUrl.hostname]
  const allowedHosts = [...new Set([...localhostAllowedHostnames(), host, ...publicHostnames])]
  const allowedOrigins = [...new Set([...localhostAllowedOrigins(), host, ...publicHostnames])]
  const loopbackOnly = isLoopbackHost(host)

  let server: Bun.Server<undefined>
  try {
    server = startServerOrThrow({ host, port }, () =>
      Bun.serve({
        port,
        hostname: host,
        maxRequestBodySize: MAX_MCP_REQUEST_BODY_SIZE,
        fetch: async (request, bunServer) => {
          let pathname: string
          try {
            pathname = new URL(request.url).pathname
          } catch {
            return malformedRequestResponse()
          }
          const oauthPath = oauth !== undefined && isOAuthPath(pathname) ? pathname : undefined
          if (pathname !== MCP_PATH && oauthPath === undefined) {
            return rpcErrorResponse(404, NOT_FOUND_ERROR_CODE, 'cli.mcp.endpointNotFound', {
              path: MCP_PATH,
            })
          }
          // DNS-rebinding protection (Host + Origin, per the SDK's own mounting
          // guidance) applies to loopback binds only; a deliberately exposed host
          // is reached by its own name and guarded by the bearer token. The
          // OAuth routes sit behind the Host check too. The Origin check
          // covers `/mcp` and the consent page only: the metadata,
          // registration and token endpoints are called server to server or
          // by browser-based clients on other origins, and use no cookies.
          if (loopbackOnly) {
            const checkOrigin = oauthPath === undefined || isBrowserOAuthPath(oauthPath)
            const rejection =
              hostHeaderValidationResponse(request, allowedHosts) ??
              (checkOrigin ? originValidationResponse(request, allowedOrigins) : undefined)
            if (rejection) return rejection
          }
          if (oauth !== undefined && oauthPath !== undefined) {
            return oauth.handle(request, oauthPath, bunServer)
          }
          const authentication = await authenticate(request)
          if (!authentication.ok) return unauthorizedResponse(authentication.challenge)
          try {
            return await handler.fetch(
              request,
              authentication.authInfo === undefined
                ? undefined
                : { authInfo: authentication.authInfo },
            )
          } catch (error) {
            console.error(t('cli.mcp.httpRequestFailed'), error)
            return rpcErrorResponse(
              500,
              ProtocolErrorCode.InternalError,
              'admin.api.server.internalError',
            )
          }
        },
      }),
    )
  } catch (error) {
    // Nothing is listening, so nothing else would ever close the handler.
    await handler.close()
    throw error
  }

  // Stop the listener before closing the handler: the reverse order aborts
  // in-flight exchanges while the socket still accepts new connections.
  const stop = async (closeActiveConnections?: boolean): Promise<void> => {
    try {
      await server.stop(closeActiveConnections)
    } finally {
      // Tasks run on their own signals, which no transport teardown reaches:
      // abort them as closing the handler aborts the plain calls in flight —
      // after the listener stops, so no new task slips in behind. The runtime
      // is process-wide, so this stops every task the process runs; a process
      // runs one MCP endpoint (`ritual mcp`, or `ritual admin --mcp`'s).
      sharedTaskRuntime.abortAll()
      await handler.close()
    }
  }

  const boundPort = server.port ?? port
  console.error(t('cli.mcp.httpListening', { url: `http://${host}:${boundPort}${MCP_PATH}` }))
  if (publicUrl !== undefined) {
    console.error(t('cli.mcp.httpPublicEndpoint', { url: publicMcpUrl(publicUrl) }))
  }
  if (oauth !== undefined) {
    console.error(t('cli.mcp.oauth.enabled', { url: oauth.server.endpoints.authorizationEndpoint }))
  }
  return {
    server,
    port: boundPort,
    ...(oauth === undefined ? {} : { oauth: oauth.server }),
    stop,
    [Symbol.asyncDispose]: () => stop(true),
  }
}
