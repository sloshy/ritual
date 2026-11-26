import { describe, expect, test } from 'bun:test'
import {
  isLoopbackHost,
  unauthenticatedExposure,
  type UnauthenticatedExposure,
} from '../../../src/mcp/host'
import type { McpPublicUrl } from '../../../src/mcp/public-url'

describe('isLoopbackHost', () => {
  test('accepts every loopback spelling', () => {
    const loopback = [
      'localhost',
      'LOCALHOST',
      '::1',
      '[::1]',
      '::ffff:127.0.0.1',
      '127.0.0.1',
      '127.0.0.2',
      '127.5.5.5',
      '127.255.255.255',
    ]
    for (const host of loopback) {
      expect({ host, loopback: isLoopbackHost(host) }).toEqual({ host, loopback: true })
    }
  })

  test('rejects non-loopback and malformed hosts', () => {
    const exposed = [
      '0.0.0.0',
      '::',
      '192.168.1.10',
      '10.0.0.1',
      'example.com',
      '128.0.0.1',
      // Malformed dotted quads must not slip through the 127/8 pattern.
      '127.999.999.999',
      '127.0.0',
      '127.0.0.1.1',
      '',
    ]
    for (const host of exposed) {
      expect({ host, loopback: isLoopbackHost(host) }).toEqual({ host, loopback: false })
    }
  })
})

describe('unauthenticatedExposure', () => {
  type Row = {
    host: string
    publicUrl?: McpPublicUrl
    expected: UnauthenticatedExposure | undefined
  }
  const publicUrl: McpPublicUrl = {
    origin: 'https://mcp.example.com:8443',
    hostname: 'mcp.example.com',
  }

  test('names the bind host first, then the public origin, else no exposure', () => {
    const rows: Row[] = [
      { host: '0.0.0.0', expected: { reason: 'host', exposedAt: '0.0.0.0' } },
      {
        host: '127.0.0.1',
        publicUrl,
        expected: { reason: 'public-url', exposedAt: 'https://mcp.example.com:8443' },
      },
      // A non-loopback bind is the wider exposure, so it wins over the public URL.
      { host: '10.0.0.5', publicUrl, expected: { reason: 'host', exposedAt: '10.0.0.5' } },
      { host: '127.0.0.1', expected: undefined },
      { host: '[::1]', expected: undefined },
    ]
    for (const { host, publicUrl: url, expected } of rows) {
      expect({ host, url, exposure: unauthenticatedExposure(host, url) }).toEqual({
        host,
        url,
        exposure: expected,
      })
    }
  })
})
