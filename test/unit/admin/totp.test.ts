import { describe, test, expect, beforeEach } from 'bun:test'
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  buildTotpUri,
  resetTotpReplayState,
} from '../../../src/admin/totp'

describe('TOTP', () => {
  beforeEach(() => {
    resetTotpReplayState()
  })

  test('base32 encode/decode round-trip', () => {
    const original = new Uint8Array([72, 101, 108, 108, 111])
    const encoded = base32Encode(original)
    const decoded = base32Decode(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(original))
  })

  test('generateTotpSecret returns a base32 string', () => {
    const secret = generateTotpSecret()
    expect(secret.length).toBeGreaterThan(0)
    // All characters should be valid base32
    expect(/^[A-Z2-7]+$/.test(secret)).toBe(true)
  })

  test('generateTotp returns a 6-digit string', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotp(secret)
    expect(code.length).toBe(6)
    expect(/^\d{6}$/.test(code)).toBe(true)
  })

  test('verifyTotp accepts a valid code', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotp(secret)
    const valid = await verifyTotp(secret, code)
    expect(valid).toBe(true)
  })

  test('verifyTotp rejects an invalid code', async () => {
    const secret = generateTotpSecret()
    const valid = await verifyTotp(secret, '000000')
    // This could theoretically pass if 000000 happens to be correct, but extremely unlikely
    // We generate a fresh secret so the chance is negligible
    // If this is flaky, use a fixed secret + known-bad code
    expect(valid).toBe(false)
  })

  test('verifyTotp rejects a code from a different secret', async () => {
    const secret1 = generateTotpSecret()
    const secret2 = generateTotpSecret()
    const code = await generateTotp(secret1)
    const valid = await verifyTotp(secret2, code)
    expect(valid).toBe(false)
  })

  test('buildTotpUri generates a valid otpauth URI', () => {
    const uri = buildTotpUri('JBSWY3DPEHPK3PXP', 'admin', 'Ritual')
    expect(uri).toStartWith('otpauth://totp/')
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=Ritual')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })

  test('verifyTotp rejects replayed code', async () => {
    const secret = generateTotpSecret()
    const code = await generateTotp(secret)
    // First use should succeed
    const first = await verifyTotp(secret, code)
    expect(first).toBe(true)
    // Same code should be rejected (replay)
    const second = await verifyTotp(secret, code)
    expect(second).toBe(false)
  })
})
