import type { ParameterlessKey } from '../../i18n/t'
import { addressKey } from '../../util/address-key'
import type { OAuthAuthorizationServer } from './authorization-server'
import {
  MAX_CLIENT_NAME_LENGTH,
  MAX_REDIRECT_URIS,
  MAX_REGISTRATIONS_PER_WINDOW,
  REGISTRATION_WINDOW_MINUTES,
} from './policy'
import {
  SUPPORTED_GRANT_TYPES,
  isRegistrationProblem,
  parseClientRegistration,
  type RegistrationProblem,
} from './registration'
import { isBodyProblem, readJson } from './request-body'
import { methodNotAllowed, noStoreJson, oauthError, preflight } from './responses'

/** The RFC 7591 §3.2.1 registration response. */
export type ClientRegistrationResponse = {
  client_id: string
  client_id_issued_at: number
  client_name?: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: 'none'
}

const ALLOW = 'POST, OPTIONS'

/** The English description of a refused registration. */
function registrationRefusal(problem: RegistrationProblem): Response {
  switch (problem.detail) {
    case 'missing':
      return oauthError(400, problem.error, 'cli.mcp.oauth.error.registration.redirectUrisMissing')
    case 'tooMany':
      return oauthError(
        400,
        problem.error,
        'cli.mcp.oauth.error.registration.redirectUrisTooMany',
        {
          max: MAX_REDIRECT_URIS,
        },
      )
    case 'invalid':
      return oauthError(400, problem.error, 'cli.mcp.oauth.error.registration.redirectUriInvalid')
    case 'clientName':
      return oauthError(400, problem.error, 'cli.mcp.oauth.error.registration.clientName', {
        max: MAX_CLIENT_NAME_LENGTH,
      })
    case 'notObject':
    case 'authMethod':
    case 'grantTypes':
    case 'responseTypes': {
      const keys: Record<typeof problem.detail, ParameterlessKey> = {
        notObject: 'cli.mcp.oauth.error.registration.notObject',
        authMethod: 'cli.mcp.oauth.error.registration.authMethod',
        grantTypes: 'cli.mcp.oauth.error.registration.grantTypes',
        responseTypes: 'cli.mcp.oauth.error.registration.responseTypes',
      }
      return oauthError(400, problem.error, keys[problem.detail])
    }
    default:
      return problem satisfies never
  }
}

/**
 * `POST /oauth/register`: RFC 7591 dynamic client registration for public
 * clients. Unauthenticated, so bounded on every side: the body budget, a
 * per-address rate limit (every attempt counts, accepted or not), and the
 * registry cap and pruning in `admitClient`.
 */
export async function handleRegister(
  server: OAuthAuthorizationServer,
  request: Request,
  clientIp: string,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight(ALLOW)
  if (request.method !== 'POST') return methodNotAllowed(ALLOW)
  const limiter = server.registrationLimiter
  const address = addressKey(clientIp)
  if (limiter.isLocked(address)) {
    const refusal = oauthError(
      429,
      'temporarily_unavailable',
      'cli.mcp.oauth.error.registration.rateLimited',
    )
    refusal.headers.set('Retry-After', String(limiter.getRemainingLockSeconds(address)))
    return refusal
  }
  limiter.recordFailure(address, MAX_REGISTRATIONS_PER_WINDOW, REGISTRATION_WINDOW_MINUTES)

  const read = await readJson(request)
  if (isBodyProblem(read)) {
    return read.problem === 'tooLarge'
      ? oauthError(413, 'invalid_client_metadata', 'cli.mcp.oauth.error.bodyTooLarge')
      : oauthError(400, 'invalid_client_metadata', 'cli.mcp.oauth.error.registration.notJson')
  }
  const registration = parseClientRegistration(read.json)
  if (isRegistrationProblem(registration)) return registrationRefusal(registration)

  const client = await server.register(registration)
  if (client === undefined) {
    return oauthError(503, 'temporarily_unavailable', 'cli.mcp.oauth.error.registration.full')
  }
  const response: ClientRegistrationResponse = {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt / 1000),
    redirect_uris: client.redirectUris,
    // Every client gets refresh tokens, so every client is told so.
    grant_types: [...SUPPORTED_GRANT_TYPES],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
  if (client.clientName !== undefined) response.client_name = client.clientName
  return noStoreJson(response, 201)
}
