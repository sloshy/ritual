import { preloadCache } from '../../scryfall'
import { StreamingLogger, setLogger, resetLogger } from '../../logger'
import type { CacheProgressEvent } from '../../logger'
import { getErrorMessage } from '../../errors'
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

export async function handleCacheRefreshStream(): Promise<Response> {
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function sendEvent(eventType: string, data: object) {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
        try {
          controller.enqueue(encoder.encode(payload))
        } catch {
          // stream closed
        }
      }

      const logger = new StreamingLogger((event: CacheProgressEvent) => {
        sendEvent('progress', event)
      })

      setLogger(logger)
      try {
        await preloadCache()
        sendEvent('done', { message: 'Cache refreshed successfully' })
      } catch (error) {
        const msg = getErrorMessage(error)
        sendEvent('error', { message: msg })
      } finally {
        resetLogger()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
