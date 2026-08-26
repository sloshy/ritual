import { preloadCache } from '../../scryfall'
import type { CacheRefreshEvent, CacheRefreshProgressHandler } from '../../scryfall'
import { getErrorMessage } from '../../util/errors'
import { sseResponse } from '../../util/sse'
import type { RouteProgressSink } from '../../util/progress'
import { apiHandler } from '../utils'
import { collectCacheStatus, type CacheStatusResult } from '../../cache/status'
import { apiMessage, type ApiMessage } from './result'

/** `POST /api/cache/refresh` — the card cache was rebuilt from Scryfall. */
export interface CacheRefreshResponse extends ApiMessage {
  success: true
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

/** The whole refresh, on one 0–100 scale. */
const REFRESH_TOTAL = 100

/**
 * Map the engine's stages onto one monotonic 0–100 scale.
 *
 * `info` is deliberately not forwarded: a log line has no position on the scale,
 * so forwarding it would either repeat the last value or invent an increment.
 * Those lines stay on the SSE channel, which renders them as text.
 */
function cacheRefreshProgress(sink: RouteProgressSink): CacheRefreshProgressHandler {
  return (event: CacheRefreshEvent): void => {
    switch (event.stage) {
      case 'metadata':
        sink({ progress: 1, total: REFRESH_TOTAL, message: event.message })
        return
      case 'tags':
        sink({ progress: 2, total: REFRESH_TOTAL, message: event.message })
        return
      case 'download':
        // Only the percentage-carrying reports have a position; the "download
        // size" notice and the unknown-length variant do not.
        if (event.percentage === undefined) return
        sink({
          progress: 3 + Math.round(event.percentage * 0.95),
          total: REFRESH_TOTAL,
          message: event.message,
        })
        return
      case 'save':
        sink({ progress: 99, total: REFRESH_TOTAL, message: event.message })
        return
      case 'done':
        sink({ progress: REFRESH_TOTAL, total: REFRESH_TOTAL, message: event.message })
        return
      case 'info':
        return
      default: {
        // A stage added to the engine's vocabulary must be given a position on
        // this scale (or an explicit `return` like `info`'s), rather than
        // silently vanishing from every progress bar that reads it.
        const exhaustive: never = event.stage
        void exhaustive
        return
      }
    }
  }
}

/**
 * `POST /api/cache/refresh` — rebuild the card cache from Scryfall's bulk data.
 *
 * A failed refresh reaches {@link apiHandler} as an error rather than being
 * swallowed: a client that asked for a refresh has to be able to learn it did
 * not happen.
 */
export function handleCacheRefresh(onProgress?: RouteProgressSink): Promise<Response> {
  return apiHandler(async () => {
    await preloadCache(
      onProgress === undefined ? undefined : { onProgress: cacheRefreshProgress(onProgress) },
    )
    const resp: CacheRefreshResponse = { success: true, ...apiMessage('admin.api.cache.refreshed') }
    return Response.json(resp)
  })
}

/** The event vocabulary of `GET /api/cache/refresh/stream`. */
type CacheRefreshStreamEvents = {
  progress: CacheRefreshEvent
  done: ApiMessage
  error: ApiMessage
}

export function handleCacheRefreshStream(): Promise<Response> {
  const response = sseResponse<CacheRefreshStreamEvents>(async (send) => {
    try {
      await preloadCache({ onProgress: (event) => send('progress', event) })
      send('done', apiMessage('admin.api.cache.refreshed'))
    } catch (error) {
      // EventSource cannot read a non-2xx body, so a failure rides the stream.
      send('error', { message: getErrorMessage(error) })
    }
  })
  return Promise.resolve(response)
}
