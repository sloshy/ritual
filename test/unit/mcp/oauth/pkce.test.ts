import { describe, expect, test } from 'bun:test'
import { isS256Challenge, s256Challenge, verifyS256 } from '../../../../src/mcp/oauth/pkce'

// RFC 7636 Appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('PKCE S256', () => {
  test('hashes the RFC 7636 example verifier to its challenge', () => {
    expect(s256Challenge(VERIFIER)).toBe(CHALLENGE)
    expect(isS256Challenge(CHALLENGE)).toBe(true)
  })

  test('verifies the right verifier and nothing else', () => {
    expect(verifyS256(VERIFIER, CHALLENGE)).toBe(true)
    expect(verifyS256(`${VERIFIER.slice(0, -1)}Y`, CHALLENGE)).toBe(false)
  })

  test('the plain method is no downgrade: the challenge itself is not a verifier for it', () => {
    // Under `plain` the verifier equals the challenge; S256 must refuse that.
    expect(verifyS256(CHALLENGE, CHALLENGE)).toBe(false)
  })

  test.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(129)],
    ['outside the unreserved set', `${'a'.repeat(42)}+`],
  ])('refuses a verifier %s', (_label, verifier) => {
    expect(verifyS256(verifier, s256Challenge(verifier))).toBe(false)
  })

  test('refuses a challenge that is not a 43-character base64url digest', () => {
    expect(isS256Challenge('short')).toBe(false)
    expect(isS256Challenge(`${CHALLENGE}=`)).toBe(false)
    expect(isS256Challenge(CHALLENGE.replace('-', '+'))).toBe(false)
  })
})
