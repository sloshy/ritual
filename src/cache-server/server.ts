import * as fs from 'node:fs/promises'
import { getCacheDir, getCacheFile, FileCacheManager } from '../cache'
import { defaultHttpClient } from '../util/http'
import { getCacheSource, type CacheSource } from '../config/ritual-config'
import { CacheFeedClient, type FeedSyncResult } from '../cache/feed-client'
import { getFeedClientDataDir, resolveFeedUrl } from '../cache/refresh-source'
import type { BulkSetOptions, HttpClient } from '../util/interfaces'
import { ScryfallClient } from '../scryfall'
import type { PriceData } from '../pricing/price-data'
import type { ScryfallCard } from '../scryfall/types'
import { ExitCode } from '../util/errors'
import { caughtMessage, keyedRefusal, nestedRefusal } from '../api/http'
import { syncMessage, SyncMessageError } from '../sync/message'
import { t, type SelectBranch } from '../i18n/t'
import { isRecord, isStringArray } from '../util/json'
import type { CacheServerStreamError } from '../cache/http-cache'
import { resolveRefreshCadence, resolveRefreshMs, scheduleRecurringTask } from './cadence'
import { CACHE_SERVER_LOG_PREFIX, PRICE_REFRESH_STAGGER_MS, WEEKLY_REFRESH_MS } from './constants'
import {
  createFileSystemClient,
  decodePathSegment,
  ENTRY_METHODS,
  getSection,
  isOlderThan,
  jsonResponse,
  logCacheUpdate,
  logVerboseRequest,
  runStaggeredTasksInCompletionOrder,
  sseEvent,
  shouldForcePriceRefresh,
} from './helpers'
import {
  refreshPriceCacheEntry,
  resolveCardCacheReadThrough,
  resolvePriceCacheReadThrough,
} from './read-through'
import { tryStartServer } from '../util/start-server'
import { PriceRefreshScheduler } from './scheduler'
import type { CacheServerCommandOptions, PriceReadThroughResult } from './types'

interface PriceStreamTaskResult {
  key: string
  result: PriceReadThroughResult
}

/** What the request handler serves from: the server's own caches and Scryfall client. */
export interface CacheServerRuntime {
  localCardCache: FileCacheManager<'cards'>
  localPriceCache: FileCacheManager<'prices'>
  localScryfallClient: ScryfallClient
  priceRefreshScheduler: PriceRefreshScheduler | null
}

function createPriceRefreshScheduler(
  pricesRefreshMs: number | undefined,
  localPriceCache: FileCacheManager<'prices'>,
  localScryfallClient: ScryfallClient,
  localCardCache?: FileCacheManager<'cards'>,
): PriceRefreshScheduler | null {
  if (!pricesRefreshMs) return null

  return new PriceRefreshScheduler(
    pricesRefreshMs,
    localPriceCache,
    async (key, reason) =>
      refreshPriceCacheEntry(
        localPriceCache,
        localScryfallClient,
        key,
        logCacheUpdate,
        reason === 'scheduled' ? 'scheduled-refresh' : 'manual-refresh',
        localCardCache,
      ),
    localCardCache,
  )
}

/** A request's JSON object body, or the refusal to answer instead. */
type ObjectBody = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }

/**
 * The request's body as a JSON object. Read whole: a bulk write carries the
 * entire card cache, so no budget short of the server's own applies.
 */
async function readObjectBody(request: Request): Promise<ObjectBody> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: keyedRefusal('domain.cache.serverReply.bodyNotJson', 400) }
  }
  if (!isRecord(raw)) {
    return { ok: false, response: keyedRefusal('domain.cache.serverReply.bodyNotObject', 400) }
  }
  return { ok: true, body: raw }
}

/**
 * A price-stream `error` event: the failure as English plus its key (what
 * `caughtMessage` gives every route), so the client reading this stream — another
 * Ritual process, whose UI language need not be this server's — can nest it.
 */
function streamError(error: unknown, key?: string): CacheServerStreamError {
  const message = caughtMessage(error)
  return key === undefined ? message : { key, ...message }
}

