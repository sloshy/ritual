import { describe, test, expect, spyOn, afterEach } from 'bun:test'
import { setupGlobalFetch } from '../../src/http'

describe('Global Fetch Patch', () => {
  const originalFetch = global.fetch

  // Restore original fetch after all tests
  afterEach(() => {
    global.fetch = originalFetch
  })

  test('should add User-Agent header to requests', async () => {
    // Mock the underlying fetch
    // NOTE: normally we don't want to use spyOn or other mocking libraries but it's allowed in this exceptional case
    const mockFetch = spyOn(global, 'fetch').mockResolvedValue(new Response('ok'))

    global.fetch = mockFetch as any
    setupGlobalFetch()

    await fetch('https://example.com')

    expect(mockFetch).toHaveBeenCalled()
    const args = mockFetch.mock.calls[0]
    const options = args![1] as RequestInit
    const headers = new Headers(options.headers)

    expect(headers.get('User-Agent')).toBe('Ritual CLI/0.1.0')
  })

  test('should preserve existing headers', async () => {
    const mockFetch = spyOn(global, 'fetch').mockResolvedValue(new Response('ok'))
    global.fetch = mockFetch as any
    setupGlobalFetch()

    await fetch('https://example.com', {
      headers: { Authorization: 'Bearer token' },
    })

    const args = mockFetch.mock.calls[0]
    const options = args![1] as RequestInit
    const headers = new Headers(options.headers)

    expect(headers.get('User-Agent')).toBe('Ritual CLI/0.1.0')
    expect(headers.get('Authorization')).toBe('Bearer token')
  })
})
