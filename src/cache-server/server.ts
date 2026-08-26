import * as fs from 'node:fs/promises'
import { getCacheDir, getCacheFile, FileCacheManager } from '../cache'
import { defaultHttpClient } from '../util/http'
import { getCacheSource, type CacheSource } from '../config/ritual-config'
import { CacheFeedClient, type FeedSyncResult } from '../cache-feed/fetch'
import { getFeedClientDataDir, resolveFeedUrl } from '../cache/refresh-source'
import { type HttpClient } from '../util/interfaces'
import { ScryfallClient } from '../scryfall'
import type { PriceData } from '../pricing/price-data'
import type { ScryfallCard } from '../scryfall/types'
import { ExitCode, getErrorMessage } from '../util/errors'
import { resolveRefreshCadence, resolveRefreshMs, scheduleRecurringTask } from '../cache/cadence'
import { CACHE_SERVER_LOG_PREFIX, PRICE_REFRESH_STAGGER_MS, WEEKLY_REFRESH_MS } from './constants'
import {
  createFileSystemClient,
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
import { PriceRefreshScheduler } from './scheduler'
import { type CacheServerCommandOptions, type PriceReadThroughResult } from './types'

interface BulkSetPayload {
  entries?: Record<string, PriceData> | Record<string, ScryfallCard[]>
}

interface PriceStreamPayload {
  keys?: string[]
}

interface SetValuePayload {
  value?: PriceData | ScryfallCard[]
}

interface PriceStreamTaskResult {
  key: string
  result: PriceReadThroughResult
}

interface CacheServerRuntime {
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
            controller.enqueue(
              sseEvent('error', {
                key,
                message: getErrorMessage(error),
              }),
            )
          }
        }

        await runStaggeredTasksInCompletionOrder(
          refreshQueue.map(
            (key) => async (): Promise<PriceStreamTaskResult> => ({
              key,
              result: await resolvePriceCacheReadThrough(
                localPriceCache,
                localScryfallClient,
                key,
                logCacheUpdate,
                priceRefreshScheduler,
                localCardCache,
              ),
            }),
          ),
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
            controller.enqueue(
              sseEvent('error', {
                key,
                message: getErrorMessage(error),
              }),
            )
          },
        )

        controller.enqueue(sseEvent('done', { count: emittedCount }))
        controller.close()
      })().catch((error) => {
        controller.enqueue(
          sseEvent('error', {
            message: getErrorMessage(error),
          }),
        )
        controller.close()
      })
    },
  })
}

