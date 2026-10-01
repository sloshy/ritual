import { describe, expect, test } from 'bun:test'
import { drawSetupToken, SETUP_TOKEN_ENV, setupUrl } from '../../src/admin/setup-token'

describe('drawSetupToken', () => {
  test('draws a fresh 144-bit token when none is pinned', () => {
    const first = drawSetupToken({})
    expect(first).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(drawSetupToken({})).not.toBe(first)
  })

  test('an empty or blank pin falls back to a random token', () => {
    expect(drawSetupToken({ [SETUP_TOKEN_ENV]: '' })).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(drawSetupToken({ [SETUP_TOKEN_ENV]: '   ' })).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })

  test('a pinned token is used as given, minus surrounding whitespace', () => {
    expect(drawSetupToken({ [SETUP_TOKEN_ENV]: '  provisioning-token \n' })).toBe(
      'provisioning-token',
    )
  })
})

describe('setupUrl', () => {
  test.each([
    ['0.0.0.0', 8080, 'localhost:8080'],
    ['::', 8080, 'localhost:8080'],
    ['192.168.1.20', 9000, '192.168.1.20:9000'],
    ['::1', 9000, '[::1]:9000'],
    ['[::1]', 9000, '[::1]:9000'],
    ['fe80::1%eth0', 9000, '[fe80::1]:9000'],
  ])('a server bound to %s on %d is opened at %s', (host, port, expected) => {
    expect(new URL(setupUrl(host, port)).host).toBe(expected)
  })
})
