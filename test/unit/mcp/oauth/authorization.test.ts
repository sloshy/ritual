import { describe, expect, test } from 'bun:test'
import {
  clientRedirectUrl,
  validateAuthorizationRequest,
  type AuthorizationRedirectRefusal,
} from '../../../../src/mcp/oauth/authorization'
import type { OAuthClient } from '../../../../src/auth/mcp-oauth/state'
import { CLAUDE_REDIRECT, MCP_RESOURCE, PUBLIC_ORIGIN, pkcePair } from '../../../helpers/oauth'

const CLIENTS: OAuthClient[] = [
  {
    clientId: 'client-1',
    clientName: 'Claude',
    redirectUris: [CLAUDE_REDIRECT, 'http://localhost:33418/callback'],
    createdAt: 0,
  },
]

const { challenge } = pkcePair()

/** A valid request's parameters, with `overrides` applied (`null` removes one). */
function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    response_type: 'code',
    client_id: 'client-1',
    redirect_uri: CLAUDE_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    resource: MCP_RESOURCE,
  }
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries({ ...base, ...overrides })) {
    if (value !== null) search.set(name, value)
  }
  return search
}

function validate(search: URLSearchParams): ReturnType<typeof validateAuthorizationRequest> {
  return validateAuthorizationRequest(search, CLIENTS, MCP_RESOURCE)
}

describe('validateAuthorizationRequest', () => {
  test('accepts a complete request and always grants the mcp scope', () => {
    expect(validate(params({ scope: 'mcp offline_access' }))).toEqual({
      clientId: 'client-1',
      clientName: 'Claude',
      redirectUri: CLAUDE_REDIRECT,
      codeChallenge: challenge,
      state: 'xyz',
      scopes: ['mcp'],
      resource: MCP_RESOURCE,
    })
  })

  test('the resource parameter is optional', () => {
    expect(validate(params({ resource: null }))).toMatchObject({ resource: MCP_RESOURCE })
  })

  test('a loopback redirect keeps the port the client asked for', () => {
    expect(validate(params({ redirect_uri: 'http://localhost:50000/callback' }))).toMatchObject({
      redirectUri: 'http://localhost:50000/callback',
    })
  })

  test.each([
    ['an unknown client', { client_id: 'nope' }],
    ['a missing client', { client_id: null }],
    ['an unregistered redirect URI', { redirect_uri: 'https://evil.example/cb' }],
    ['a prefix of the registered URI', { redirect_uri: 'https://claude.ai/api/mcp' }],
    ['a missing redirect URI', { redirect_uri: null }],
  ])('%s is shown on Ritual’s own page, never redirected', (_label, overrides) => {
    expect(validate(params(overrides))).toEqual({ kind: 'page' })
  })

  test.each([
    ['redirect_uri', 'https://evil.example/cb'],
    ['client_id', 'other-client'],
  ])('a repeated %s is never redirected either', (name, value) => {
    const search = params()
    search.append(name, value)
    expect(validate(search)).toEqual({ kind: 'page' })
  })

  test.each([
    ['no PKCE challenge', { code_challenge: null }, 'invalid_request', 'pkceMissing'],
    ['the plain method', { code_challenge_method: 'plain' }, 'invalid_request', 'pkceMethod'],
    [
      'no method (plain by default)',
      { code_challenge_method: null },
      'invalid_request',
      'pkceMethod',
    ],
    ['a malformed challenge', { code_challenge: 'short' }, 'invalid_request', 'pkceMalformed'],
    [
      'another response type',
      { response_type: 'token' },
      'unsupported_response_type',
      'responseType',
    ],
    ['another resource', { resource: 'https://other.example/mcp' }, 'invalid_target', 'resource'],
  ])('%s is redirected to the client with its state', (_label, overrides, error, detail) => {
    const expected = {
      kind: 'redirect',
      redirectUri: CLAUDE_REDIRECT,
      state: 'xyz',
      error,
      detail,
    } as AuthorizationRedirectRefusal
    expect(validate(params(overrides))).toEqual(expected)
  })

  test('a repeated parameter is refused without echoing the state', () => {
    const repeated = params()
    repeated.append('code_challenge', challenge)
    expect(validate(repeated)).toEqual({
      kind: 'redirect',
      redirectUri: CLAUDE_REDIRECT,
      error: 'invalid_request',
      detail: 'duplicate',
    })
  })

  test('a repeated state is refused as a duplicate, echoing neither value', () => {
    const repeated = params()
    repeated.append('state', 'second')
    expect(validate(repeated)).toEqual({
      kind: 'redirect',
      redirectUri: CLAUDE_REDIRECT,
      error: 'invalid_request',
      detail: 'duplicate',
    })
  })

  test('an over-long state is refused without being echoed', () => {
    expect(validate(params({ state: 'x'.repeat(5000) }))).toEqual({
      kind: 'redirect',
      redirectUri: CLAUDE_REDIRECT,
      error: 'invalid_request',
      detail: 'stateTooLong',
    })
  })
})

describe('clientRedirectUrl', () => {
  test('adds the parameters and the issuer to the redirect URI’s own query', () => {
    const url = new URL(
      clientRedirectUrl('https://app.example/cb?keep=1', PUBLIC_ORIGIN, {
        code: 'c0de',
        state: 'a b&c',
        skipped: undefined,
      }),
    )
    expect(url.origin + url.pathname).toBe('https://app.example/cb')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      keep: '1',
      code: 'c0de',
      state: 'a b&c',
      iss: PUBLIC_ORIGIN,
    })
  })
})
