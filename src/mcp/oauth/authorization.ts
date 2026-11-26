import { MCP_SCOPE } from './metadata'
import { isS256Challenge, PKCE_METHOD } from './pkce'
import { MAX_STATE_LENGTH } from './policy'
import { matchRedirectUri } from './redirect-uri'
import { parameter } from './request-body'
import type { OAuthClient } from '../../auth/mcp-oauth/state'

/** An authorization request that passed every check, ready for the consent page. */
export type AuthorizationRequest = {
  clientId: string
  clientName?: string
  /** The redirect URI the client asked for, which matched a registered one. */
  redirectUri: string
  codeChallenge: string
  state?: string
  scopes: string[]
  resource: string
}

/**
 * Why the redirect could not be trusted, so the error is shown on Ritual's own
 * page instead (RFC 6749 §4.1.2.1): the `client_id` or `redirect_uri` is
 * missing, repeated, unknown, or does not match. One reason for all of them,
 * so the page never tells an unknown client from a known one.
 */
export type AuthorizationPageRefusal = { kind: 'page' }

/** The RFC 6749 / RFC 8707 error codes the authorize endpoint redirects with. */
export type AuthorizationErrorCode =
  'invalid_request' | 'unsupported_response_type' | 'invalid_target' | 'access_denied'

/** Why a request with a trustworthy redirect was refused (a code, worded at the boundary). */
export type AuthorizationRefusalDetail =
  | 'duplicate'
  | 'responseType'
  | 'pkceMissing'
  | 'pkceMethod'
  | 'pkceMalformed'
  | 'resource'
  | 'stateTooLong'

/** A refusal sent back to the client's validated redirect URI. */
export type AuthorizationRedirectRefusal = {
  kind: 'redirect'
  redirectUri: string
  state?: string
  error: AuthorizationErrorCode
  detail: AuthorizationRefusalDetail
}

/** Any refusal of an authorization request. */
export type AuthorizationRefusal = AuthorizationPageRefusal | AuthorizationRedirectRefusal

/** The parameters an authorization request may carry, each at most once. */
const SINGLE_VALUED = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const

/**
 * Validate an authorization request's query against the registered clients.
 *
 * The client and its redirect URI are checked first, since nothing may be
 * sent to a URI that is not proven to be the client's. Every later problem is
 * redirected there with the client's `state`. Scopes beyond `mcp` are ignored
 * rather than refused (RFC 6749 §3.3 lets the server narrow a request): the
 * grant always carries `mcp`.
 */
export function validateAuthorizationRequest(
  params: URLSearchParams,
  clients: readonly Readonly<OAuthClient>[],
  resource: string,
): AuthorizationRequest | AuthorizationRefusal {
  if (params.getAll('client_id').length > 1 || params.getAll('redirect_uri').length > 1) {
    return { kind: 'page' }
  }
  const clientId = parameter(params, 'client_id')
  const requestedRedirect = parameter(params, 'redirect_uri')
  if (clientId === null || requestedRedirect === null) return { kind: 'page' }
  const client = clients.find((candidate) => candidate.clientId === clientId)
  if (client === undefined) return { kind: 'page' }
  const redirectUri = matchRedirectUri(client.redirectUris, requestedRedirect)
  if (redirectUri === undefined) return { kind: 'page' }
  // From here the redirect is trusted. The redirect carries the matched
  // request URI — the one with the port the client is listening on.
  const redirectTo = requestedRedirect

  const stateValues = params.getAll('state')
  const state = stateValues.length === 1 && stateValues[0] !== '' ? stateValues[0] : undefined
  // A repeated or over-long `state` is not echoed: it is not one value the
  // client is known to have sent.
  const refuse = (
    error: AuthorizationErrorCode,
    detail: AuthorizationRefusalDetail,
    echoState: boolean = true,
  ): AuthorizationRedirectRefusal => ({
    kind: 'redirect',
    redirectUri: redirectTo,
    ...(echoState && state !== undefined ? { state } : {}),
    error,
    detail,
  })

  if (SINGLE_VALUED.some((name) => params.getAll(name).length > 1)) {
    return refuse('invalid_request', 'duplicate', false)
  }
  if (state !== undefined && state.length > MAX_STATE_LENGTH) {
    return refuse('invalid_request', 'stateTooLong', false)
  }
  if (parameter(params, 'response_type') !== 'code') {
    return refuse('unsupported_response_type', 'responseType')
  }
  const codeChallenge = parameter(params, 'code_challenge')
  if (codeChallenge === null) return refuse('invalid_request', 'pkceMissing')
  if (parameter(params, 'code_challenge_method') !== PKCE_METHOD) {
    return refuse('invalid_request', 'pkceMethod')
  }
  if (!isS256Challenge(codeChallenge)) return refuse('invalid_request', 'pkceMalformed')
  const requestedResource = parameter(params, 'resource')
  if (requestedResource !== null && requestedResource !== resource) {
    return refuse('invalid_target', 'resource')
  }

  const request: AuthorizationRequest = {
    clientId: client.clientId,
    redirectUri: redirectTo,
    codeChallenge,
    scopes: [MCP_SCOPE],
    resource,
  }
  if (client.clientName !== undefined) request.clientName = client.clientName
  if (state !== undefined) request.state = state
  return request
}

/** Whether {@link validateAuthorizationRequest} refused the request. */
export function isAuthorizationRefusal(
  value: AuthorizationRequest | AuthorizationRefusal,
): value is AuthorizationRefusal {
  return 'kind' in value
}

/**
 * The URL that sends the browser back to the client: its redirect URI with
 * `params` and the RFC 9207 `iss` added to whatever query it already has.
 */
export function clientRedirectUrl(
  redirectUri: string,
  issuer: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(name, value)
  }
  url.searchParams.set('iss', issuer)
  return url.href
}
