import {
  ACCESS_TOKEN_TTL_MS,
  MAX_ROTATED_REFRESH_HASHES,
  REFRESH_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
} from './policy'
import { hashSecret, newSecret, type RandomSource } from './secrets'
import type { OAuthGrant, OAuthState } from '../../auth/mcp-oauth/state'

/**
 * The grant and token rules, as pure changes to an {@link OAuthState} draft
 * (the store persists whatever they leave behind). The clock and the random
 * source are parameters, so every rule is testable without a server.
 */
export type TokenContext = {
  now: number
  random: RandomSource
}

/** What the token endpoint hands a client: the two secrets, shown once. */
export type IssuedTokens = {
  grantId: string
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  scopes: string[]
}

/** The consent a grant is created from: an authorization code's contents, plus its id. */
export type GrantRequest = {
  /** Minted before the store write is queued, so a racing code replay can name it. */
  grantId: string
  clientId: string
  scopes: string[]
  resource: string
  /** The admin credential fingerprint the owner approved with. */
  credentialFingerprint: string
}

/** Mint an access token under `grant`, recording only its digest. */
function mintAccessToken(grant: OAuthGrant, context: TokenContext): string {
  const accessToken = newSecret(context.random)
  grant.accessTokens.push({
    hash: hashSecret(accessToken),
    expiresAt: context.now + ACCESS_TOKEN_TTL_MS,
  })
  return accessToken
}

/** The two-secret result for `grant`, after a fresh refresh token was set on it. */
function issued(grant: OAuthGrant, accessToken: string, refreshToken: string): IssuedTokens {
  return {
    grantId: grant.grantId,
    accessToken,
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_TTL_MS / 1000,
    scopes: [...grant.scopes],
  }
}

/**
 * The outcome of creating a grant: its first tokens, or `clientGone` when the
 * client was pruned or evicted while the code was being exchanged (a grant
 * for it would be an orphan the parser refuses).
 */
export type GrantOutcome = { kind: 'issued'; tokens: IssuedTokens } | { kind: 'clientGone' }

/** Create a grant from a redeemed authorization code and issue its first tokens. */
export function issueGrant(
  draft: OAuthState,
  context: TokenContext,
  request: GrantRequest,
): GrantOutcome {
  const client = draft.clients.find((candidate) => candidate.clientId === request.clientId)
  if (client === undefined) return { kind: 'clientGone' }
  const refreshToken = newSecret(context.random)
  const grant: OAuthGrant = {
    grantId: request.grantId,
    clientId: request.clientId,
    scopes: [...request.scopes],
    resource: request.resource,
    credentialFingerprint: request.credentialFingerprint,
    createdAt: context.now,
    refreshTokenHash: hashSecret(refreshToken),
    refreshExpiresAt: context.now + REFRESH_TOKEN_TTL_MS,
    rotatedRefreshTokens: [],
    accessTokens: [],
  }
  const accessToken = mintAccessToken(grant, context)
  draft.grants.push(grant)
  if (client.grantedAt === undefined) client.grantedAt = context.now
  return { kind: 'issued', tokens: issued(grant, accessToken, refreshToken) }
}

/** A refresh request: the token presented, the client presenting it, and what is current now. */
export type RefreshRequest = {
  refreshToken: string
  clientId: string
} & GrantValidity

/**
 * What a grant must still match to be alive: the MCP URL this server serves
 * and the admin credential fingerprint of `admin-auth.json` now.
 */
export type GrantValidity = {
  resource: string
  credentialFingerprint: string
}

/** Whether `grant` still matches what is current. */
export function isGrantAlive(grant: Readonly<OAuthGrant>, validity: GrantValidity): boolean {
  return (
    grant.resource === validity.resource &&
    grant.credentialFingerprint === validity.credentialFingerprint
  )
}

/**
 * The outcome of presenting a refresh token:
 * - `issued`: it was current; it is now rotated away and new tokens issued;
 * - `invalid`: unknown, expired, another client's, or dead — bound to another
 *   MCP URL or approved under other admin credentials (a dead grant is
 *   dropped: none of its tokens could ever be used again);
 * - `retried`: it is the token rotated away moments ago (within the grace
 *   window), so most likely the same client retrying or refreshing twice at
 *   once; refused, but the grant is kept, since only digests are stored and
 *   the tokens issued then cannot be handed out again;
 * - `replayed`: it was rotated away earlier, which means two parties hold it,
 *   so the grant it belonged to has been revoked whole.
 */
