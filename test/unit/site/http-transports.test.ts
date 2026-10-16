import { describe, expect, test } from 'bun:test'
import { DEFAULT_BUYER } from '../../../src/buylist'
import { createBuylistFetcher } from '../../../src/list-view/buylist-quotes'
import { fetchJson, HttpStatusError } from '../../../src/list-view/fetch-json'
import { adminBuylistFetcher } from '../../../src/admin/site/editor-backend'

/**
 * The transports that turn an HTTP error status into an {@link HttpStatusError}
 * — the status a caller branches on (the buylist notice words its reason from
 * it), never parsed back out of a message.
 */
describe('HTTP error transports', () => {
  test.each<[string, () => Promise<unknown>]>([
    ['fetchJson', () => fetchJson('/decks/missing.json')],
    [
      'createBuylistFetcher',
      () => createBuylistFetcher({ url: '/api/buylist/quotes' })(DEFAULT_BUYER, []),
    ],
    ['the admin quote fetcher', () => adminBuylistFetcher(DEFAULT_BUYER, [])],
  ])('%s raises HttpStatusError with the status', async (_label, call) => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response('{}', { status: 503 })) as unknown as typeof globalThis.fetch
    try {
      const failure = await call().then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(failure).toBeInstanceOf(HttpStatusError)
      expect(failure).toMatchObject({ status: 503 })
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
