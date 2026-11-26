import { afterEach, describe, expect, test } from 'bun:test'
import {
  dropDeadGrants,
  indexAccessTokens,
  issueGrant,
  revokeAllGrants,
  revokeGrant,
  rotateRefreshToken,
  type GrantRequest,
  type IssuedTokens,
  type TokenContext,
} from '../../../../src/mcp/oauth/grants'
import {
  MAX_ROTATED_REFRESH_HASHES,
  REFRESH_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
} from '../../../../src/mcp/oauth/policy'
import { hashSecret } from '../../../../src/mcp/oauth/secrets'
import {
  emptyOAuthState,
  isOAuthStateProblem,
  parseOAuthState,
  type OAuthState,
} from '../../../../src/auth/mcp-oauth/state'
import { MCP_RESOURCE, sequentialRandom } from '../../../helpers/oauth'

const NOW = 1_800_000_000_000
const FINGERPRINT = 'fp-1'
const VALID = { resource: MCP_RESOURCE, credentialFingerprint: FINGERPRINT }

/** Every draft a test changed must still be a file the parser accepts. */
const drafts: OAuthState[] = []
afterEach(() => {
  for (const draft of drafts.splice(0)) {
    expect(isOAuthStateProblem(parseOAuthState(JSON.stringify(draft)))).toBe(false)
  }
})

type Setup = { draft: OAuthState; context: TokenContext }

function setup(): Setup {
  const draft = emptyOAuthState()
  draft.clients.push(
    { clientId: 'c1', redirectUris: ['https://a.example/cb'], createdAt: NOW },
    { clientId: 'c2', redirectUris: ['https://b.example/cb'], createdAt: NOW },
  )
  drafts.push(draft)
  return { draft, context: { now: NOW, random: sequentialRandom() } }
}

let grantCounter = 0
function request(clientId = 'c1'): GrantRequest {
  grantCounter += 1
  return {
    grantId: `grant-${grantCounter}`,
    clientId,
    scopes: ['mcp'],
    resource: MCP_RESOURCE,
    credentialFingerprint: FINGERPRINT,
  }
}

function issue(draft: OAuthState, context: TokenContext, clientId = 'c1'): IssuedTokens {
  const outcome = issueGrant(draft, context, request(clientId))
  if (outcome.kind !== 'issued') throw new Error(`expected issued, got ${outcome.kind}`)
  return outcome.tokens
}

function refresh(draft: OAuthState, context: TokenContext, refreshToken: string, clientId = 'c1') {
  return rotateRefreshToken(draft, context, { refreshToken, clientId, ...VALID })
}

describe('issueGrant', () => {
  test('stores digests only, under the given grant id, and marks the client as granted', () => {
    const { draft, context } = setup()
    const tokens = issue(draft, context)
    const stored = JSON.stringify(draft)
    expect(stored).not.toContain(tokens.accessToken)
    expect(stored).not.toContain(tokens.refreshToken)
    expect(draft.grants[0]!.grantId).toBe(tokens.grantId)
    expect(draft.grants[0]!.refreshTokenHash).toBe(hashSecret(tokens.refreshToken))
    expect(draft.clients[0]!.grantedAt).toBe(NOW)
    expect(draft.clients[1]!.grantedAt).toBeUndefined()
    expect(tokens.expiresInSeconds).toBe(3600)
  })

  test('a client that is gone gets no grant, so no orphan reaches the file', () => {
    const { draft, context } = setup()
    expect(issueGrant(draft, context, request('evicted'))).toEqual({ kind: 'clientGone' })
    expect(draft.grants).toEqual([])
  })

  test('the access token is indexed under its grant, client and audience', () => {
    const { draft, context } = setup()
    const tokens = issue(draft, context)
    expect(indexAccessTokens(draft).get(hashSecret(tokens.accessToken))).toEqual({
      grantId: tokens.grantId,
      clientId: 'c1',
      scopes: ['mcp'],
      resource: MCP_RESOURCE,
      credentialFingerprint: FINGERPRINT,
      expiresAt: NOW + 3_600_000,
    })
  })
})

