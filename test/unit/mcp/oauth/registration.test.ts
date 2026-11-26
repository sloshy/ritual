import { describe, expect, test } from 'bun:test'
import { MAX_CLIENTS } from '../../../../src/mcp/oauth/policy'
import {
  admitClient,
  parseClientRegistration,
  type RegistrationProblem,
} from '../../../../src/mcp/oauth/registration'
import { emptyOAuthState } from '../../../../src/auth/mcp-oauth/state'
import { CLAUDE_REDIRECT, sequentialRandom } from '../../../helpers/oauth'

const NOW = 1_800_000_000_000

describe('parseClientRegistration', () => {
  test('accepts what Claude sends, keeping only what Ritual uses', () => {
    expect(
      parseClientRegistration({
        client_name: 'Claude',
        redirect_uris: [CLAUDE_REDIRECT, CLAUDE_REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        logo_uri: 'https://claude.ai/logo.png',
      }),
    ).toEqual({
      clientName: 'Claude',
      redirectUris: [CLAUDE_REDIRECT],
    })
  })

  test('defaults the grant types and drops control and bidi-override characters from the name', () => {
    expect(
      parseClientRegistration({
        redirect_uris: [CLAUDE_REDIRECT],
        client_name: ' Ev\u202eil\u0007 ',
      }),
    ).toEqual({ redirectUris: [CLAUDE_REDIRECT], clientName: 'Evil' })
  })

  test('refuses a body that is not an object', () => {
    for (const body of [[], null, 'text', 42]) {
      expect(parseClientRegistration(body)).toEqual({
        error: 'invalid_client_metadata',
        detail: 'notObject',
      })
    }
  })

  test.each([
    [{}, 'invalid_redirect_uri', 'missing'],
    [{ redirect_uris: [] }, 'invalid_redirect_uri', 'missing'],
    [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri', 'invalid'],
    [
      { redirect_uris: [CLAUDE_REDIRECT, 'http://evil.example/cb'] },
      'invalid_redirect_uri',
      'invalid',
    ],
    [
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `${CLAUDE_REDIRECT}${i}`) },
      'invalid_redirect_uri',
      'tooMany',
    ],
    [
      { redirect_uris: [CLAUDE_REDIRECT], token_endpoint_auth_method: 'client_secret_post' },
      'invalid_client_metadata',
      'authMethod',
    ],
    [
      { redirect_uris: [CLAUDE_REDIRECT], grant_types: ['client_credentials'] },
      'invalid_client_metadata',
      'grantTypes',
    ],
    [
      { redirect_uris: [CLAUDE_REDIRECT], response_types: ['token'] },
      'invalid_client_metadata',
      'responseTypes',
    ],
    [
      { redirect_uris: [CLAUDE_REDIRECT], client_name: 'x'.repeat(201) },
      'invalid_client_metadata',
      'clientName',
    ],
    [
      { redirect_uris: [CLAUDE_REDIRECT], client_name: 42 },
      'invalid_client_metadata',
      'clientName',
    ],
  ])('refuses %j', (body, error, detail) => {
    const expected = { error, detail } as RegistrationProblem
    expect(parseClientRegistration(body)).toEqual(expected)
  })
})

describe('admitClient', () => {
  const registration = { redirectUris: [CLAUDE_REDIRECT] }

  test('registers a client with a fresh random id', () => {
    const draft = emptyOAuthState()
    const random = sequentialRandom()
    const one = admitClient(draft, NOW, random, registration)
    const two = admitClient(draft, NOW, random, registration)
    expect(one?.clientId).not.toBe(two?.clientId)
    expect(draft.clients).toHaveLength(2)
  })

  /** A full registry whose array order is the reverse of its age order. */
  function fullRegistry(): ReturnType<typeof emptyOAuthState> {
    const draft = emptyOAuthState()
    for (let i = 0; i < MAX_CLIENTS; i++) {
      draft.clients.push({
        clientId: `c${i}`,
        redirectUris: [CLAUDE_REDIRECT],
        // c99 is the oldest, c0 the newest.
        createdAt: NOW - 1000 - i,
      })
    }
    return draft
  }

  test('a full registry evicts its oldest never-granted client, by age not position', () => {
    const draft = fullRegistry()
    draft.clients[99]!.grantedAt = NOW
    expect(admitClient(draft, NOW, sequentialRandom(), registration)).toBeDefined()
    const ids = draft.clients.map((c) => c.clientId)
    expect(draft.clients).toHaveLength(MAX_CLIENTS)
    // c99 holds a grant, so c98 (the oldest without one) made room.
    expect(ids).toContain('c99')
    expect(ids).not.toContain('c98')
    expect(ids).toContain('c0')
  })

  test('a client in the middle of a sign-in is never the one evicted', () => {
    const draft = fullRegistry()
    expect(
      admitClient(draft, NOW, sequentialRandom(), registration, new Set(['c99'])),
    ).toBeDefined()
    const ids = draft.clients.map((c) => c.clientId)
    expect(ids).toContain('c99')
    expect(ids).not.toContain('c98')
  })

  test('a client in use survives pruning past the unused-client age', () => {
    const draft = emptyOAuthState()
    draft.clients.push({ clientId: 'old', redirectUris: [CLAUDE_REDIRECT], createdAt: 0 })
    admitClient(draft, NOW, sequentialRandom(), registration, new Set(['old']))
    expect(draft.clients.map((c) => c.clientId)).toContain('old')
    admitClient(draft, NOW, sequentialRandom(), registration)
    expect(draft.clients.map((c) => c.clientId)).not.toContain('old')
  })

  test('a registry full of clients holding grants refuses', () => {
    const draft = emptyOAuthState()
    for (let i = 0; i < MAX_CLIENTS; i++) {
      draft.clients.push({
        clientId: `c${i}`,
        redirectUris: [CLAUDE_REDIRECT],
        createdAt: NOW,
        grantedAt: NOW,
      })
    }
    expect(admitClient(draft, NOW, sequentialRandom(), registration)).toBeUndefined()
    expect(draft.clients).toHaveLength(MAX_CLIENTS)
  })
})
