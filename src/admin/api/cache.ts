import { preloadCache } from '../../scryfall'
import { StreamingLogger, setLogger, resetLogger } from '../../logger'
import type { CacheProgressEvent } from '../../logger'
import { getErrorMessage } from '../../errors'
import { sseResponse } from '../../sse'
import { apiHandler } from '../utils'

interface CacheRefreshResponse {
  success: boolean
  message: string
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