describe('rotateRefreshToken', () => {
  test('rotates: the new refresh token works, the lifetime slides, a new access token is added', () => {
    const { draft, context } = setup()
    const first = issue(draft, context)
    const later: TokenContext = { ...context, now: NOW + 1000 }
    const outcome = refresh(draft, later, first.refreshToken)
    if (outcome.kind !== 'issued') throw new Error(`expected issued, got ${outcome.kind}`)
    expect(outcome.tokens.refreshToken).not.toBe(first.refreshToken)
    expect(draft.grants[0]!.refreshExpiresAt).toBe(NOW + 1000 + REFRESH_TOKEN_TTL_MS)
    expect(draft.grants[0]!.rotatedRefreshTokens).toEqual([
      { hash: hashSecret(first.refreshToken), rotatedAt: NOW + 1000 },
    ])
    expect(indexAccessTokens(draft).has(hashSecret(outcome.tokens.accessToken))).toBe(true)
    expect(refresh(draft, later, outcome.tokens.refreshToken).kind).toBe('issued')
  })

  test('the token just rotated, back within the grace window, is refused but revokes nothing', () => {
    const { draft, context } = setup()
    const first = issue(draft, context)
    const rotated = refresh(draft, context, first.refreshToken)
    if (rotated.kind !== 'issued') throw new Error('expected issued')
    const retry = refresh(
      draft,
      { ...context, now: NOW + REFRESH_GRACE_MS - 1 },
      first.refreshToken,
    )
    expect(retry).toEqual({ kind: 'retried' })
    expect(draft.grants).toHaveLength(1)
    expect(refresh(draft, context, rotated.tokens.refreshToken).kind).toBe('issued')
  })

  test('after the grace window, presenting a rotated token revokes the whole grant', () => {
    const { draft, context } = setup()
    const first = issue(draft, context)
    const rotated = refresh(draft, context, first.refreshToken)
    if (rotated.kind !== 'issued') throw new Error('expected issued')
    const late: TokenContext = { ...context, now: NOW + REFRESH_GRACE_MS }
    expect(refresh(draft, late, first.refreshToken)).toEqual({
      kind: 'replayed',
      grantId: first.grantId,
      clientId: 'c1',
    })
    expect(draft.grants).toEqual([])
    expect(refresh(draft, late, rotated.tokens.refreshToken)).toEqual({ kind: 'invalid' })
    expect(indexAccessTokens(draft).size).toBe(0)
  })

  test('an older rotated token revokes even inside the window: only the latest gets grace', () => {
    const { draft, context } = setup()
    const first = issue(draft, context)
    const second = refresh(draft, context, first.refreshToken)
    if (second.kind !== 'issued') throw new Error('expected issued')
    expect(refresh(draft, context, second.tokens.refreshToken).kind).toBe('issued')
    expect(refresh(draft, context, first.refreshToken).kind).toBe('replayed')
  })

  test('the grant remembers the last rotated tokens only', () => {
    const { draft, context } = setup()
    let token = issue(draft, context).refreshToken
    const oldest = token
    for (let i = 0; i <= MAX_ROTATED_REFRESH_HASHES; i++) {
      const outcome = refresh(draft, context, token)
      if (outcome.kind !== 'issued') throw new Error('expected issued')
      token = outcome.tokens.refreshToken
    }
    expect(draft.grants[0]!.rotatedRefreshTokens).toHaveLength(MAX_ROTATED_REFRESH_HASHES)
    // Forgotten, so merely unknown: the grant survives.
    expect(refresh(draft, context, oldest)).toEqual({ kind: 'invalid' })
    expect(draft.grants).toHaveLength(1)
  })

  test('refuses an unknown token, an expired one, and another client presenting it', () => {
    const { draft, context } = setup()
    const tokens = issue(draft, context)
    expect(refresh(draft, context, 'nope')).toEqual({ kind: 'invalid' })
    expect(refresh(draft, context, tokens.refreshToken, 'c2')).toEqual({ kind: 'invalid' })
    const expired: TokenContext = { ...context, now: NOW + REFRESH_TOKEN_TTL_MS }
    expect(refresh(draft, expired, tokens.refreshToken)).toEqual({ kind: 'invalid' })
  })

  test('a grant bound to another MCP URL is refused and dropped', () => {
    const { draft, context } = setup()
    const tokens = issue(draft, context)
    const moved = rotateRefreshToken(draft, context, {
      refreshToken: tokens.refreshToken,
      clientId: 'c1',
      ...VALID,
      resource: 'https://moved.example.com/mcp',
    })
    expect(moved).toEqual({ kind: 'invalid' })
    expect(draft.grants).toEqual([])
  })
})

describe('revocation', () => {
  test('revoking one grant leaves another grant’s tokens working', () => {
    const { draft, context } = setup()
    const one = issue(draft, context)
    const two = issue(draft, context, 'c2')
    expect(revokeGrant(draft, one.grantId)).toBe(true)
    const index = indexAccessTokens(draft)
    expect(index.has(hashSecret(one.accessToken))).toBe(false)
    expect(index.get(hashSecret(two.accessToken))?.clientId).toBe('c2')
    expect(revokeGrant(draft, one.grantId)).toBe(false)
  })

  test('revokeAllGrants empties the grants and keeps the clients', () => {
    const { draft, context } = setup()
    issue(draft, context)
    issue(draft, context, 'c2')
    expect(revokeAllGrants(draft)).toBe(2)
    expect(draft.grants).toEqual([])
    expect(draft.clients).toHaveLength(2)
  })

  test('a grant approved under other admin credentials is refused and dropped on refresh', () => {
    const { draft, context } = setup()
    const tokens = issue(draft, context)
    const changed = rotateRefreshToken(draft, context, {
      refreshToken: tokens.refreshToken,
      clientId: 'c1',
      ...VALID,
      credentialFingerprint: 'fp-2',
    })
    expect(changed).toEqual({ kind: 'invalid' })
    expect(draft.grants).toEqual([])
  })

  test('dropDeadGrants keeps only grants for the MCP URL and credentials now current', () => {
    const { draft, context } = setup()
    issue(draft, context)
    const live = draft.grants[0]!
    draft.grants.push(
      {
        ...live,
        grantId: 'moved',
        resource: 'https://old.example/mcp',
        refreshTokenHash: 'x',
        accessTokens: [],
      },
      {
        ...live,
        grantId: 'reset',
        credentialFingerprint: 'fp-0',
        refreshTokenHash: 'y',
        accessTokens: [],
      },
    )
    expect(dropDeadGrants(draft, VALID)).toBe(2)
    expect(draft.grants.map((g) => g.grantId)).toEqual([live.grantId])
  })
})
