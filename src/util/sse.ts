/**
 * Server-sent event plumbing, shared by every streaming endpoint (the admin
 * cache refresh and deck sync today).
 *
 * The details worth owning in one place are the ones that are easy to omit:
 * enqueueing after the consumer has disconnected must not throw, and the stream
 * must be closed even when the producer fails.
 */

/** Encode one named event as an SSE frame. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Send one event on an open stream. Typed against an event map so a payload can
 * never be paired with the wrong event name.
 */
export type SseSend<EventMap> = <K extends keyof EventMap & string>(
  event: K,
  data: EventMap[K],
) => void

/**
 * Run `produce` against a fresh SSE stream and return the `Response` carrying it.
 *
 * Sending after the consumer has gone is a no-op, and the stream is always
 * closed once `produce` settles — a rejection included, so callers that want to
 * report a failure to the client must send their own `error` event first.
 */
export function sseResponse<EventMap extends object>(
  produce: (send: SseSend<EventMap>) => Promise<void>,
): Response {
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: SseSend<EventMap> = (event, data) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(event, data)))
        } catch {
          // Consumer disconnected; the producer runs to completion regardless.
        }
      }

      try {
        await produce(send)
      } finally {
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
