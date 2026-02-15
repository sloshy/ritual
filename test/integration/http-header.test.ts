import { describe, test, expect } from 'bun:test'
import { setupGlobalFetch } from '../../src/http'

describe('HTTP Integration', () => {
  // Apply the patch
  setupGlobalFetch()

  test('should send correct User-Agent to a real server', async () => {
    const port = 8080
    let receivedUserAgent: string | null = null

    const server = Bun.serve({
      port,
      fetch(req) {
        receivedUserAgent = req.headers.get('user-agent')
        return new Response('ok')
      },
    })

    try {
      await fetch(`http://localhost:${port}`)
      expect(receivedUserAgent!).toBe('Ritual CLI/0.1.0')
    } finally {
      server.stop()
    }
  })
})
