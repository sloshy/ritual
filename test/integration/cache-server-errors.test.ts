import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { errorResponse, type ApiErrorResponse } from '../../src/api/http'
import { defaultCache, FileCacheManager, getCacheFile } from '../../src/cache'
import {
  clearCacheServerAddressOverride,
  setCacheServerAddressOverride,
} from '../../src/cache/config'
import { createCacheServerFetchHandler } from '../../src/cache-server/server'
import { ScryfallClient } from '../../src/scryfall'
import { syncRef } from '../../src/sync/message'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { expectLocaleInForce, pseudoCatalog, withSyntheticLocaleAsync } from '../helpers/sync-text'
import {
  MemoryFileSystemClient,
  MemoryLogger,
  MockHttpClient,
  resetLogger,
  setLogger,
} from '../test-utils'

/**
 * A cache server's failures cross the wire as English plus their key.
 *
 * The cache server is another Ritual process, and its UI language need not be
 * its client's. When resolving a price fails inside it (here: Scryfall refuses
 * the price batch), the `500` body's `details` and the price stream's `error`
 * event carry the failure as a message triple, and the client nests it into
 * its own keyed error — so the admin API and MCP, which answer any route's
 * error through `errorResponse`, read English plus the keys all the way down.
 *
 * The server runs in-process under the pseudo-locale: a server that flattened
 * its error to text in its own language would put bracketed pseudo text into
 * the English answer.
 */

/** The failure Scryfall's refusal becomes inside the server, nested as the reply. */
const PRICES_FAILED = syncRef('domain.cache.scryfall.pricesFailed', {
  status: 503,
  statusText: 'Service Unavailable',
})

let ws: BoundWorkspace
let server: Bun.Server<undefined>
/** The server's operator log of each failure — expected here, so kept off the test output. */
let consoleError: Mock<typeof console.error>

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
  setLogger(new MemoryLogger())
  consoleError = spyOn(console, 'error').mockImplementation(() => {})
  const http = new MockHttpClient()
  http.mock(
    'https://api.scryfall.com/cards/collection',
    () => new Response('down', { status: 503, statusText: 'Service Unavailable' }),
  )
  const localCardCache = new FileCacheManager(getCacheFile, 'cards', 0)
  const handler = createCacheServerFetchHandler(
    {
      localCardCache,
      localPriceCache: new FileCacheManager(getCacheFile, 'prices'),
      localScryfallClient: new ScryfallClient(
        http,
        localCardCache,
        new MemoryFileSystemClient(),
        0,
      ),
      priceRefreshScheduler: null,
    },
    false,
  )
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
  setCacheServerAddressOverride(`127.0.0.1:${server.port}`)
})

afterEach(async () => {
  clearCacheServerAddressOverride()
  await server.stop(true)
  consoleError.mockRestore()
  resetLogger()
  await ws.dispose()
})

/** Run `body` with the whole process — server and client — in the pseudo-locale. */
function underPseudoLocale<T>(body: () => Promise<T>): Promise<T> {
  return withSyntheticLocaleAsync('en-XA', pseudoCatalog(), async (locale) => {
    expectLocaleInForce(locale)
    return body()
  })
}

describe('a cache server’s failures, as a route answers them', () => {
  test('a failed read nests the server’s keyed failure as the reply', async () => {
    const body = await underPseudoLocale(async () => {
      const error = await defaultCache.get('Sol Ring:usd').catch((e: unknown) => e)
      return (await errorResponse(error).json()) as ApiErrorResponse
    })

    const url = `http://127.0.0.1:${server.port}/cache/prices/Sol%20Ring%3Ausd`
    expect(body).toEqual({
      success: false,
      message: `Cache server request failed (500) GET ${url}: Failed to fetch batch prices: 503 Service Unavailable`,
      messageKey: 'domain.cache.serverRequestFailedWithBody',
      messageParams: { status: 500, method: 'GET', url, body: PRICES_FAILED },
    })
  })

  test('a failed price stream entry nests the server’s keyed failure, naming its key', async () => {
    const body = await underPseudoLocale(async () => {
      const error = await defaultCache.streamGetMany(['Sol Ring:usd'], () => {}).catch((e) => e)
      return (await errorResponse(error).json()) as ApiErrorResponse
    })

    expect(body).toEqual({
      success: false,
      message:
        "Cache server stream error for 'Sol Ring:usd': Failed to fetch batch prices: 503 Service Unavailable",
      messageKey: 'domain.cache.serverStreamEntryError',
      messageParams: { key: 'Sol Ring:usd', error: PRICES_FAILED },
    })
  })
})

/**
 * A newer cache server may word a failure with a key, or a param kind, this
 * client does not know. Nested, it would render as a raw key or `{token}`,
 * its English lost; the client carries the server's English as it came instead.
 */
describe('a failure from a newer cache server', () => {
  /** A 500 keyed with a message this client has never heard of. */
  const FAILURE_BODY = {
    error: 'Cache server request failed.',
    details: 'Scryfall is on holiday.',
    detailsKey: 'domain.cache.scryfallOnHoliday',
  }
  /** A stream error whose key this client knows, but with a param kind it does not. */
  const STREAM_ERROR = {
    key: 'Sol Ring:usd',
    message: 'Download size: three fortnights MiB (compressed)',
    messageKey: 'domain.cache.refresh.downloadSize',
    messageParams: { size: { fortnights: 3 } },
  }

  let newer: Bun.Server<undefined>

  beforeEach(() => {
    newer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) =>
        new URL(request.url).pathname.endsWith('/stream')
          ? new Response(`event: error\ndata: ${JSON.stringify(STREAM_ERROR)}\n\n`, {
              headers: { 'Content-Type': 'text/event-stream' },
            })
          : Response.json(FAILURE_BODY, { status: 500 }),
    })
    setCacheServerAddressOverride(`127.0.0.1:${newer.port}`)
  })

  afterEach(async () => {
    await newer.stop(true)
  })

  test('an unknown key is carried as the server’s English', async () => {
    const error = await defaultCache.get('Sol Ring:usd').catch((e: unknown) => e)
    const body = (await errorResponse(error).json()) as ApiErrorResponse

    const url = `http://127.0.0.1:${newer.port}/cache/prices/Sol%20Ring%3Ausd`
    expect(body).toEqual({
      success: false,
      message: `Cache server request failed (500) GET ${url}: Scryfall is on holiday.`,
      messageKey: 'domain.cache.serverRequestFailedWithBody',
      messageParams: { status: 500, method: 'GET', url, body: 'Scryfall is on holiday.' },
    })
  })

  test('an unknown param kind is carried as the server’s English', async () => {
    const error = await defaultCache.streamGetMany(['Sol Ring:usd'], () => {}).catch((e) => e)
    const body = (await errorResponse(error).json()) as ApiErrorResponse

    expect(body).toEqual({
      success: false,
      message: `Cache server stream error for 'Sol Ring:usd': ${STREAM_ERROR.message}`,
      messageKey: 'domain.cache.serverStreamEntryError',
      messageParams: { key: 'Sol Ring:usd', error: STREAM_ERROR.message },
    })
  })
})
