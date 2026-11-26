import { OAuthError, oauthMetadataResponse, verifyBearerToken } from '@modelcontextprotocol/server'
import { isRefusedByAccessLists } from '../../admin/access-lists'
import { readRequestSource, type RequestIPServer } from '../../admin/forwarded'
import { OAuthStateUnavailableError } from '../../auth/mcp-oauth/store'
import { loadRitualConfig } from '../../config/ritual-config'
import { t } from '../../i18n/t'
import { bearerMatches, type McpAuthenticator } from '../bearer'
import { handleAuthorizeGet, handleAuthorizePost, type AuthorizeContext } from './authorize-route'
import { OAuthAuthorizationServer, type OAuthServerOptions } from './authorization-server'
import {
  OAUTH_PATHS,
  resourceMetadataOptions,
  type OAuthPath,
  type ResourceMetadataOptions,
} from './metadata'
import { handleRegister } from './register-route'
import { htmlPage, methodNotAllowed, oauthError } from './responses'
import { renderErrorPage } from './page'
import { handleToken } from './token-route'

/** The authorization server's HTTP face, mounted beside `/mcp` on the same listener. */
export type OAuthRouter = {
  readonly server: OAuthAuthorizationServer
  /** Serve one of the OAuth paths (the caller has matched `isOAuthPath`). */
  handle(request: Request, path: OAuthPath, peer: RequestIPServer): Promise<Response>
  /** Authenticate a request to `/mcp`: the static token, or an OAuth access token. */
  authenticate: McpAuthenticator
}

/** How the router is built: the server's options, plus the optional static bearer token. */
export type OAuthRouterOptions = OAuthServerOptions & {
  /** A static token accepted on `/mcp` beside OAuth access tokens. */
  staticToken?: string
}

/** Serve the RFC 9728 and RFC 8414 documents through the SDK's helper. */
function metadataResponse(
  request: Request,
  path: OAuthPath,
  options: ResourceMetadataOptions,
): Response {
  // The SDK serves the protected-resource document at its path-aware location
  // only (`…/oauth-protected-resource/mcp`); the root one is the same document,
  // so a request for it is answered as if it had asked for that location.
  const url = new URL(request.url)
  if (path === OAUTH_PATHS.protectedResource) url.pathname = OAUTH_PATHS.protectedResourceForMcp
  const answer = oauthMetadataResponse(new Request(url, request), options)
  return answer ?? methodNotAllowed('GET, HEAD, OPTIONS')
}

/**
 * The `WWW-Authenticate` challenge for `/mcp` (RFC 6750 §3, RFC 9728 §5.1).
 * `error="invalid_token"` only when a token was presented: a request without
 * one is told only where to start.
 */
function challenge(metadataUrl: string, presented: boolean): string {
  const error = presented ? 'error="invalid_token", ' : ''
  return `Bearer ${error}resource_metadata="${metadataUrl}"`
}

/** Build the OAuth router for one MCP listener. */
export function createOAuthRouter(options: OAuthRouterOptions): OAuthRouter {
  const server = new OAuthAuthorizationServer(options)
  const metadata = resourceMetadataOptions(server.endpoints, server.publicUrl)
  const expectedResource = new URL(server.endpoints.resource)
  const { staticToken } = options

  const route = async (
    request: Request,
    path: OAuthPath,
    peer: RequestIPServer,
  ): Promise<Response> => {
    switch (path) {
      case OAUTH_PATHS.protectedResource:
      case OAUTH_PATHS.protectedResourceForMcp:
      case OAUTH_PATHS.authorizationServer:
        return metadataResponse(request, path, metadata)
      case OAUTH_PATHS.register: {
        const { admin } = await loadRitualConfig()
        return handleRegister(server, request, readRequestSource(request, peer, admin).clientIp)
      }
      case OAUTH_PATHS.token:
        return handleToken(server, request)
      case OAUTH_PATHS.authorize: {
        if (request.method !== 'GET' && request.method !== 'POST') {
          return methodNotAllowed('GET, POST')
        }
        const { admin } = await loadRitualConfig()
        const context: AuthorizeContext = {
          clientIp: readRequestSource(request, peer, admin).clientIp,
          userAgent: request.headers.get('User-Agent') ?? '',
          settings: admin,
        }
        // The admin's IP and User-Agent lists guard the sign-in here as they
        // guard the admin login.
        if (isRefusedByAccessLists(admin, context.clientIp, context.userAgent)) {
          return htmlPage(renderErrorPage('forbidden'), 403)
        }
        return request.method === 'GET'
          ? handleAuthorizeGet(server, request, context)
          : handleAuthorizePost(server, request, context)
      }
      default:
        return path satisfies never
    }
  }

  return {
    server,
    handle: async (request, path, peer) => {
      try {
        return await route(request, path, peer)
      } catch (error) {
        // An unusable state file was already reported once by the store; each
        // request is only refused while it lasts.
        if (error instanceof OAuthStateUnavailableError) {
          return path === OAUTH_PATHS.authorize
            ? htmlPage(renderErrorPage('unavailable'), 503)
            : oauthError(503, 'temporarily_unavailable', 'cli.mcp.oauth.error.unavailable')
        }
        // The error may carry anything the request did; the operator gets it,
        // the browser or client a contentless failure.
        console.error(t('cli.mcp.oauth.requestFailed'), error)
        return path === OAUTH_PATHS.authorize
          ? htmlPage(renderErrorPage('serverError'), 500)
          : oauthError(500, 'server_error', 'cli.mcp.oauth.error.serverError')
      }
    },
    authenticate: async (request) => {
      const header = request.headers.get('authorization')
      if (staticToken !== undefined && bearerMatches(header, staticToken)) {
        return { ok: true }
      }
      try {
        const authInfo = await verifyBearerToken(header ?? undefined, {
          verifier: server,
          expectedResource,
          resourceMetadataUrl: server.endpoints.protectedResourceMetadataUrl,
        })
        return { ok: true, authInfo }
      } catch (error) {
        // Every refusal of a token is an `OAuthError`; anything else is a bug
        // the operator should see, though the client is still only refused.
        if (!(error instanceof OAuthError)) console.error(t('cli.mcp.oauth.requestFailed'), error)
        return {
          ok: false,
          challenge: challenge(server.endpoints.protectedResourceMetadataUrl, header !== null),
        }
      }
    },
  }
}
