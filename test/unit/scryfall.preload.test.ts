import { describe, test, expect, spyOn, mock, beforeEach, afterEach } from 'bun:test'
import { ScryfallClient } from '../../src/scryfall'
import { cardCache } from '../../src/cache'
import { MemoryLogger, resetLogger, setLogger } from '../test-utils'

describe('Scryfall Preload', () => {
  let logger: MemoryLogger

  beforeEach(() => {
    logger = new MemoryLogger()
    setLogger(logger)
  })

  afterEach(() => {
    resetLogger()
  })

  test('preloadCache should fetching and cache data', async () => {
    // Mock fetch response with a stream
    const mockData = [
      { id: '1', name: 'Card A', set: 'set1' },
      { id: '2', name: 'Card B', set: 'set1' },
    ]
    const jsonString = JSON.stringify(mockData)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(jsonString))
        controller.close()
      },
    })

    const mockResponse = new Response(stream, {
      headers: { 'content-length': jsonString.length.toString() },
    })

    const mockMeta = {
      data: [
        {
          type: 'default_cards',
          download_uri: 'https://example.com/bulk.json',
          size: jsonString.length,
        },
      ],
    }
    const mockMetaResponse = new Response(JSON.stringify(mockMeta))

    // Mock scryfallClient.http.fetch to handle both URLs
    const mockFetch = mock(async (url: any) => {
      if (url === 'https://api.scryfall.com/bulk-data') {
        return mockMetaResponse
      }
      return mockResponse
    })
    const client = new ScryfallClient({ fetch: mockFetch }, cardCache)

    const bulkSetSpy = spyOn(cardCache, 'bulkSet').mockResolvedValue(undefined)

    await client.preloadCache()

    expect(mockFetch).toHaveBeenCalled()
    expect(bulkSetSpy).toHaveBeenCalled()

    const call = bulkSetSpy.mock.calls[0]
    expect(call).toBeDefined()
    const args = call![0]
    expect(args['Card A']).toBeDefined()
    expect(args['Card B']).toBeDefined()
    expect(
      logger.entries.some(
        (entry) =>
          entry.level === 'info' &&
          typeof entry.args[0] === 'string' &&
          entry.args[0].includes('Fetching bulk data metadata'),
      ),
    ).toBeTrue()
  })
})
