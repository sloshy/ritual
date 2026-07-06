import { describe, expect, test } from 'bun:test'
import { SCRYFALL_BULK_API_URL, fetchScryfallBulkManifest } from '../../src/scryfall/bulk-manifest'
import { scheduleRecurringTask } from '../../src/cache-server/cadence'
import { MockHttpClient } from '../test-utils'

describe('fetchScryfallBulkManifest', () => {
  test('returns the manifest data entries from the default URL', async () => {
    const http = new MockHttpClient()
    const entries = [
      { type: 'default_cards', jsonl_download_uri: 'https://x/d.jsonl.gz', updated_at: 't' },
    ]
    http.mock(SCRYFALL_BULK_API_URL, () => new Response(JSON.stringify({ data: entries })))
    expect(await fetchScryfallBulkManifest(http)).toEqual(entries)
  })

  test('fetches from an overridden manifest URL', async () => {
    const http = new MockHttpClient()
    http.mock('https://mirror.example/bulk-data', () => new Response(JSON.stringify({ data: [] })))
    expect(await fetchScryfallBulkManifest(http, 'https://mirror.example/bulk-data')).toEqual([])
  })

  test('returns an empty list when the manifest has no data field', async () => {
    const http = new MockHttpClient()
    http.mock(SCRYFALL_BULK_API_URL, () => new Response('{}'))
    expect(await fetchScryfallBulkManifest(http)).toEqual([])
  })

  test('throws on a non-ok response', async () => {
    const http = new MockHttpClient()
    http.mock(SCRYFALL_BULK_API_URL, () => new Response('down', { status: 503 }))
    expect(fetchScryfallBulkManifest(http)).rejects.toThrow('Failed to fetch bulk manifest')
  })
})

describe('scheduleRecurringTask', () => {
  test('keeps firing after both success and failure', async () => {
    let runs = 0
    const errors: unknown[] = []
    const timer = scheduleRecurringTask(
      5,
      async () => {
        runs++
        if (runs === 1) throw new Error('first run fails')
      },
      (error) => errors.push(error),
    )
    try {
      await new Promise((resolve) => setTimeout(resolve, 40))
      // The first tick rejected, was routed to onError, and did not stop the timer.
      expect(errors).toHaveLength(1)
      expect(runs).toBeGreaterThanOrEqual(2)
    } finally {
      clearInterval(timer)
    }
  })
})
