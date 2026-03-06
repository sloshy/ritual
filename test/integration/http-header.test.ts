import { describe, test, expect } from 'bun:test'
import { setupGlobalFetch } from '../../src/http'
import { version } from '../../src/version'

describe('HTTP Integration', () => {
  // Apply the patch
  setupGlobalFetch()

  test('should send correct User-Agent to a real server', async () => {
    let receivedUserAgent: string | null = null

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        receivedUserAgent = req.headers.get('user-agent')
        return new Response('ok')
      },
    })

    try {
      await fetch(`http://localhost:${server.port}`)
      expect(receivedUserAgent!).toBe(`Ritual/${version}`)
    } finally {
      server.stop()
    }
  })
})
