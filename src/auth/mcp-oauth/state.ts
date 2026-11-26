import { isRecord } from '../../util/json'
import { parseHttpUrl } from '../../util/http-url'

/**
 * The embedded authorization server's persisted state: `.logins/mcp-oauth.json`.
 *
 * New state beside `admin-auth.json`, not a workspace format: it is never
 * committed (the folder ignores itself) and deleting the file revokes every
 * client and grant at once. Only SHA-256 digests of tokens are stored, never a
 * token itself. Times are epoch milliseconds.
 */
export type OAuthState = {
  version: typeof OAUTH_STATE_VERSION
  clients: OAuthClient[]
  grants: OAuthGrant[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A registered client that never obtained a grant is forgotten after this long. */
export const UNUSED_CLIENT_TTL_MS = DAY_MS

/** The only state-file version this release reads and writes. */
export const OAUTH_STATE_VERSION = 1

/** A client registered through dynamic client registration. Always public. */
export type OAuthClient = {
  clientId: string
  /** The `client_name` it registered with, shown on the consent page. */
  clientName?: string
  /** Its redirect URIs, exactly as registered. */
  redirectUris: string[]
  createdAt: number
  /** When it first obtained a grant; unset for a client that never did. */
  grantedAt?: number
}

/** A live access token, by digest. */
export type OAuthAccessToken = {
  hash: string
  expiresAt: number
}

/**
 * One consent, as the token endpoint carries it forward: the current refresh
 * token, the access tokens issued under it, and the refresh tokens it has
 * already rotated away. Revoking the grant removes all of them together.
 */
export type OAuthGrant = {
  grantId: string
  clientId: string
  scopes: string[]
  /** The audience every token of this grant is bound to: the public `/mcp` URL. */
  resource: string
  /**
   * The admin credential fingerprint the owner approved it with; a grant whose
   * fingerprint no longer matches `admin-auth.json` is dead (see
   * `credential-fingerprint.ts`).
   */
  credentialFingerprint: string
  createdAt: number
  refreshTokenHash: string
  refreshExpiresAt: number
  /** Refresh tokens already rotated away, most recent last. */
  rotatedRefreshTokens: OAuthRotatedToken[]
  accessTokens: OAuthAccessToken[]
}

/**
 * A refresh token that was rotated away, by digest, and when. The time is what
 * tells a client's retry of the refresh it just made (inside the grace window)
 * from a stolen token used later.
 */
export type OAuthRotatedToken = {
  hash: string
  rotatedAt: number
}

/**
 * Why a state file could not be read: not JSON, a version this release does
 * not know, or a value of the wrong shape at `path` (a field path such as
 * `grants[0].refreshTokenHash`, never a value from the file).
 */
export type OAuthStateProblem =
  { problem: 'json' } | { problem: 'version'; version: string } | { problem: 'shape'; path: string }

/** The state of a server that has registered nothing yet. */
export function emptyOAuthState(): OAuthState {
  return { version: OAUTH_STATE_VERSION, clients: [], grants: [] }
}

/** Thrown inside the parser to unwind to its single `catch`; never escapes it. */
class ShapeError extends Error {
  constructor(readonly path: string) {
    super(path)
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ShapeError(path)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') throw new ShapeError(path)
  return value
}

function time(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ShapeError(path)
  }
  return value
}

function absoluteUrl(value: unknown, path: string): string {
  const text = string(value, path)
  if (!(parseHttpUrl(text) instanceof URL)) throw new ShapeError(path)
  return text
}

function array<T>(value: unknown, path: string, item: (value: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) throw new ShapeError(path)
  return value.map((entry, index) => item(entry, `${path}[${index}]`))
}

function parseClient(value: unknown, path: string): OAuthClient {
  const raw = object(value, path)
  const client: OAuthClient = {
    clientId: string(raw.clientId, `${path}.clientId`),
    redirectUris: array(raw.redirectUris, `${path}.redirectUris`, string),
    createdAt: time(raw.createdAt, `${path}.createdAt`),
  }
  if (raw.clientName !== undefined) {
    client.clientName = string(raw.clientName, `${path}.clientName`)
  }
  if (raw.grantedAt !== undefined) client.grantedAt = time(raw.grantedAt, `${path}.grantedAt`)
  return client
}

function parseAccessToken(value: unknown, path: string): OAuthAccessToken {
  const raw = object(value, path)
  return {
    hash: string(raw.hash, `${path}.hash`),
    expiresAt: time(raw.expiresAt, `${path}.expiresAt`),
  }
}

function parseRotated(value: unknown, path: string): OAuthRotatedToken {
  const raw = object(value, path)
  return {
    hash: string(raw.hash, `${path}.hash`),
    rotatedAt: time(raw.rotatedAt, `${path}.rotatedAt`),
  }
}

function parseGrant(value: unknown, path: string): OAuthGrant {
  const raw = object(value, path)
  return {
    grantId: string(raw.grantId, `${path}.grantId`),
    clientId: string(raw.clientId, `${path}.clientId`),
    scopes: array(raw.scopes, `${path}.scopes`, string),
    resource: absoluteUrl(raw.resource, `${path}.resource`),
    credentialFingerprint: string(raw.credentialFingerprint, `${path}.credentialFingerprint`),
    createdAt: time(raw.createdAt, `${path}.createdAt`),
    refreshTokenHash: string(raw.refreshTokenHash, `${path}.refreshTokenHash`),
    refreshExpiresAt: time(raw.refreshExpiresAt, `${path}.refreshExpiresAt`),
    rotatedRefreshTokens: array(
      raw.rotatedRefreshTokens,
      `${path}.rotatedRefreshTokens`,
      parseRotated,
    ),
    accessTokens: array(raw.accessTokens, `${path}.accessTokens`, parseAccessToken),
  }
}

/**
 * The first path at which a value repeats in `entries`, which must be unique
 * across the whole file (client ids, grant ids, token digests).
 */
function firstRepeat(entries: readonly (readonly [string, string])[]): string | undefined {
  const seen = new Set<string>()
  for (const [value, path] of entries) {
    if (seen.has(value)) return path
    seen.add(value)
  }
  return undefined
}

/** Every token digest in the grants, with the path it sits at. */
function tokenDigests(grants: readonly OAuthGrant[]): [string, string][] {
  return grants.flatMap((grant, g) => [
    [grant.refreshTokenHash, `grants[${g}].refreshTokenHash`] as [string, string],
    ...grant.rotatedRefreshTokens.map(
      (token, i) =>
        [token.hash, `grants[${g}].rotatedRefreshTokens[${i}].hash`] as [string, string],
    ),
    ...grant.accessTokens.map(
      (token, i) => [token.hash, `grants[${g}].accessTokens[${i}].hash`] as [string, string],
    ),
  ])
}

/**
 * Parse a state file's text. Any deviation is a problem, never a silent
 * reset: a damaged file would otherwise disconnect every client without a
 * word, and the operator's remedy (delete the file) is the same either way.
 * A grant naming a client the file does not register, and a client id, grant
 * id or token digest that appears twice, are shape problems too.
 */
export function parseOAuthState(text: string): OAuthState | OAuthStateProblem {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { problem: 'json' }
  }
  try {
    const root = object(raw, '$')
    if (root.version !== OAUTH_STATE_VERSION) {
      return { problem: 'version', version: String(root.version) }
    }
    const clients = array(root.clients, 'clients', parseClient)
    const grants = array(root.grants, 'grants', parseGrant)
    const repeated =
      firstRepeat(clients.map((client, i) => [client.clientId, `clients[${i}].clientId`])) ??
      firstRepeat(grants.map((grant, i) => [grant.grantId, `grants[${i}].grantId`])) ??
      firstRepeat(tokenDigests(grants))
    if (repeated !== undefined) return { problem: 'shape', path: repeated }
    const clientIds = new Set(clients.map((client) => client.clientId))
    const orphan = grants.findIndex((grant) => !clientIds.has(grant.clientId))
    if (orphan !== -1) return { problem: 'shape', path: `grants[${orphan}].clientId` }
    return { version: OAUTH_STATE_VERSION, clients, grants }
  } catch (error) {
    if (error instanceof ShapeError) return { problem: 'shape', path: error.path }
    throw error
  }
}

/** Whether a parse result is a problem rather than a state. */
export function isOAuthStateProblem(
  value: OAuthState | OAuthStateProblem,
): value is OAuthStateProblem {
  return 'problem' in value
}

/**
 * Drop what has expired, in place: access tokens past their lifetime, grants
 * whose refresh token has lapsed, clients that registered more than a day ago
 * without ever obtaining a grant, and any grant whose client is gone. A client
 * that once held a grant is kept (a client caches its registration and would
 * otherwise find itself unknown), and so is every client in `inUse`: one with
 * a consent page open or an authorization code outstanding.
 */
export function pruneOAuthState(
  state: OAuthState,
  now: number,
  inUse: ReadonlySet<string> = new Set(),
): void {
  state.clients = state.clients.filter(
    (client) =>
      client.grantedAt !== undefined ||
      inUse.has(client.clientId) ||
      now - client.createdAt < UNUSED_CLIENT_TTL_MS,
  )
  const clientIds = new Set(state.clients.map((client) => client.clientId))
  state.grants = state.grants.filter(
    (grant) => grant.refreshExpiresAt > now && clientIds.has(grant.clientId),
  )
  for (const grant of state.grants) {
    grant.accessTokens = grant.accessTokens.filter((token) => token.expiresAt > now)
  }
}
