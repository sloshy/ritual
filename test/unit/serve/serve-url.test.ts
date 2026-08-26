import { describe, expect, test } from 'bun:test'
import { serveUrl } from '../../../src/serve/static'

/**
 * The startup line used to say `http://localhost:<port>` whatever `--host` was,
 * naming an address the server is not listening on.
 */
describe('serveUrl', () => {
  test('a wildcard or loopback bind prints the clickable localhost form', () => {
    expect(serveUrl('0.0.0.0', 3000)).toBe('http://localhost:3000')
    expect(serveUrl('127.0.0.1', 3000)).toBe('http://localhost:3000')
    expect(serveUrl('::', 3000)).toBe('http://localhost:3000')
    expect(serveUrl(undefined, 3000)).toBe('http://localhost:3000')
  })

  test('a specific host prints the address the server actually bound', () => {
    expect(serveUrl('192.168.1.5', 8080)).toBe('http://192.168.1.5:8080')
    expect(serveUrl('example.internal', 80)).toBe('http://example.internal:80')
  })

  test('a bare IPv6 literal is bracketed', () => {
    expect(serveUrl('fd00::1', 3000)).toBe('http://[fd00::1]:3000')
  })
})
