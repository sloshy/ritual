import { describe, expect, test } from 'bun:test'
import { isLoopbackHost } from '../../../src/mcp/host'

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
