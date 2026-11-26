import type { OAuthAuthorizationServer } from './authorization-server'
import type { IssuedTokens } from './grants'
import { isBodyProblem, parameter, readForm, repeatedParameter } from './request-body'
import { methodNotAllowed, noStoreJson, oauthError, preflight } from './responses'

/** The RFC 6749 §5.1 token response. */
export type TokenResponse = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

const ALLOW = 'POST, OPTIONS'

function tokenResponse(tokens: IssuedTokens): Response {
  const body: TokenResponse = {
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: tokens.expiresInSeconds,
    refresh_token: tokens.refreshToken,
    scope: tokens.scopes.join(' '),
  }
  return noStoreJson(body, 200)
}

/** The one refusal of every unusable code or refresh token, whatever made it unusable. */
function invalidGrant(): Response {
  return oauthError(400, 'invalid_grant', 'cli.mcp.oauth.error.invalidGrant')
}

/** The first of a grant's required parameters that is absent. */
type MissingParameter = { missing: string }

/** Every one of `names`, or the first that is absent or empty. */
function requiredParameters<N extends string>(
  params: URLSearchParams,
  names: readonly N[],
): Record<N, string> | MissingParameter {
  const values = {} as Record<N, string>
  for (const name of names) {
    const value = parameter(params, name)
    if (value === null) return { missing: name }
    values[name] = value
  }
  return values
}

function isMissing<N extends string>(
  value: Record<N, string> | MissingParameter,
): value is MissingParameter {
  return 'missing' in value
}

function missingParameter(name: string): Response {
  return oauthError(400, 'invalid_request', 'cli.mcp.oauth.error.missingParameter', { name })
}

/**
 * `POST /oauth/token`: the `authorization_code` grant (PKCE S256, single-use
 * code bound to its client and redirect URI) and the `refresh_token` grant
 * (rotated on every use). Public clients only: a request that tries to
 * authenticate the client is refused with `invalid_client`.
 *
 * Every failure of the code or refresh token itself — unknown, expired,
 * replayed, revoked, another client's — is the same `invalid_grant`, so the
 * endpoint never tells which client ids or tokens exist.
 */
export async function handleToken(
  server: OAuthAuthorizationServer,
  request: Request,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(ALLOW)
  if (request.method !== 'POST') return methodNotAllowed(ALLOW)
  const params = await readForm(request)
  if (isBodyProblem(params)) {
    return params.problem === 'tooLarge'
      ? oauthError(413, 'invalid_request', 'cli.mcp.oauth.error.bodyTooLarge')
      : oauthError(400, 'invalid_request', 'cli.mcp.oauth.error.formRequired')
  }
  const repeated = repeatedParameter(params)
  if (repeated !== undefined) {
    return oauthError(400, 'invalid_request', 'cli.mcp.oauth.error.repeatedParameter', {
      name: repeated,
    })
  }
  if (request.headers.has('Authorization') || parameter(params, 'client_secret') !== null) {
    return oauthError(401, 'invalid_client', 'cli.mcp.oauth.error.clientAuthUnsupported')
  }
  const resource = parameter(params, 'resource')
  if (resource !== null && resource !== server.endpoints.resource) {
    return oauthError(400, 'invalid_target', 'cli.mcp.oauth.error.invalidTarget', {
      resource: server.endpoints.resource,
    })
  }

  const grantType = parameter(params, 'grant_type')
  switch (grantType) {
    case 'authorization_code': {
      const values = requiredParameters(params, [
        'code',
        'client_id',
        'redirect_uri',
        'code_verifier',
      ] as const)
      if (isMissing(values)) return missingParameter(values.missing)
      const outcome = await server.exchangeCode({
        code: values.code,
        clientId: values.client_id,
        redirectUri: values.redirect_uri,
        codeVerifier: values.code_verifier,
      })
      return outcome.kind === 'issued' ? tokenResponse(outcome.tokens) : invalidGrant()
    }
    case 'refresh_token': {
      const values = requiredParameters(params, ['refresh_token', 'client_id'] as const)
      if (isMissing(values)) return missingParameter(values.missing)
      const outcome = await server.refresh({
        refreshToken: values.refresh_token,
        clientId: values.client_id,
      })
      return outcome.kind === 'issued' ? tokenResponse(outcome.tokens) : invalidGrant()
    }
    case null:
      return missingParameter('grant_type')
    default:
      return oauthError(400, 'unsupported_grant_type', 'cli.mcp.oauth.error.unsupportedGrantType')
  }
}
