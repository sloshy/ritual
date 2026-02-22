import { Command } from 'commander'
import * as fs from 'node:fs/promises'
import { CACHE_DIR, CACHE_FILE, FileCacheManager } from '../cache'
import { defaultHttpClient } from '../http'
import { ScryfallClient } from '../scryfall'
import { type PriceData, type ScryfallCard } from '../types'
import { parsePort, parseRefreshCadence, resolveRefreshCadence, resolveRefreshMs } from './cadence'
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
): PriceRefreshScheduler | null {
  if (!pricesRefreshMs) return null

  return new PriceRefreshScheduler(pricesRefreshMs, localPriceCache, async (key, reason) =>
    refreshPriceCacheEntry(
      localPriceCache,
      localScryfallClient,
      key,
      logCacheUpdate,
      reason === 'scheduled' ? 'scheduled-refresh' : 'manual-refresh',
    ),
  )
}

function createPriceStream(
  keys: string[],
  runtime: CacheServerRuntime,
): ReadableStream<Uint8Array> {
  const { localPriceCache, localScryfallClient, priceRefreshScheduler } = runtime

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
                message: error instanceof Error ? error.message : String(error),
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
                message: error instanceof Error ? error.message : String(error),
              }),
            )
          },
        )

        controller.enqueue(sseEvent('done', { count: emittedCount }))
        controller.close()
      })().catch((error) => {
        controller.enqueue(
          sseEvent('error', {
            message: error instanceof Error ? error.message : String(error),
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
            details: error instanceof Error ? error.message : String(error),
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

export function registerCacheServerCommand(program: Command): void {
  program
    .command('cache-server')
    .description('Start a local cache server for card and pricing data')
    .option('-p, --port <number>', 'Port for the cache server', parsePort, 4000)
    .option('--host <hostname>', 'Host interface for the cache server', '127.0.0.1')
    .option(
      '--cards-refresh <interval>',
      "Run full cards cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
      parseRefreshCadence,
    )
    .option(
      '--prices-refresh <interval>',
      "Run prices cache refresh on an interval (supported: 'daily', 'weekly', 'monthly')",
      parseRefreshCadence,
    )
    .option('-v, --verbose', 'Log every cache-server request', false)
    .action(async (options: CacheServerCommandOptions) => {
      await fs.mkdir(CACHE_DIR, { recursive: true })

      const localCardCache = new FileCacheManager(CACHE_FILE, 'cards', 0)
      const localPriceCache = new FileCacheManager(CACHE_FILE, 'prices')
      const localScryfallClient = new ScryfallClient(
        defaultHttpClient,
        localCardCache,
        createFileSystemClient(),
      )

      const cardsRefreshCadence = resolveRefreshCadence(
        options.cardsRefresh,
        'RITUAL_CACHE_SERVER_CARDS_REFRESH',
      )
      const cardsRefreshMs = resolveRefreshMs(
        options.cardsRefresh,
        'RITUAL_CACHE_SERVER_CARDS_REFRESH',
      )
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
      )

      const cardCacheIsEmpty = await localCardCache.isEmpty()
      const cardsLastRefreshedAt = await localCardCache.getLastRefreshedAt()
      const cardsStaleThresholdMs = cardsRefreshMs ?? WEEKLY_REFRESH_MS
      const cardCacheIsStale = isOlderThan(cardsLastRefreshedAt, cardsStaleThresholdMs)
      if (cardCacheIsEmpty || cardCacheIsStale) {
        const reason = cardCacheIsEmpty ? 'empty' : 'stale'
        console.log(`${CACHE_SERVER_LOG_PREFIX} Card cache is ${reason}; running full preload...`)
        await localScryfallClient.preloadCache()
        logCacheUpdate(`section=cards action=startup-preload reason=${reason}`)
      }

      if (cardsRefreshMs && cardsRefreshCadence) {
        console.log(
          `${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh enabled: ${cardsRefreshCadence}`,
        )
        setInterval(async () => {
          try {
            await localScryfallClient.preloadCache()
            logCacheUpdate('section=cards action=scheduled-preload')
            console.log(`${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh complete.`)
          } catch (error) {
            console.error(`${CACHE_SERVER_LOG_PREFIX} Scheduled cards cache refresh failed:`, error)
          }
        }, cardsRefreshMs)
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

      Bun.serve({
        hostname: options.host,
        port: options.port,
        fetch: createCacheServerFetchHandler(runtime, options.verbose ?? false),
      })

      if (options.verbose) {
        console.log(`${CACHE_SERVER_LOG_PREFIX} Verbose request logging enabled.`)
      }
      console.log(
        `${CACHE_SERVER_LOG_PREFIX} Cache server listening on http://${options.host}:${options.port}`,
      )
    })
}
