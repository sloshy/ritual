import { createHash } from 'node:crypto'
import { secretsEqual } from '../../util/secret-compare'

/** RFC 7636 §4.1: a code verifier is 43–128 unreserved characters. */
const CODE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/

/** An S256 challenge is a SHA-256 digest, base64url without padding: 43 characters. */
const S256_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/

/** The one challenge method accepted. `plain` (and an absent method) are refused. */
export const PKCE_METHOD = 'S256'

/** Whether `challenge` has the shape of an S256 code challenge. */
export function isS256Challenge(challenge: string): boolean {
  return S256_CHALLENGE.test(challenge)
}

/** The S256 challenge a verifier hashes to. */
export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/**
 * Whether `verifier` proves possession of the S256 `challenge` recorded at
 * authorization time. A malformed verifier never matches, and the digests are
 * compared in constant time.
 */
export function verifyS256(verifier: string, challenge: string): boolean {
  if (!CODE_VERIFIER.test(verifier)) return false
  return secretsEqual(s256Challenge(verifier), challenge)
}
