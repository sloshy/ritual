import { describe, expect, test } from 'bun:test'
import { isCrossSiteRequest } from '../../../src/admin/same-origin'
import { lastForwarded } from '../../../src/admin/forwarded'

/** A request to the admin at `http://admin.test:8080`, as a browser or script would send it. */
function request(method: string, headers: Record<string, string>, url?: string): Request {
  return new Request(url ?? 'http://admin.test:8080/api/deck/x/save', { method, headers })
}

describe('isCrossSiteRequest', () => {
  // The browser's own verdict wins over `Origin`, so a proxy that rewrites the
  // host cannot make the admin page's requests look foreign.
  test.each([
    ['same-origin', false],
    ['SAME-ORIGIN', false],
    ['none', false],
    ['same-site', true],
    ['cross-site', true],
  ] as const)('Sec-Fetch-Site: %s refused → %p', (site, refused) => {
    const req = request('POST', { 'Sec-Fetch-Site': site, Origin: 'https://elsewhere.example' })
    expect(isCrossSiteRequest(req, false)).toBe(refused)
  })

  // A few GET routes act (the sync, cache-refresh and build streams), so a
  // read is judged by the same rule as a write.
  test('a GET from another site is refused too', () => {
    expect(isCrossSiteRequest(request('GET', { 'Sec-Fetch-Site': 'same-site' }), false)).toBe(true)
    expect(isCrossSiteRequest(request('GET', { 'Sec-Fetch-Site': 'same-origin' }), false)).toBe(
      false,
    )
  })

  test.each([
    ['the same host', 'http://admin.test:8080', false],
    ['the same host over HTTPS (a proxy terminating TLS)', 'https://admin.test:8080', false],
    ['another port', 'http://admin.test:9090', true],
    ['another host', 'http://evil.example', true],
    ['an opaque origin', 'null', true],
    ['a malformed value', 'not a url', true],
  ] as const)('without Sec-Fetch-Site, an Origin of %s refused → %p', (_name, origin, refused) => {
    expect(isCrossSiteRequest(request('DELETE', { Origin: origin }), false)).toBe(refused)
  })

  test('a request with neither header (a script, not a browser) passes', () => {
    expect(isCrossSiteRequest(request('PUT', {}), false)).toBe(false)
  })

  // The `Host` header names what the browser addressed, not the URL the
  // server was reached at.
  test('compares against the Host header, not the URL', () => {
    const req = request(
      'POST',
      { Host: 'admin.test:8080', Origin: 'http://admin.test:8080' },
      'http://internal:1/api/logout',
    )
    expect(isCrossSiteRequest(req, false)).toBe(false)
  })

  // An `Origin` never spells a default port; a `Host` header may.
  test('a default port in the Host header counts as no port', () => {
    const req = request('POST', {
      Host: 'admin.example.com:443',
      Origin: 'https://admin.example.com',
    })
    expect(isCrossSiteRequest(req, false)).toBe(false)
  })

  // Behind a proxy that forwards to the admin's own address, the host the
  // browser addressed is the proxy's `X-Forwarded-Host` — trusted only when
  // `admin.trustProxy` says a proxy is there.
  test('reads the forwarded host only under trustProxy', () => {
    const proxied = () =>
      request('PATCH', {
        Host: '127.0.0.1:8080',
        'X-Forwarded-Host': 'spoofed.example, admin.example.com',
        Origin: 'https://admin.example.com',
      })
    expect(isCrossSiteRequest(proxied(), true)).toBe(false)
    expect(isCrossSiteRequest(proxied(), false)).toBe(true)
  })
})

describe('lastForwarded', () => {
  test.each([
    [null, null],
    ['', null],
    ['10.0.0.1', '10.0.0.1'],
    ['1.1.1.1, 10.0.0.1', '10.0.0.1'],
    ['1.1.1.1, ', null],
  ] as const)('%p → %p', (header, expected) => {
    expect(lastForwarded(header)).toBe(expected)
  })
})