function createPriceStream(
  keys: string[],
  runtime: CacheServerRuntime,
): ReadableStream<Uint8Array> {
  const { localCardCache, localPriceCache, localScryfallClient, priceRefreshScheduler } = runtime

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let emittedCount = 0
        const refreshQueue: string[] = []

        for (const key of keys) {
          try {
            const cached = await localPriceCache.get(key)
            if (!cached) {
              refreshQueue.push(key)
              continue
            }

            let shouldRefresh = false
            if (priceRefreshScheduler) {
              await priceRefreshScheduler.ensureScheduledFromTimestamp(key)
              const lastUpdatedAt = await localPriceCache.getTimestamp(key)
              const scheduledAt = priceRefreshScheduler.getScheduledRefreshAt(key)
              shouldRefresh = shouldForcePriceRefresh(
                priceRefreshScheduler.getIntervalMs(),
                lastUpdatedAt,
                scheduledAt,
              )
            }

            if (shouldRefresh) {
              refreshQueue.push(key)
              continue
            }

            controller.enqueue(
              sseEvent('price', {
                key,
                value: cached,
                updated: false,
              }),
            )
            emittedCount++
          } catch (error) {
            controller.enqueue(sseEvent('error', streamError(error, key)))
          }
        }

        await runStaggeredTasksInCompletionOrder(
          refreshQueue.map((key) => async (): Promise<PriceStreamTaskResult> => ({
            key,
            result: await resolvePriceCacheReadThrough(
              localPriceCache,
              localScryfallClient,
              key,
              logCacheUpdate,
              priceRefreshScheduler,
              localCardCache,
            ),
          })),
          PRICE_REFRESH_STAGGER_MS,
          async ({ key, result }) => {
            controller.enqueue(
              sseEvent('price', {
                key,
                value: result.value,
                updated: result.updated,
              }),
            )
            emittedCount++
          },
          async (error, index) => {
            const key = refreshQueue[index] ?? 'unknown'
            controller.enqueue(sseEvent('error', streamError(error, key)))
          },
        )

        controller.enqueue(sseEvent('done', { count: emittedCount }))
        controller.close()
      })().catch((error) => {
        controller.enqueue(sseEvent('error', streamError(error)))
        controller.close()
      })
    },
  })
}

/**
 * The server's request handler. Exported as a test seam: a suite serves it
 * in-process over a stubbed Scryfall client instead of spawning the binary.
 */
