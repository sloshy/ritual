/**
 * The decoder for the server-sent event frames `src/util/sse.ts` encodes, plus
 * the one way an integration test opens an admin stream: through the route
 * table, so the registration (method + path) is covered along with the
 * handler.
 *
 * Every streaming suite used to re-declare both by hand; the frame grammar
 * belongs in one place, beside the encoder it mirrors.
 */

import { expect } from 'bun:test'
import { dispatchRoute } from '../../src/admin/server'
import type { MessageKey } from '../../src/i18n/messages/en'
import { DEFAULT_LOCALE } from '../../src/i18n/runtime'
import type { SyncEvent, SyncLogLevel } from '../../src/sync/common'
import { renderSyncMessage } from '../../src/sync/message'

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

/** One streamed sync log line, as a client without a translator and one with read it. */
export type StreamedLine = {
  level: SyncLogLevel
  item: string | null
  message: string
  key: MessageKey | undefined
  /** The line rendered from its key and params in English — must equal `message`. */
  rendered: string
}

/**
 * Every `log` line among a sync stream's progress events, projected to what a
 * client reads — with the English re-rendered from the key and params, which is
 * how a test proves the two halves of a message agree after a trip through JSON.
 */
export function streamedLines(progress: readonly SyncEvent<unknown>[]): StreamedLine[] {
  return progress.flatMap((event): StreamedLine[] =>
    event.kind === 'log'
      ? [
          {
            level: event.level,
            item: event.item,
            message: event.message,
            key: event.messageKey,
            // From the key alone — never the English fallback — so an unknown
            // key or a param that did not survive JSON shows up as a mismatch.
            rendered:
              event.messageKey === undefined
                ? event.message
                : renderSyncMessage(
                    { messageKey: event.messageKey, messageParams: event.messageParams },
                    DEFAULT_LOCALE,
                  ),
          },
        ]
      : [],
  )
}

/**
 * Assert every streamed log line's two halves agree — its English re-rendered
 * from the key and params alone, nested ones included, after a trip through
 * JSON — and that every line is keyed: the engines word all of a clean run's
 * lines from the catalog, so a line without a key is one a reader cannot
 * render in its own language.
 */
export function expectStreamedLinesAgree(progress: readonly SyncEvent<unknown>[]): StreamedLine[] {
  const lines = streamedLines(progress)
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    expect(line.key).toBeDefined()
    expect(line.rendered).toBe(line.message)
  }
  return lines
}
