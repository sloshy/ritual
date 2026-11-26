import { describe, expect, test } from 'bun:test'
import {
  lastForwarded,
  readRequestSource,
  type ProxySettings,
  type RequestIPServer,
} from '../../../src/admin/forwarded'

/** A stand-in for the Bun server that reports `address` as every request's peer. */
function peer(address: string | null): RequestIPServer {
  return { requestIP: () => (address === null ? null : { address }) }
}

/** A request carrying forged-looking forwarding headers, both with a client-written entry first. */
function forwardedRequest(): Request {
  return new Request('http://127.0.0.1:8080/api/login', {
    headers: {
      'X-Forwarded-For': '6.6.6.6, 203.0.113.9',
      'X-Forwarded-Host': 'spoofed.example, admin.example.com',
    },
  })
}

const BELIEVED = { clientIp: '203.0.113.9', forwardedHost: 'admin.example.com' }

function settings(trustProxy: boolean, trustedProxies: string[] = []): ProxySettings {
  return { trustProxy, trustedProxies }
}

describe('readRequestSource', () => {
  test.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])(
    'a loopback peer (%p) is a trusted proxy: the rightmost entries are used',
    (address) => {
      expect(readRequestSource(forwardedRequest(), peer(address), settings(true))).toEqual(BELIEVED)
    },
  )

  test.each(['192.168.1.20', '::ffff:192.168.1.20', '2001:db8::20', '128.0.0.1'])(
    'any other peer (%p) has every forwarding header ignored',
    (address) => {
      expect(readRequestSource(forwardedRequest(), peer(address), settings(true))).toEqual({
        clientIp: address,
        forwardedHost: null,
      })
    },
  )

  test.each([
    ['172.18.0.5', '172.18.0.0/16'],
    ['::ffff:172.18.0.5', '172.18.0.0/16'],
    ['10.0.0.2', '10.0.0.2'],
    ['fd00:1::7', 'fd00:1::/32'],
  ])('a peer %p inside admin.trustedProxies entry %p is trusted', (address, entry) => {
    expect(readRequestSource(forwardedRequest(), peer(address), settings(true, [entry]))).toEqual(
      BELIEVED,
    )
  })

  test('a peer outside every admin.trustedProxies entry is not trusted', () => {
    const source = readRequestSource(
      forwardedRequest(),
      peer('172.19.0.5'),
      settings(true, ['172.18.0.0/16', 'fd00:1::/32']),
    )
    expect(source).toEqual({ clientIp: '172.19.0.5', forwardedHost: null })
  })

  test('without admin.trustProxy even a loopback or listed peer is taken at its own address', () => {
    for (const address of ['127.0.0.1', '172.18.0.5']) {
      expect(
        readRequestSource(forwardedRequest(), peer(address), settings(false, ['172.18.0.0/16'])),
      ).toEqual({ clientIp: address, forwardedHost: null })
    }
  })

  test('a trusted proxy that sent no forwarding header leaves its own address and the Host', () => {
    const plain = new Request('http://127.0.0.1:8080/api/login')
    expect(readRequestSource(plain, peer('127.0.0.1'), settings(true))).toEqual({
      clientIp: '127.0.0.1',
      forwardedHost: null,
    })
  })

  test.each(['unknown', '203.0.113.9:5678', 'proxy.internal'])(
    'a believed X-Forwarded-For entry that is not a bare address (%p) leaves the peer',
    (entry) => {
      const req = new Request('http://127.0.0.1:8080/api/login', {
        headers: { 'X-Forwarded-For': entry },
      })
      expect(readRequestSource(req, peer('127.0.0.1'), settings(true)).clientIp).toBe('127.0.0.1')
    },
  )

  test('each forwarding header is read on its own', () => {
    const forOnly = new Request('http://127.0.0.1:8080/', {
      headers: { 'X-Forwarded-For': '203.0.113.9' },
    })
    const hostOnly = new Request('http://127.0.0.1:8080/', {
      headers: { 'X-Forwarded-Host': 'admin.example.com' },
    })
    expect(readRequestSource(forOnly, peer('::1'), settings(true))).toEqual({
      clientIp: '203.0.113.9',
      forwardedHost: null,
    })
    expect(readRequestSource(hostOnly, peer('::1'), settings(true))).toEqual({
      clientIp: '::1',
      forwardedHost: 'admin.example.com',
    })
  })

  // No peer address means no proof the request came through a proxy.
  test('an unknown peer is never trusted', () => {
    expect(readRequestSource(forwardedRequest(), peer(null), settings(true))).toEqual({
      clientIp: 'unknown',
      forwardedHost: null,
    })
    expect(readRequestSource(forwardedRequest(), {}, settings(true))).toEqual({
      clientIp: 'unknown',
      forwardedHost: null,
    })
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

describe('readRequestSource: proxy chains', () => {
  /** The client address a loopback peer's request with this `X-Forwarded-For` resolves to. */
  function clientOf(header: string, trustedProxies: string[] = []): string {
    const req = new Request('http://127.0.0.1:8080/', { headers: { 'X-Forwarded-For': header } })
    return readRequestSource(req, peer('127.0.0.1'), settings(true, trustedProxies)).clientIp
  }

  // CDN → local proxy → Ritual: the local proxy appends the CDN's address.
  test('a 2-hop chain skips the trusted CDN hop to reach the client', () => {
    expect(clientOf('203.0.113.9, 198.51.100.7', ['198.51.100.0/24'])).toBe('203.0.113.9')
    // Without the CDN listed, its address is the first untrusted hop.
    expect(clientOf('203.0.113.9, 198.51.100.7')).toBe('198.51.100.7')
  })

  test('a 3-hop chain skips every trusted hop', () => {
    expect(clientOf('203.0.113.9, 198.51.100.7, 10.0.0.4', ['198.51.100.0/24', '10.0.0.0/8'])).toBe(
      '203.0.113.9',
    )
  })

  test('when every entry is a trusted proxy, the leftmost is the client', () => {
    expect(clientOf('10.0.0.3, 10.0.0.4', ['10.0.0.0/8'])).toBe('10.0.0.3')
  })

  // A client writes its own header; the real hop to its right is its address.
  test('a forged entry left of the first untrusted hop is never taken', () => {
    expect(clientOf('127.0.0.1, 203.0.113.9, 198.51.100.7', ['198.51.100.0/24'])).toBe(
      '203.0.113.9',
    )
    expect(clientOf('10.0.0.3, 203.0.113.9', ['10.0.0.0/8'])).toBe('203.0.113.9')
  })

  // The fallback is an address a trusted proxy vouched for, never the text a client wrote.
  test('an entry that is not a bare address stops the walk at the last trusted hop', () => {
    expect(clientOf('203.0.113.9, unknown, 10.0.0.4', ['10.0.0.0/8'])).toBe('10.0.0.4')
    expect(clientOf('203.0.113.9, unknown')).toBe('127.0.0.1')
    expect(clientOf('203.0.113.9, ,')).toBe('127.0.0.1')
  })
})
