import { describe, expect, test } from 'bun:test'
import {
  matchRedirectUri,
  parseRedirectUri,
  type RedirectUriProblem,
} from '../../../../src/mcp/oauth/redirect-uri'

describe('parseRedirectUri', () => {
  test.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://claude.com/api/mcp/auth_callback',
    'http://localhost:33418/callback',
    'http://127.0.0.1:9000/cb?x=1',
    'http://[::1]:9000/cb',
  ])('accepts %p as given', (uri) => {
    expect(parseRedirectUri(uri)).toBe(uri)
  })

  test.each<[string, RedirectUriProblem]>([
    ['javascript:alert(1)', 'scheme'],
    ['data:text/html,<script>alert(1)</script>', 'scheme'],
    ['com.example.app:/callback', 'scheme'],
    ['claude://callback', 'scheme'],
    // Plain http anywhere but this machine is refused.
    ['http://evil.example/cb', 'scheme'],
    ['http://127.0.0.1.evil.example/cb', 'scheme'],
    ['https://claude.ai/cb#frag', 'fragment'],
    ['https://claude.ai/cb#', 'fragment'],
    ['https://user:pw@claude.ai/cb', 'credentials'],
    ['/relative/path', 'invalid'],
    ['', 'invalid'],
    [`https://claude.ai/${'a'.repeat(2100)}`, 'invalid'],
  ])('refuses %p (%s)', (uri, problem) => {
    expect(parseRedirectUri(uri)).toEqual({ problem })
  })
})

describe('matchRedirectUri', () => {
  const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost:33418/callback']

  test('matches an exactly registered URI', () => {
    expect(matchRedirectUri(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(
      'https://claude.ai/api/mcp/auth_callback',
    )
  })

  test.each([
    // Prefix and suffix variants are not the registered URI.
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback/../evil',
    'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
    'https://claude.ai/api/mcp',
    'https://claude.ai.evil.example/api/mcp/auth_callback',
    // No case folding on an https URI.
    'https://CLAUDE.ai/api/mcp/auth_callback',
    'https://claude.ai:443/api/mcp/auth_callback',
    'https://evil.example/api/mcp/auth_callback',
  ])('does not match %p', (uri) => {
    expect(matchRedirectUri(registered, uri)).toBeUndefined()
  })

  test('a loopback redirect matches whatever its port', () => {
    expect(matchRedirectUri(registered, 'http://localhost:51234/callback')).toBe(
      'http://localhost:33418/callback',
    )
  })

  test.each([
    // Only the port is forgiven: path, host and query must be identical.
    'http://localhost:51234/other',
    'http://localhost:51234/callback?x=1',
    'http://127.0.0.1:51234/callback',
    // A non-canonical spelling is not forgiven along with the port.
    'http://LOCALHOST:51234/callback',
    'http://localhost:51234/./callback',
    // The port rule is for http loopback only.
    'https://localhost:51234/callback',
  ])('a loopback redirect still does not match %p', (uri) => {
    expect(matchRedirectUri(registered, uri)).toBeUndefined()
  })

  test('an invalid requested URI never matches, even when registered verbatim', () => {
    expect(matchRedirectUri(['javascript:alert(1)'], 'javascript:alert(1)')).toBeUndefined()
  })
})
