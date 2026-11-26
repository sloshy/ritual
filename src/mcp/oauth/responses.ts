import { apiText } from '../../api/result'
import type { ParameterlessKey, TranslateArgs } from '../../i18n/t'
import type { MessageKey } from '../../i18n/messages/en'
import { pageContentSecurityPolicy } from './page'

/**
 * The RFC 6749 §5.2 / RFC 7591 §3.2.2 error body. `error` is the protocol's
 * code, matched by clients; `error_description` is English, like every other
 * reply an MCP client (not the operator) reads.
 */
export type OAuthErrorBody = {
  error: OAuthErrorCodeName
  error_description: string
}

/** The OAuth error codes Ritual answers with (RFC 6749 §5.2, RFC 7591 §3.2.2, RFC 8707). */
export type OAuthErrorCodeName =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_target'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'temporarily_unavailable'
  | 'server_error'

/** Headers every token, registration and error reply carries (RFC 6749 §5.1). */
const NO_STORE: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
}

/**
 * The CORS headers of the server-to-server endpoints. A browser-based client
 * may call them too; they use no cookies, so any origin may read the reply.
 */
export const OPEN_CORS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
}

/** A JSON reply that must never be cached. */
export function noStoreJson(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...OPEN_CORS, ...headers } })
}

/** An OAuth error reply, its description rendered in English from `key`. */
export function oauthError<K extends MessageKey>(
  status: number,
  error: OAuthErrorCodeName,
  key: K,
  ...args: TranslateArgs<K>
): Response {
  const body: OAuthErrorBody = { error, error_description: apiText(key, ...args) }
  return noStoreJson(body, status)
}

/** The `405` of an OAuth endpoint asked with the wrong method. */
export function methodNotAllowed(allow: string): Response {
  const key: ParameterlessKey = 'cli.mcp.oauth.error.methodNotAllowed'
  const body: OAuthErrorBody = { error: 'invalid_request', error_description: apiText(key) }
  return noStoreJson(body, 405, { Allow: allow })
}

/** The answer to a CORS preflight on a server-to-server endpoint. */
export function preflight(allow: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...OPEN_CORS,
      'Access-Control-Allow-Methods': allow,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

/** How {@link htmlPage} decorates a page. */
export type HtmlPageOptions = {
  /** The client's origin, which `form-action` must also admit (the consent page). */
  redirectOrigin?: string
  setCookie?: string
  /** Seconds to send as `Retry-After`. */
  retryAfter?: number
}

/**
 * An HTML page from the authorize endpoint, with the headers that keep it from
 * being framed, cached, sniffed or leaking its URL to another origin. `redirectOrigin` widens
 * `form-action` to the client's origin on the consent page.
 */
export function htmlPage(html: string, status: number, options: HtmlPageOptions = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': pageContentSecurityPolicy(options.redirectOrigin),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    // Not `no-referrer`: that makes the browser send `Origin: null` with the
    // form post, which the Origin checks must refuse. `same-origin` keeps the
    // page's URL (with the client's query) from leaving this origin.
    'Referrer-Policy': 'same-origin',
    ...NO_STORE,
  }
  if (options.setCookie !== undefined) headers['Set-Cookie'] = options.setCookie
  if (options.retryAfter !== undefined) headers['Retry-After'] = String(options.retryAfter)
  return new Response(html, { status, headers })
}

/** The redirect back to a client, never cached and never carrying a referrer. */
export function clientRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, 'Referrer-Policy': 'no-referrer', ...NO_STORE },
  })
}
