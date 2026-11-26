import type { OAuthMetadata } from '@modelcontextprotocol/server'
import { isLoopbackHost } from '../host'
import { isHttpsOrigin, MCP_PATH, publicMcpUrl, type McpPublicUrl } from '../public-url'
import { PKCE_METHOD } from './pkce'

/** The paths the embedded authorization server answers on, beside `/mcp`. */
export const OAUTH_PATHS = {
  /** RFC 9728 protected-resource metadata, at the origin's root. */
  protectedResource: '/.well-known/oauth-protected-resource',
  /** The same document at its path-aware RFC 9728 location for `/mcp`. */
  protectedResourceForMcp: `/.well-known/oauth-protected-resource${MCP_PATH}`,
  /** RFC 8414 authorization-server metadata. */
  authorizationServer: '/.well-known/oauth-authorization-server',
  /** RFC 7591 dynamic client registration. */
  register: '/oauth/register',
  /** The login + consent page and its form. */
  authorize: '/oauth/authorize',
  /** The token endpoint. */
  token: '/oauth/token',
} as const

/** One of {@link OAUTH_PATHS}. */
export type OAuthPath = (typeof OAUTH_PATHS)[keyof typeof OAUTH_PATHS]

const OAUTH_PATH_SET: ReadonlySet<string> = new Set(Object.values(OAUTH_PATHS))

/** Whether `pathname` is one of the authorization server's routes. */
export function isOAuthPath(pathname: string): pathname is OAuthPath {
  return OAUTH_PATH_SET.has(pathname)
}

/**
 * Whether an OAuth path is loaded by a browser and so must pass the loopback
 * `Origin` check: only the consent page. The metadata, registration and token
 * endpoints are called server to server or from a browser-based client on
 * another origin; they use no cookies, so they keep the `Host` check only.
 */
export function isBrowserOAuthPath(path: OAuthPath): boolean {
  return path === OAUTH_PATHS.authorize
}

/** The one scope Ritual grants: everything the MCP endpoint serves. */
export const MCP_SCOPE = 'mcp'

/** The absolute URLs the authorization server is reached at, all under the public origin. */
export type OAuthEndpoints = {
  /** The issuer identifier: the public origin itself. */
  issuer: string
  /** The protected resource, `<origin>/mcp`: every access token's audience. */
  resource: string
  /** Where `WWW-Authenticate` points a client that has no valid token. */
  protectedResourceMetadataUrl: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
}

/** The endpoints for a public URL. */
export function oauthEndpoints(publicUrl: McpPublicUrl): OAuthEndpoints {
  const at = (path: string): string => `${publicUrl.origin}${path}`
  return {
    issuer: publicUrl.origin,
    resource: publicMcpUrl(publicUrl),
    protectedResourceMetadataUrl: at(OAUTH_PATHS.protectedResource),
    authorizationEndpoint: at(OAUTH_PATHS.authorize),
    tokenEndpoint: at(OAUTH_PATHS.token),
    registrationEndpoint: at(OAUTH_PATHS.register),
  }
}

/**
 * Whether an OAuth issuer may be served from this public URL: `https:`, or
 * `http:` on a loopback host for local testing (OAuth 2.1 §1.5 requires TLS
 * everywhere else). Claude's connectors also require a public `https:` URL.
 */
export function isAcceptableIssuer(publicUrl: McpPublicUrl): boolean {
  return isHttpsOrigin(publicUrl) || isLoopbackHost(publicUrl.hostname)
}

/** The RFC 8414 authorization-server metadata document. */
export function authorizationServerMetadata(endpoints: OAuthEndpoints): OAuthMetadata {
  return {
    issuer: endpoints.issuer,
    authorization_endpoint: endpoints.authorizationEndpoint,
    token_endpoint: endpoints.tokenEndpoint,
    registration_endpoint: endpoints.registrationEndpoint,
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: [PKCE_METHOD],
    authorization_response_iss_parameter_supported: true,
  }
}

/**
 * The options the SDK's metadata helpers take. `dangerouslyAllowInsecureIssuerUrl`
 * is set only for a loopback `http:` issuer, which {@link isAcceptableIssuer}
 * already confined; the SDK's own check knows only `localhost` and `127.0.0.1`.
 */
export type ResourceMetadataOptions = {
  oauthMetadata: OAuthMetadata
  resourceServerUrl: URL
  scopesSupported: string[]
  resourceName: string
  dangerouslyAllowInsecureIssuerUrl: boolean
}

/** The SDK metadata options for these endpoints, served from `publicUrl`. */
export function resourceMetadataOptions(
  endpoints: OAuthEndpoints,
  publicUrl: McpPublicUrl,
): ResourceMetadataOptions {
  return {
    oauthMetadata: authorizationServerMetadata(endpoints),
    resourceServerUrl: new URL(endpoints.resource),
    scopesSupported: [MCP_SCOPE],
    // i18n-exempt: the product name, a machine-readable metadata value
    resourceName: 'Ritual',
    dangerouslyAllowInsecureIssuerUrl: !isHttpsOrigin(publicUrl),
  }
}