export type RefreshOutcome =
  | { kind: 'issued'; tokens: IssuedTokens }
  | { kind: 'invalid' }
  | { kind: 'retried' }
  | { kind: 'replayed'; grantId: string; clientId: string }

/**
 * Rotate a refresh token. The refresh token's lifetime restarts from `now`
 * (a sliding window), and the presented one joins the grant's rotated list so
 * that presenting it again revokes the grant — unless it is the latest one
 * and comes back within {@link REFRESH_GRACE_MS}.
 */
export function rotateRefreshToken(
  draft: OAuthState,
  context: TokenContext,
  request: RefreshRequest,
): RefreshOutcome {
  const hash = hashSecret(request.refreshToken)
  const grant = draft.grants.find((candidate) => candidate.refreshTokenHash === hash)
  if (grant === undefined) {
    const replayed = draft.grants.find((candidate) =>
      candidate.rotatedRefreshTokens.some((token) => token.hash === hash),
    )
    if (replayed === undefined) return { kind: 'invalid' }
    if (!isGrantAlive(replayed, request)) {
      revokeGrant(draft, replayed.grantId)
      return { kind: 'invalid' }
    }
    const latest = replayed.rotatedRefreshTokens.at(-1)
    if (
      latest?.hash === hash &&
      context.now - latest.rotatedAt < REFRESH_GRACE_MS &&
      replayed.clientId === request.clientId
    ) {
      return { kind: 'retried' }
    }
    revokeGrant(draft, replayed.grantId)
    return { kind: 'replayed', grantId: replayed.grantId, clientId: replayed.clientId }
  }
  if (grant.refreshExpiresAt <= context.now || grant.clientId !== request.clientId) {
    return { kind: 'invalid' }
  }
  if (!isGrantAlive(grant, request)) {
    revokeGrant(draft, grant.grantId)
    return { kind: 'invalid' }
  }
  const refreshToken = newSecret(context.random)
  grant.rotatedRefreshTokens = [
    ...grant.rotatedRefreshTokens,
    { hash, rotatedAt: context.now },
  ].slice(-MAX_ROTATED_REFRESH_HASHES)
  grant.refreshTokenHash = hashSecret(refreshToken)
  grant.refreshExpiresAt = context.now + REFRESH_TOKEN_TTL_MS
  const accessToken = mintAccessToken(grant, context)
  return { kind: 'issued', tokens: issued(grant, accessToken, refreshToken) }
}

/**
 * Drop every dead grant: bound to another MCP URL (the public URL changed) or
 * approved under other admin credentials (the password or TOTP changed).
 * How many went.
 */
export function dropDeadGrants(draft: OAuthState, validity: GrantValidity): number {
  const before = draft.grants.length
  draft.grants = draft.grants.filter((grant) => isGrantAlive(grant, validity))
  return before - draft.grants.length
}

/**
 * Revoke one grant: its refresh token, every access token issued under it,
 * and its rotated history go together. Other grants are untouched. Whether a
 * grant was removed.
 */
export function revokeGrant(draft: OAuthState, grantId: string): boolean {
  const before = draft.grants.length
  draft.grants = draft.grants.filter((grant) => grant.grantId !== grantId)
  return draft.grants.length !== before
}

/** Revoke every grant (clients stay registered). How many were removed. */
export function revokeAllGrants(draft: OAuthState): number {
  const count = draft.grants.length
  draft.grants = []
  return count
}

/** What a live access token stands for, as the MCP endpoint's verifier reads it. */
export type AccessTokenRecord = {
  grantId: string
  clientId: string
  scopes: string[]
  resource: string
  credentialFingerprint: string
  expiresAt: number
}

/** Every access token the state holds, by digest. */
export function indexAccessTokens(state: Readonly<OAuthState>): Map<string, AccessTokenRecord> {
  const index = new Map<string, AccessTokenRecord>()
  for (const grant of state.grants) {
    for (const token of grant.accessTokens) {
      index.set(token.hash, {
        grantId: grant.grantId,
        clientId: grant.clientId,
        scopes: grant.scopes,
        resource: grant.resource,
        credentialFingerprint: grant.credentialFingerprint,
        expiresAt: token.expiresAt,
      })
    }
  }
  return index
}
