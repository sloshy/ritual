import { describe, expect, test } from 'bun:test'
import {
  emptyOAuthState,
  parseOAuthState,
  pruneOAuthState,
  type OAuthGrant,
  type OAuthState,
  UNUSED_CLIENT_TTL_MS,
} from '../../../../src/auth/mcp-oauth/state'
import { ACCESS_TOKEN_TTL_MS } from '../../../../src/mcp/oauth/policy'

const NOW = 1_800_000_000_000

function grant(overrides: Partial<OAuthGrant> = {}): OAuthGrant {
  return {
    grantId: 'g1',
    clientId: 'c1',
    scopes: ['mcp'],
    resource: 'https://mcp.example.com/mcp',
    credentialFingerprint: 'fp',
    createdAt: NOW,
    refreshTokenHash: 'r-hash',
    refreshExpiresAt: NOW + 1000,
    rotatedRefreshTokens: [{ hash: 'old-r-hash', rotatedAt: NOW - 1 }],
    accessTokens: [{ hash: 'a-hash', expiresAt: NOW + ACCESS_TOKEN_TTL_MS }],
    ...overrides,
  }
}

function state(): OAuthState {
  return {
    version: 1,
    clients: [
      {
        clientId: 'c1',
        clientName: 'Claude',
        redirectUris: ['https://claude.ai/cb'],
        createdAt: NOW,
        grantedAt: NOW,
      },
    ],
    grants: [grant()],
  }
}

describe('parseOAuthState', () => {
  test('round-trips what the store writes', () => {
    const written = state()
    expect(parseOAuthState(JSON.stringify(written))).toEqual(written)
    expect(parseOAuthState(JSON.stringify(emptyOAuthState()))).toEqual(emptyOAuthState())
  })

  test('a file that is not JSON is a problem, not an empty state', () => {
    expect(parseOAuthState('{"version": 1,')).toEqual({ problem: 'json' })
  })

  test('an unknown version is named', () => {
    expect(parseOAuthState('{"version": 2, "clients": [], "grants": []}')).toEqual({
      problem: 'version',
      version: '2',
    })
  })

  test('a malformed field is reported by its path, never by its value', () => {
    const bad = state() as unknown as { grants: Record<string, unknown>[] }
    bad.grants[0]!.refreshTokenHash = 42
    expect(parseOAuthState(JSON.stringify(bad))).toEqual({
      problem: 'shape',
      path: 'grants[0].refreshTokenHash',
    })
  })

  test('a grant whose client is not registered is refused', () => {
    const orphan = { ...state(), grants: [grant({ clientId: 'gone' })] }
    expect(parseOAuthState(JSON.stringify(orphan))).toEqual({
      problem: 'shape',
      path: 'grants[0].clientId',
    })
  })

  test('two clients with one id are refused', () => {
    const twice = state()
    twice.clients.push({ ...twice.clients[0]! })
    twice.grants = []
    expect(parseOAuthState(JSON.stringify(twice))).toEqual({
      problem: 'shape',
      path: 'clients[1].clientId',
    })
  })

  test('two grants with one id are refused', () => {
    const twice = state()
    twice.grants.push(grant({ refreshTokenHash: 'r2', accessTokens: [], rotatedRefreshTokens: [] }))
    expect(parseOAuthState(JSON.stringify(twice))).toEqual({
      problem: 'shape',
      path: 'grants[1].grantId',
    })
  })

  test('a token digest that appears twice anywhere is refused', () => {
    const twice = state()
    twice.grants.push(
      grant({
        grantId: 'g2',
        refreshTokenHash: 'a-hash',
        accessTokens: [],
        rotatedRefreshTokens: [],
      }),
    )
    expect(parseOAuthState(JSON.stringify(twice))).toEqual({
      problem: 'shape',
      path: 'grants[1].refreshTokenHash',
    })
  })

  test('a resource that is not an absolute http(s) URL is refused', () => {
    const bad = { ...state(), grants: [grant({ resource: '/mcp' })] }
    expect(parseOAuthState(JSON.stringify(bad))).toEqual({
      problem: 'shape',
      path: 'grants[0].resource',
    })
  })

  test('a fractional timestamp is refused', () => {
    const bad = { ...state(), grants: [grant({ createdAt: NOW + 0.5 })] }
    expect(parseOAuthState(JSON.stringify(bad))).toEqual({
      problem: 'shape',
      path: 'grants[0].createdAt',
    })
  })
})

describe('pruneOAuthState', () => {
  test('drops expired access tokens and lapsed grants, keeping live ones', () => {
    const draft = state()
    draft.grants.push(grant({ grantId: 'g2', refreshExpiresAt: NOW - 1 }))
    draft.grants[0]!.accessTokens.push({ hash: 'old', expiresAt: NOW - 1 })
    pruneOAuthState(draft, NOW)
    expect(draft.grants.map((g) => g.grantId)).toEqual(['g1'])
    expect(draft.grants[0]!.accessTokens.map((a) => a.hash)).toEqual(['a-hash'])
  })

  test('forgets a client that never obtained a grant after a day, but keeps one that did', () => {
    const draft = state()
    const old = NOW - UNUSED_CLIENT_TTL_MS
    draft.clients = [
      { clientId: 'c1', redirectUris: ['https://a.example/cb'], createdAt: old, grantedAt: old },
      { clientId: 'stale', redirectUris: ['https://a.example/cb'], createdAt: old },
      { clientId: 'fresh', redirectUris: ['https://a.example/cb'], createdAt: NOW - 1 },
    ]
    pruneOAuthState(draft, NOW)
    expect(draft.clients.map((c) => c.clientId)).toEqual(['c1', 'fresh'])
  })

  test('keeps an old unused client that is mid-sign-in, and drops grants whose client is gone', () => {
    const draft = state()
    const old = NOW - UNUSED_CLIENT_TTL_MS
    draft.clients = [
      { clientId: 'busy', redirectUris: ['https://a.example/cb'], createdAt: old },
      { clientId: 'stale', redirectUris: ['https://a.example/cb'], createdAt: old },
    ]
    pruneOAuthState(draft, NOW, new Set(['busy']))
    expect(draft.clients.map((c) => c.clientId)).toEqual(['busy'])
    // The grant named `c1`, which is gone.
    expect(draft.grants).toEqual([])
  })
})
