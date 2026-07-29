import { preloadCache } from '../../scryfall'
import { StreamingLogger, setLogger, resetLogger } from '../../logger'
import type { CacheProgressEvent } from '../../logger'
import { getErrorMessage } from '../../errors'
import { sseResponse } from '../../sse'
import { apiHandler } from '../utils'
import { collectCacheStatus, type CacheStatusResult } from '../../cache/status'

/** `POST /api/cache/refresh` — the card cache was rebuilt from Scryfall. */
export interface CacheRefreshResponse {
  success: true
  message: string
}

/** `GET /api/cache/status` body: the collector's report, flattened onto the success envelope. */
export interface CacheStatusResponse extends CacheStatusResult {
  success: true
}

/**
 * `GET /api/cache/status` — report the card cache's size, freshness, tag
 * coverage, and source. The same data `ritual cache status --output json`
 * prints. Diagnostic only: collecting it never refreshes or writes the cache.
 */
export function handleCacheStatus(): Promise<Response> {
  return apiHandler(async () => {
    const resp: CacheStatusResponse = { success: true, ...(await collectCacheStatus()) }
    return Response.json(resp)
  })
}

export function handleCacheRefresh(): Promise<Response> {
  return apiHandler(async () => {
    await preloadCache()
    const resp: CacheRefreshResponse = { success: true, message: 'Cache refreshed successfully' }
    return Response.json(resp)
  })
}

/** The event vocabulary of `GET /api/cache/refresh/stream`. */
type CacheRefreshStreamEvents = {
  progress: CacheProgressEvent
  done: { message: string }
  error: { message: string }
}

export function handleCacheRefreshStream(): Promise<Response> {
  const response = sseResponse<CacheRefreshStreamEvents>(async (send) => {
    setLogger(new StreamingLogger((event: CacheProgressEvent) => send('progress', event)))
    try {
      await preloadCache()
      send('done', { message: 'Cache refreshed successfully' })
    } catch (error) {
      send('error', { message: getErrorMessage(error) })
    } finally {
      resetLogger()
    }
  })
  return Promise.resolve(response)
}
