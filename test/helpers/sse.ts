/**
 * The decoder for the server-sent event frames `src/util/sse.ts` encodes, plus
 * the one way an integration test opens an admin stream: through the route
 * table, so the registration (method + path) is covered along with the
 * handler.
 *
 * Every streaming suite used to re-declare both by hand; the frame grammar
 * belongs in one place, beside the encoder it mirrors.
 */

import { dispatchRoute } from '../../src/admin/server'

/** One decoded frame: the event name and its JSON payload. */
export type SseFrame = { event: string; data: Record<string, unknown> }

/** Decode every frame of a finished stream body. */
export function parseSseFrames(text: string): SseFrame[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [eventLine = '', dataLine = ''] = chunk.split('\n')
      return {
        event: eventLine.replace('event: ', ''),
        data: JSON.parse(dataLine.replace('data: ', '')) as Record<string, unknown>,
      }
    })
}

/**
 * Open an admin SSE route in-process and collect every frame it emits. `path`
 * is the route's path with any query string (`/api/deck-sync/stream?direction=pull`).
 */
export async function readStreamFrames(path: string): Promise<SseFrame[]> {
  const dispatched = await dispatchRoute(new Request(`http://localhost${path}`), {
    clientIp: 'test',
    sessionToken: null,
  })
  if (!dispatched.matched) throw new Error(`No admin route for GET ${path.split('?')[0]}`)
  return parseSseFrames(await dispatched.response.text())
}
