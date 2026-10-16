import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { errorResponse, type ApiErrorResponse } from '../../src/api/http'
import { defaultCache, FileCacheManager, getCacheFile } from '../../src/cache'
import {
  clearCacheServerAddressOverride,
  setCacheServerAddressOverride,
} from '../../src/cache/config'
import { createCacheServerFetchHandler } from '../../src/cache-server/server'
import { en } from '../../src/i18n/messages/en'
import { ScryfallClient } from '../../src/scryfall'
import { syncRef } from '../../src/sync/message'
import { bindWorkspace, type BoundWorkspace } from '../helpers/workspace'
import { pseudoCatalog, withGuardedLocaleAsync } from '../helpers/sync-text'
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
 * its client's. Every error it answers — an HTTP refusal or failure, and a
 * price stream's `error` event — is the shared message triple, and the client
 * nests it into its own keyed error: the admin API, which answers any route's
 * error through `errorResponse`, reads English plus the keys all the way down,
 * and the CLI words it in its own language.
 *
 * Server and client run in one process here, under the pseudo-locale: a server
 * that worded its reply in its own language would put bracketed pseudo text
 * into the English body. (How the client reads every other kind of reply —
 * unknown keys, keyless bodies, proxy pages — is pinned in
 * test/unit/cache/server-reply.test.ts.)
 */

/** The failure Scryfall's refusal becomes inside the server, nested as the reply. */
const PRICES_FAILED = syncRef('domain.cache.scryfall.pricesFailed', {
  status: 503,
  statusText: 'Service Unavailable',
})

/** Run `body` in the full pseudo-locale, guarded so it cannot compare English with English. */
function underPseudoLocale<T>(body: () => Promise<T>): Promise<T> {
  return withGuardedLocaleAsync('en-XA', pseudoCatalog(), body)
}

let ws: BoundWorkspace

beforeEach(async () => {
  ws = await bindWorkspace({ clearCardCache: true })
  setLogger(new MemoryLogger())
})

afterEach(async () => {
  clearCacheServerAddressOverride()
  resetLogger()
  await ws.dispose()
})

describe('a Ritual cache server’s failures, as its client reports them', () => {
  let server: Bun.Server<undefined>
  /** The server's operator log of each failure — expected here, so kept off the test output. */
  let consoleError: Mock<typeof console.error>

  beforeEach(() => {
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
    await server.stop(true)
    consoleError.mockRestore()
  })

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

  test('a refusal goes out in English with its key, and the client words it in its language', async () => {
    const { raw, routed, shown } = await underPseudoLocale(async () => {
      const refused = await fetch(`http://127.0.0.1:${server.port}/cache/prices/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{"entries": ',
      })
      // An empty key names no entry: the server refuses the route.
      const error = await defaultCache.get('').catch((e: unknown) => e)
      return {
        raw: { status: refused.status, body: (await refused.json()) as unknown },
        routed: (await errorResponse(error).json()) as ApiErrorResponse,
        shown: error instanceof Error ? error.message : '',
      }
    })

    expect(raw).toEqual({
      status: 400,
      body: {
        success: false,
        message: en['domain.cache.serverReply.bodyNotJson'],
        messageKey: 'domain.cache.serverReply.bodyNotJson',
      },
    })
    const url = `http://127.0.0.1:${server.port}/cache/prices/`
    expect(routed).toEqual({
      success: false,
      message: `Cache server request failed (404) GET ${url}: ${en['domain.cache.serverReply.invalidRoute']}`,
      messageKey: 'domain.cache.serverRequestFailedWithBody',
      messageParams: {
        status: 404,
        method: 'GET',
        url,
        body: { messageKey: 'domain.cache.serverReply.invalidRoute' },
      },
    })
    // What the CLI prints words the server's reason in the reader's language.
    const reason = pseudoCatalog()['domain.cache.serverReply.invalidRoute']
    if (typeof reason !== 'string') throw new Error('expected a plain-string message')
    expect(shown).toContain(reason)
  })
})

describe('a reply from something that is not a cache server', () => {
  let proxy: Bun.Server<undefined>

  beforeEach(() => {
    proxy = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () =>
        new Response('<html>\n<body>\u001b[31mBad Gateway</body>\n</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    })
    setCacheServerAddressOverride(`127.0.0.1:${proxy.port}`)
  })

  afterEach(async () => {
    await proxy.stop(true)
  })

  test('is quoted on one line, stripped of control characters', async () => {
    const error = await defaultCache.get('Sol Ring:usd').catch((e: unknown) => e)
    const body = (await errorResponse(error).json()) as ApiErrorResponse

    const url = `http://127.0.0.1:${proxy.port}/cache/prices/Sol%20Ring%3Ausd`
    const page = '<html> <body>Bad Gateway</body> </html>'
    expect(body).toEqual({
      success: false,
      message: `Cache server request failed (502) GET ${url}: ${page}`,
      messageKey: 'domain.cache.serverRequestFailedWithBody',
      messageParams: { status: 502, method: 'GET', url, body: page },
    })
  })
})
