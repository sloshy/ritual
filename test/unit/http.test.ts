import { describe, test, expect, spyOn, afterEach } from 'bun:test'
import { setupGlobalFetch } from '../../src/http'
import { version } from '../../src/version'

describe('Global Fetch Patch', () => {
  const originalFetch = global.fetch
  const originalMoxfieldUserAgent = process.env.MOXFIELD_USER_AGENT

  // Restore original fetch after all tests
  afterEach(() => {
    global.fetch = originalFetch
    if (originalMoxfieldUserAgent === undefined) {
      delete process.env.MOXFIELD_USER_AGENT
    } else {
      process.env.MOXFIELD_USER_AGENT = originalMoxfieldUserAgent
    }
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

    expect(headers.get('User-Agent')).toBe(`Ritual/${version}`)
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

    expect(headers.get('User-Agent')).toBe(`Ritual/${version}`)
    expect(headers.get('Authorization')).toBe('Bearer token')
  })

  test('should use MOXFIELD_USER_AGENT for Moxfield API requests', async () => {
    process.env.MOXFIELD_USER_AGENT = 'My Unique Agent/1.0'

    const mockFetch = spyOn(global, 'fetch').mockResolvedValue(new Response('ok'))
    global.fetch = mockFetch as any
    setupGlobalFetch()

    await fetch('https://api2.moxfield.com/v3/decks/all/abc123')

    const args = mockFetch.mock.calls[0]
    const options = args![1] as RequestInit
    const headers = new Headers(options.headers)

    expect(headers.get('User-Agent')).toBe('My Unique Agent/1.0')
  })
})
