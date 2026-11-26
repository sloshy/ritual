import { describe, expect, test } from 'bun:test'
import { buildOAuthProtectedResourceMetadata } from '@modelcontextprotocol/server'
import {
  authorizationServerMetadata,
  isAcceptableIssuer,
  oauthEndpoints,
  resourceMetadataOptions,
} from '../../../../src/mcp/oauth/metadata'
import { parseMcpPublicUrl, type McpPublicUrl } from '../../../../src/mcp/public-url'

function publicUrl(raw: string): McpPublicUrl {
  const parsed = parseMcpPublicUrl(raw)
  if (typeof parsed === 'string') throw new Error(parsed)
  return parsed
}

describe('OAuth metadata', () => {
  const endpoints = oauthEndpoints(publicUrl('https://mcp.example.com:8443/'))

  test('every endpoint sits under the public origin, the resource is <origin>/mcp', () => {
    expect(endpoints).toEqual({
      issuer: 'https://mcp.example.com:8443',
      resource: 'https://mcp.example.com:8443/mcp',
      protectedResourceMetadataUrl:
        'https://mcp.example.com:8443/.well-known/oauth-protected-resource',
      authorizationEndpoint: 'https://mcp.example.com:8443/oauth/authorize',
      tokenEndpoint: 'https://mcp.example.com:8443/oauth/token',
      registrationEndpoint: 'https://mcp.example.com:8443/oauth/register',
    })
  })

  test('the authorization server advertises code + PKCE S256 + public clients only', () => {
    expect(authorizationServerMetadata(endpoints)).toMatchObject({
      issuer: 'https://mcp.example.com:8443',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      registration_endpoint: 'https://mcp.example.com:8443/oauth/register',
    })
  })

  test('the protected resource names exactly the MCP URL and one authorization server', () => {
    expect(
      buildOAuthProtectedResourceMetadata(
        resourceMetadataOptions(endpoints, publicUrl('https://mcp.example.com:8443')),
      ),
    ).toMatchObject({
      resource: 'https://mcp.example.com:8443/mcp',
      authorization_servers: ['https://mcp.example.com:8443'],
    })
  })

  test('an issuer must be https, or http on a loopback host', () => {
    expect(isAcceptableIssuer(publicUrl('https://mcp.example.com'))).toBe(true)
    expect(isAcceptableIssuer(publicUrl('http://127.0.0.1:8765'))).toBe(true)
    expect(isAcceptableIssuer(publicUrl('http://[::1]:8765'))).toBe(true)
    expect(isAcceptableIssuer(publicUrl('http://localhost:8765'))).toBe(true)
    expect(isAcceptableIssuer(publicUrl('http://mcp.example.com'))).toBe(false)
  })
})
