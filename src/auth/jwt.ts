type JwtClaims = {
  exp?: number
  iat?: number
  token_type?: string
}

/**
 * Decode a JWT's payload segment without verifying its signature.
 *
 * This is intentionally a best-effort *reader*, not a validator: it returns
 * `null` for anything that is not a well-formed three-segment JWT with a JSON
 * payload, rather than throwing. Callers use it to inspect non-sensitive claims
 * (e.g. `exp`) on tokens that were already trusted when stored.
 */
export function decodeJwtPayload(token: string): JwtClaims | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) {
    return null
  }
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf-8')
    const claims: unknown = JSON.parse(json)
    if (typeof claims !== 'object' || claims === null) {
      return null
    }
    return claims
  } catch {
    return null
  }
}

/**
 * Extract a JWT's expiration as a `Date`, or `null` when the token has no
 * decodable `exp` claim. The `exp` claim is seconds since the Unix epoch.
 */
export function getJwtExpiration(token: string): Date | null {
  const claims = decodeJwtPayload(token)
  if (!claims || typeof claims.exp !== 'number') {
    return null
  }
  return new Date(claims.exp * 1000)
}