export function createCacheServerFetchHandler(
  runtime: CacheServerRuntime,
  verbose: boolean,
): (request: Request) => Promise<Response> {
  const { localCardCache, localPriceCache, localScryfallClient, priceRefreshScheduler } = runtime

  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now()
    let responseStatus = 500
    const respond = (response: Response): Response => {
      responseStatus = response.status
      return response
    }

    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter((part) => part.length > 0)

      if (request.method === 'GET' && url.pathname === '/health') {
        return respond(jsonResponse({ status: 'ok' }))
      }

      if (parts[0] !== 'cache') {
        return respond(keyedRefusal('domain.cache.serverReply.notFound', 404))
      }

      const section = getSection(parts[1] ?? '')
      if (!section) {
        return respond(keyedRefusal('domain.cache.serverReply.invalidSection', 400))
      }

      if (parts.length === 2 && request.method === 'DELETE') {
        if (section === 'cards') {
          await localCardCache.clear()
          // The clear drops the bulk-refresh stamp too: the client must not keep
          // answering "complete" printing lists from what it memoized before.
          localScryfallClient.forgetCacheMemos()
        } else {
          await localPriceCache.clear()
          priceRefreshScheduler?.clearAll()
        }
        logCacheUpdate(`section=${section} action=clear`)
        return respond(new Response(null, { status: 204 }))
      }

      if (parts[2] === 'bulk' && request.method === 'PUT') {
        const read = await readObjectBody(request)
        if (!read.ok) return respond(read.response)
        const { entries, replace } = read.body
        if (!isRecord(entries)) {
          return respond(keyedRefusal('domain.cache.serverReply.entriesExpected', 400))
        }

        if (replace !== undefined && typeof replace !== 'boolean') {
          return respond(keyedRefusal('domain.cache.serverReply.replaceNotBoolean', 400))
        }
        const bulkOptions: BulkSetOptions = { replace: replace === true }
        // The entries' values are trusted as the cache's own shape: the cache
        // server serves trusted networks only, and its writers are Ritual.
        if (section === 'cards') {
          await localCardCache.bulkSet(entries as Record<string, ScryfallCard[]>, bulkOptions)
        } else {
          const prices = entries as Record<string, PriceData>
          await localPriceCache.bulkSet(prices, bulkOptions)
          // A replace drops every key it does not name; their refreshes must go too,
          // or the scheduler would write the dropped keys straight back.
          if (bulkOptions.replace) priceRefreshScheduler?.clearAll()
          if (priceRefreshScheduler) {
            for (const key of Object.keys(prices)) {
              priceRefreshScheduler.scheduleFromNow(key)
            }
          }
        }

        logCacheUpdate(`section=${section} action=bulk-set count=${Object.keys(entries).length}`)
        return respond(new Response(null, { status: 204 }))
      }

      if (section === 'prices' && parts[2] === 'stream' && request.method === 'POST') {
        const read = await readObjectBody(request)
        if (!read.ok) return respond(read.response)
        const requested = read.body.keys
        if (!isStringArray(requested)) {
          return respond(keyedRefusal('domain.cache.serverReply.keysExpected', 400))
        }

        const keys = requested.map((key) => key.trim()).filter((key) => key.length > 0)
        if (keys.length === 0) {
          return respond(keyedRefusal('domain.cache.serverReply.keysRequired', 400))
        }

        return respond(
          new Response(createPriceStream(keys, runtime), {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          }),
        )
      }

      if (parts[2] === 'is-empty' && request.method === 'GET') {
        const isEmpty =
          section === 'cards' ? await localCardCache.isEmpty() : await localPriceCache.isEmpty()
        return respond(jsonResponse({ isEmpty }))
      }

      if (parts[2] === 'keys' && request.method === 'GET') {
        const keys =
          section === 'cards' ? await localCardCache.keys() : await localPriceCache.keys()
        return respond(jsonResponse({ keys }))
      }

      if (parts[2] === 'values' && request.method === 'GET') {
        const values =
          section === 'cards' ? await localCardCache.values() : await localPriceCache.values()
        return respond(jsonResponse({ values }))
      }

      if (parts[2] === 'metadata' && request.method === 'GET') {
        const timestamp =
          section === 'cards'
            ? await localCardCache.getLastRefreshedAt()
            : await localPriceCache.getLastRefreshedAt()
        return respond(jsonResponse({ timestamp }))
      }

      if (parts.length === 4 && parts[3] === 'timestamp' && request.method === 'GET') {
        const key = decodePathSegment(parts[2] ?? '')
        if (key === undefined)
          return respond(keyedRefusal('domain.cache.serverReply.keyMalformed', 400))
        if (!key) {
          return respond(keyedRefusal('domain.cache.serverReply.keyRequired', 400))
        }
        const timestamp =
          section === 'cards'
            ? await localCardCache.getTimestamp(key)
            : await localPriceCache.getTimestamp(key)
        return respond(jsonResponse({ timestamp }))
      }

      if (parts.length !== 3) {
        return respond(keyedRefusal('domain.cache.serverReply.invalidRoute', 404))
      }

      const key = decodePathSegment(parts[2] ?? '')
      if (key === undefined)
        return respond(keyedRefusal('domain.cache.serverReply.keyMalformed', 400))
      if (!key) {
        return respond(keyedRefusal('domain.cache.serverReply.keyRequired', 400))
      }

      if (request.method === 'GET') {
        if (section === 'cards') {
          const value = await resolveCardCacheReadThrough(
            localCardCache,
            localScryfallClient,
            key,
            logCacheUpdate,
          )
          return respond(jsonResponse({ value }))
        }

        const result = await resolvePriceCacheReadThrough(
          localPriceCache,
          localScryfallClient,
          key,
          logCacheUpdate,
          priceRefreshScheduler,
          localCardCache,
        )
        return respond(jsonResponse({ value: result.value }))
      }

      if (request.method === 'PUT') {
        const read = await readObjectBody(request)
        if (!read.ok) return respond(read.response)
        if (!('value' in read.body)) {
          return respond(keyedRefusal('domain.cache.serverReply.valueExpected', 400))
        }
        const { value } = read.body

        if (section === 'cards') {
          await localCardCache.set(key, value as ScryfallCard[])
        } else {
          await localPriceCache.set(key, value as PriceData)
          priceRefreshScheduler?.scheduleFromNow(key)
        }
        logCacheUpdate(`section=${section} action=set key='${key}'`)
        return respond(new Response(null, { status: 204 }))
      }

      if (request.method === 'DELETE') {
        if (section === 'cards') {
          await localCardCache.delete(key)
        } else {
          await localPriceCache.delete(key)
          priceRefreshScheduler?.unscheduleKey(key)
        }
        logCacheUpdate(`section=${section} action=delete key='${key}'`)
        return respond(new Response(null, { status: 204 }))
      }

      return respond(
        keyedRefusal('domain.cache.serverReply.methodNotAllowed', 405, {
          Allow: ENTRY_METHODS.join(', '),
        }),
      )
    } catch (error) {
      console.error(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.requestFailed')}`, error)
      return respond(nestedRefusal(caughtMessage(error), 500))
    } finally {
      if (verbose) {
        logVerboseRequest(request, responseStatus, Date.now() - startedAt)
      }
    }
  }
}

