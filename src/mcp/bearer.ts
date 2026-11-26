import type { AuthInfo } from '@modelcontextprotocol/server'
import { secretsEqual } from '../util/secret-compare'

/**
 * How a request to `/mcp` was authenticated: allowed (with the OAuth token's
 * details when an access token was used), or refused, with the
 * `WWW-Authenticate` challenge to send when the OAuth server is on.
 */
export type McpAuthentication =
  { ok: true; authInfo?: AuthInfo } | { ok: false; challenge?: string }

/** Authenticates one request to `/mcp`. */
export type McpAuthenticator = (request: Request) => Promise<McpAuthentication>

/** Whether an `Authorization` header carries exactly the static bearer `token`, compared in constant time. */
export function bearerMatches(header: string | null, token: string): boolean {
  return secretsEqual(header ?? '', `Bearer ${token}`)
}