function createCacheServerFetchHandler(
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
        return respond(new Response('Not Found', { status: 404 }))
      }

      const section = getSection(parts[1] ?? '')
      if (!section) {
        return respond(jsonResponse({ error: 'Invalid cache section.' }, 400))
      }

      if (parts.length === 2 && request.method === 'DELETE') {
        if (section === 'cards') {
          await localCardCache.clear()
        } else {
          await localPriceCache.clear()
          priceRefreshScheduler?.clearAll()
        }
        logCacheUpdate(`section=${section} action=clear`)
        return respond(new Response(null, { status: 204 }))
      }

      if (parts[2] === 'bulk' && request.method === 'PUT') {
        const payload = (await request.json()) as BulkSetPayload
        if (!payload.entries || typeof payload.entries !== 'object') {
          return respond(jsonResponse({ error: "Expected JSON body with 'entries' object." }, 400))
        }

        if (section === 'cards') {
          await localCardCache.bulkSet(payload.entries as Record<string, ScryfallCard[]>)
        } else {
          const entries = payload.entries as Record<string, PriceData>
          await localPriceCache.bulkSet(entries)
          if (priceRefreshScheduler) {
            for (const key of Object.keys(entries)) {
              priceRefreshScheduler.scheduleFromNow(key)
            }
          }
        }

        logCacheUpdate(
          `section=${section} action=bulk-set count=${Object.keys(payload.entries).length}`,
        )
        return respond(new Response(null, { status: 204 }))
      }

      if (section === 'prices' && parts[2] === 'stream' && request.method === 'POST') {
        const payload = (await request.json()) as PriceStreamPayload
        if (!Array.isArray(payload.keys) || !payload.keys.every((key) => typeof key === 'string')) {
          return respond(
            jsonResponse({ error: "Expected JSON body with 'keys' string array." }, 400),
          )
        }

        const keys = payload.keys.map((key) => key.trim()).filter((key) => key.length > 0)
        if (keys.length === 0) {
          return respond(jsonResponse({ error: 'At least one cache key is required.' }, 400))
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
        const key = decodeURIComponent(parts[2] ?? '')
        if (!key) {
          return respond(jsonResponse({ error: 'Cache key is required.' }, 400))
        }
        const timestamp =
          section === 'cards'
            ? await localCardCache.getTimestamp(key)
            : await localPriceCache.getTimestamp(key)
        return respond(jsonResponse({ timestamp }))
      }

      if (parts.length !== 3) {
        return respond(jsonResponse({ error: 'Invalid cache route.' }, 404))
      }

      const key = decodeURIComponent(parts[2] ?? '')
      if (!key) {
        return respond(jsonResponse({ error: 'Cache key is required.' }, 400))
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
        const payload = (await request.json()) as SetValuePayload
        if (!('value' in payload)) {
          return respond(jsonResponse({ error: "Expected JSON body with 'value'." }, 400))
        }

        if (section === 'cards') {
          await localCardCache.set(key, payload.value as ScryfallCard[])
        } else {
          await localPriceCache.set(key, payload.value as PriceData)
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

      return respond(jsonResponse({ error: 'Method not allowed.' }, 405))
    } catch (error) {
      console.error(`${CACHE_SERVER_LOG_PREFIX} Cache server request failed:`, error)
      return respond(
        jsonResponse(
          {
            error: 'Cache server request failed.',
            details: getErrorMessage(error),
          },
          500,
        ),
      )
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
        fetch: () => {
          throw new Error(
            'HTTP requests are denied (--deny-http). Pre-populate the cache for testing.',
          )
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
        console.error(
          `${CACHE_SERVER_LOG_PREFIX} Feed sync failed; falling back to Scryfall:`,
          error,
        )
      }
      if (result) {
        if (result.outcome === 'unchanged') {
          await localCardCache.bulkSet({})
          console.log(`${CACHE_SERVER_LOG_PREFIX} Cache feed is unchanged; cards are current.`)
        }
        logCacheUpdate(`section=cards action=${action} source=feed outcome=${result.outcome}`)
        if (options.seed) {
          // The cards are already ingested — a seeding failure is a
          // warning, never a reason to redo the refresh from Scryfall.
          try {
            await feedClient.seedAll(result.feed)
          } catch (error) {
            console.error(
              `${CACHE_SERVER_LOG_PREFIX} Seeding feed artifacts failed (cards already ingested):`,
              error,
            )
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
      console.error(`${CACHE_SERVER_LOG_PREFIX} Refreshing cards from Scryfall failed:`, error)
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
    const reason = cardCacheIsEmpty ? 'empty' : cardCacheIsStale ? 'stale' : 'seed'
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} Running startup cards refresh (${reason}, source: ${cacheSource})...`,
    )
    await refreshCards(`startup-preload reason=${reason}`)
  }

  if (cardsRefreshMs && cardsRefreshCadence) {
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh enabled: ${cardsRefreshCadence}`,
    )
    scheduleRecurringTask(
      cardsRefreshMs,
      async () => {
        await refreshCards('scheduled-preload')
        console.log(`${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh complete.`)
      },
      (error) =>
        console.error(`${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh failed:`, error),
    )
  }

  if (priceRefreshScheduler && pricesRefreshCadence) {
    await priceRefreshScheduler.initializeFromCache()
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} Scheduled prices cache refresh enabled: ${pricesRefreshCadence}`,
    )
  }

  const runtime: CacheServerRuntime = {
    localCardCache,
    localPriceCache,
    localScryfallClient,
    priceRefreshScheduler,
  }

  try {
    Bun.serve({
      hostname: options.host,
      port: options.port,
      fetch: createCacheServerFetchHandler(runtime, options.verbose ?? false),
    })
  } catch (e) {
    // Most likely the port is already in use.
    console.error(
      `${CACHE_SERVER_LOG_PREFIX} Failed to start the cache server:`,
      getErrorMessage(e),
    )
    process.exitCode = ExitCode.RuntimeError
    return
  }

  if (options.denyHttp) {
    console.log(`${CACHE_SERVER_LOG_PREFIX} HTTP requests denied (--deny-http).`)
    if (cacheSource === 'feed') {
      console.log(`${CACHE_SERVER_LOG_PREFIX} Feed mode disabled by --deny-http.`)
    }
  }
  if (options.verbose) {
    console.log(`${CACHE_SERVER_LOG_PREFIX} Verbose request logging enabled.`)
  }
  if (feedClient && options.seed) {
    const port = feedClient.torrentPortInUse()
    console.log(
      `${CACHE_SERVER_LOG_PREFIX} Seeding feed artifacts${port ? ` on TCP port ${port}` : ''}.`,
    )
  }
  console.log(
    `${CACHE_SERVER_LOG_PREFIX} Cache server listening on http://${options.host}:${options.port}`,
  )
}