/** The `cache server` action: start the cache server and its refresh schedulers. */
export async function runCacheServer(options: CacheServerCommandOptions): Promise<void> {
  await fs.mkdir(getCacheDir(), { recursive: true })

  const httpClient: HttpClient = options.denyHttp
    ? {
        fetch: async () => {
          // Keyed: a price read that needs a download reaches its client as
          // this refusal (a 500, or a stream `error` event). A card miss is not
          // a failure — it answers `200 { value: null }`.
          throw new SyncMessageError(syncMessage('domain.cache.serverReply.httpDenied'))
        },
      }
    : defaultHttpClient

  const localCardCache = new FileCacheManager(getCacheFile, 'cards', 0)
  const localPriceCache = new FileCacheManager(getCacheFile, 'prices')
  const localScryfallClient = new ScryfallClient(
    httpClient,
    localCardCache,
    createFileSystemClient(),
  )

  const cardsRefreshCadence = resolveRefreshCadence(
    options.cardsRefresh,
    'RITUAL_CACHE_SERVER_CARDS_REFRESH',
  )
  const cardsRefreshMs = resolveRefreshMs(options.cardsRefresh, 'RITUAL_CACHE_SERVER_CARDS_REFRESH')
  const pricesRefreshCadence = resolveRefreshCadence(
    options.pricesRefresh,
    'RITUAL_CACHE_SERVER_PRICES_REFRESH',
  )
  const pricesRefreshMs = resolveRefreshMs(
    options.pricesRefresh,
    'RITUAL_CACHE_SERVER_PRICES_REFRESH',
  )

  const priceRefreshScheduler = createPriceRefreshScheduler(
    pricesRefreshMs,
    localPriceCache,
    localScryfallClient,
    localCardCache,
  )

  // Feed mode: refresh from the P2P cache feed and (by default) keep
  // seeding its artifacts between refreshes, so every always-on cache
  // server is a permanent swarm member.
  const cacheSource: CacheSource = options.cacheSource ?? getCacheSource()
  const feedClient: CacheFeedClient | null =
    cacheSource === 'feed' && !options.denyHttp
      ? new CacheFeedClient({
          feedUrl: resolveFeedUrl(options.url),
          dataDir: getFeedClientDataDir(),
          http: httpClient,
          ingest: (files) => localScryfallClient.preloadCacheFromFiles(files),
          ...(options.torrentPort !== undefined ? { torrentPort: options.torrentPort } : {}),
        })
      : null

  /**
   * One cards refresh from the configured source. Feed failures fall back
   * to a direct Scryfall preload so a broken feed never wedges the server.
   */
  const refreshCards = async (action: string): Promise<void> => {
    if (feedClient) {
      let result: FeedSyncResult | null = null
      try {
        result = await feedClient.sync()
      } catch (error) {
        console.error(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.feedSyncFailed')}`, error)
      }
      if (result) {
        if (result.outcome === 'unchanged') {
          await localCardCache.bulkSet({})
          console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.feedUnchanged')}`)
        }
        logCacheUpdate(`section=cards action=${action} source=feed outcome=${result.outcome}`)
        if (options.seed) {
          // The cards are already ingested — a seeding failure is a
          // warning, never a reason to redo the refresh from Scryfall.
          try {
            await feedClient.seedAll(result.feed)
          } catch (error) {
            console.error(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.seedFailed')}`, error)
          }
        }
        return
      }
    }
    // `preloadCache` propagates now; a failed scheduled refresh must not kill
    // the server's refresh loop.
    try {
      await localScryfallClient.preloadCache()
      logCacheUpdate(`section=cards action=${action} source=scryfall`)
    } catch (error) {
      console.error(
        `${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.scryfallRefreshFailed')}`,
        error,
      )
    }
  }

  const cardCacheIsEmpty = await localCardCache.isEmpty()
  const cardsLastRefreshedAt = await localCardCache.getLastRefreshedAt()
  const cardsStaleThresholdMs = cardsRefreshMs ?? WEEKLY_REFRESH_MS
  const cardCacheIsStale = isOlderThan(cardsLastRefreshedAt, cardsStaleThresholdMs)
  // With a seeding feed client, always sync at startup: an unchanged feed
  // is a cheap infohash check, and seeding needs the current artifacts.
  const startupRefreshNeeded =
    cardCacheIsEmpty || cardCacheIsStale || (feedClient !== null && options.seed)
  if (!options.denyHttp && startupRefreshNeeded) {
    const reason: SelectBranch<'cli.cacheServer.startupRefresh'> = cardCacheIsEmpty
      ? 'empty'
      : cardCacheIsStale
        ? 'stale'
        : 'seed'
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.startupRefresh', { reason, source: cacheSource })}`,
    )
    await refreshCards(`startup-preload reason=${reason}`)
  }

  if (cardsRefreshMs && cardsRefreshCadence) {
    const cardsCadence: SelectBranch<'cli.cacheServer.cardsRefreshEnabled'> = cardsRefreshCadence
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.cardsRefreshEnabled', { cadence: cardsCadence })}`,
    )
    scheduleRecurringTask(
      cardsRefreshMs,
      async () => {
        await refreshCards('scheduled-preload')
        console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.cardsRefreshComplete')}`)
      },
      (error) =>
        console.error(
          `${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.cardsRefreshFailed')}`,
          error,
        ),
    )
  }

  if (priceRefreshScheduler && pricesRefreshCadence) {
    await priceRefreshScheduler.initializeFromCache()
    const pricesCadence: SelectBranch<'cli.cacheServer.pricesRefreshEnabled'> = pricesRefreshCadence
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.pricesRefreshEnabled', { cadence: pricesCadence })}`,
    )
  }

  const runtime: CacheServerRuntime = {
    localCardCache,
    localPriceCache,
    localScryfallClient,
    priceRefreshScheduler,
  }

  // Most likely failure is a port already in use.
  const started = tryStartServer(() =>
    Bun.serve({
      hostname: options.host,
      port: options.port,
      fetch: createCacheServerFetchHandler(runtime, options.verbose ?? false),
    }),
  )
  if (!started.ok) {
    console.error(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.startFailed')}`, started.error)
    process.exitCode = ExitCode.RuntimeError
    return
  }

  if (options.denyHttp) {
    console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.httpDenied')}`)
    if (cacheSource === 'feed') {
      console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.feedDisabled')}`)
    }
  }
  if (options.verbose) {
    console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.verbose')}`)
  }
  if (feedClient && options.seed) {
    const port = feedClient.torrentPortInUse()
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} ${port ? t('cli.cacheServer.seedingOnPort', { port }) : t('cli.cacheServer.seeding')}`,
    )
  }
  const url = `http://${options.host}:${options.port}`
  console.log(`${CACHE_SERVER_LOG_PREFIX} ${t('cli.cacheServer.listening', { url })}`)
}
