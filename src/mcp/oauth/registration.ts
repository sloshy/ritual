import { isRecord, isStringArray } from '../../util/json'
import { MAX_CLIENT_NAME_LENGTH, MAX_CLIENTS, MAX_REDIRECT_URIS } from './policy'
import { parseRedirectUri } from './redirect-uri'
import { newSecret, type RandomSource } from './secrets'
import { pruneOAuthState, type OAuthClient, type OAuthState } from '../../auth/mcp-oauth/state'

/** The grant types a client may register for, all of which Ritual supports and issues. */
export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'] as const

/** A registration request that passed validation. */
export type ClientRegistration = {
  redirectUris: string[]
  clientName?: string
}

/**
 * Why a registration body was refused, as RFC 7591 §3.2.2 classifies it, with
 * the reason in `detail` (a code, worded at the HTTP boundary):
 * - `invalid_redirect_uri`: a redirect URI is missing, malformed, or not
 *   `https:` / loopback `http:`;
 * - `invalid_client_metadata`: any other field is unacceptable — a confidential
 *   client, an unsupported grant or response type, an over-long name.
 */
export type RegistrationProblem =
  | { error: 'invalid_redirect_uri'; detail: 'missing' | 'tooMany' | 'invalid' }
  | {
      error: 'invalid_client_metadata'
      detail: 'notObject' | 'authMethod' | 'grantTypes' | 'responseTypes' | 'clientName'
    }

/** A string array, or `undefined` for anything else. */
function stringArray(value: unknown): string[] | undefined {
  return isStringArray(value) ? value : undefined
}

/**
 * Strip the control and format characters a display name has no use for —
 * among them the bidirectional overrides that could make the consent page
 * show one name while meaning another — and trim it.
 */
function cleanName(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
}

/**
 * Validate an RFC 7591 registration body. Only public clients are registered
 * (`token_endpoint_auth_method` absent or `none`); fields Ritual does not use
 * (`client_uri`, `logo_uri`, `scope`, …) are ignored, never stored or echoed.
 */
export function parseClientRegistration(body: unknown): ClientRegistration | RegistrationProblem {
  if (!isRecord(body)) return { error: 'invalid_client_metadata', detail: 'notObject' }
  const raw = body
  const redirectUris = stringArray(raw.redirect_uris)
  if (redirectUris === undefined || redirectUris.length === 0) {
    return { error: 'invalid_redirect_uri', detail: 'missing' }
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    return { error: 'invalid_redirect_uri', detail: 'tooMany' }
  }
  if (redirectUris.some((uri) => typeof parseRedirectUri(uri) !== 'string')) {
    return { error: 'invalid_redirect_uri', detail: 'invalid' }
  }
  if (raw.token_endpoint_auth_method !== undefined && raw.token_endpoint_auth_method !== 'none') {
    return { error: 'invalid_client_metadata', detail: 'authMethod' }
  }
  const grantTypes =
    raw.grant_types === undefined ? ['authorization_code'] : stringArray(raw.grant_types)
  if (
    grantTypes === undefined ||
    grantTypes.length === 0 ||
    !grantTypes.every((type) => (SUPPORTED_GRANT_TYPES as readonly string[]).includes(type))
  ) {
    return { error: 'invalid_client_metadata', detail: 'grantTypes' }
  }
  if (raw.response_types !== undefined) {
    const responseTypes = stringArray(raw.response_types)
    if (responseTypes === undefined || !responseTypes.every((type) => type === 'code')) {
      return { error: 'invalid_client_metadata', detail: 'responseTypes' }
    }
  }
  const registration: ClientRegistration = { redirectUris: [...new Set(redirectUris)] }
  if (raw.client_name !== undefined) {
    if (typeof raw.client_name !== 'string') {
      return { error: 'invalid_client_metadata', detail: 'clientName' }
    }
    const name = cleanName(raw.client_name)
    if (name.length > MAX_CLIENT_NAME_LENGTH) {
      return { error: 'invalid_client_metadata', detail: 'clientName' }
    }
    if (name !== '') registration.clientName = name
  }
  return registration
}

/** Whether {@link parseClientRegistration} refused the body. */
export function isRegistrationProblem(
  value: ClientRegistration | RegistrationProblem,
): value is RegistrationProblem {
  return 'error' in value
}

/**
 * Register a client in `draft`, keeping the registry bounded: stale unused
 * clients are pruned first, and when the registry is still full the oldest
 * client that never obtained a grant makes room — never one in `inUse` (an
 * authorization code outstanding). A registry full of clients that
 * hold grants or are in use refuses (`undefined`).
 */
export function admitClient(
  draft: OAuthState,
  now: number,
  random: RandomSource,
  registration: ClientRegistration,
  inUse: ReadonlySet<string> = new Set(),
): OAuthClient | undefined {
  pruneOAuthState(draft, now, inUse)
  if (draft.clients.length >= MAX_CLIENTS) {
    const unused = draft.clients
      .filter((client) => client.grantedAt === undefined && !inUse.has(client.clientId))
      .sort((a, b) => a.createdAt - b.createdAt)
    const evict = unused[0]
    if (evict === undefined) return undefined
    draft.clients = draft.clients.filter((client) => client !== evict)
  }
  const client: OAuthClient = {
    clientId: newSecret(random),
    redirectUris: registration.redirectUris,
    createdAt: now,
  }
  if (registration.clientName !== undefined) client.clientName = registration.clientName
  draft.clients.push(client)
  return client
}
