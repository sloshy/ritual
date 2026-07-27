/**
 * The server-sent event driver behind the sync pages.
 *
 * Both sync endpoints stream a run the same way — `progress` frames, then a
 * single `done` or `error` — and both pages have to cope with the same two
 * connection failures, which are told apart only by whether a frame has already
 * arrived: a stream that never connected (a proxy that buffers server-sent
 * events) can be retried as a plain request, while one that dropped mid-run has
 * left a run underway on the server and must not be re-issued.
 *
 * Payloads are typed by the caller: every frame is JSON the endpoint promised,
 * and a frame that is not is handed over as `null` rather than aborting the run.
 */

/** An open stream, for closing on unmount. */
export type SyncStream = { close: () => void }

export type SyncStreamHandlers<Progress, Done, Failure> = {
  /** One `progress` frame. Frames that fail to parse are dropped, not reported. */
  progress: (event: Progress) => void
  /** The run finished; `null` when the payload could not be read. */
  done: (event: Done | null) => void
  /** The run was refused or failed outright; `null` when the payload could not be read. */
  failed: (event: Failure | null) => void
  /**
   * The connection itself failed. `received` says whether any frame had already
   * arrived: `false` means the stream never worked and the run can safely be
   * retried over plain JSON, `true` means a run is already in flight server-side.
   */
  disconnected: (received: boolean) => void
}

/** One frame's payload, or null when it is not the JSON the endpoint promised. */
function parseFrame<T>(data: unknown): T | null {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data) as T
  } catch {
    return null
  }
}

/**
 * Open a sync stream. Returns null when `EventSource` cannot be constructed at
 * all, which is the caller's cue to fall back to the non-streaming endpoint.
 */
export function openSyncStream<Progress, Done, Failure>(
  url: string,
  handlers: SyncStreamHandlers<Progress, Done, Failure>,
): SyncStream | null {
  let source: EventSource
  try {
    source = new EventSource(url)
  } catch {
    return null
  }

  // Whether the server is known to have started the run, which is what separates
  // "never connected" (safe to retry over plain JSON) from "dropped mid-run"
  // (a run is already underway and must not be issued twice).
  //
  // Set on `open` as well as on the first frame: both engines fetch from
  // Archidekt before emitting anything, so a stream that connected and dropped
  // during that window has still started a run. A proxy that buffers
  // server-sent events withholds the headers too, so the fallback the flag
  // guards still fires when it is actually needed.
  let received = false

  /**
   * An event's payload. Read through one narrowing for all three listeners: a
   * connection-level `error` really is a bare `Event`, so `data` cannot simply
   * be asserted into existence.
   */
  const payloadOf = (e: Event): unknown =>
    'data' in e ? (e as MessageEvent<unknown>).data : undefined

  source.addEventListener('open', () => {
    received = true
  })

  source.addEventListener('progress', (e: Event) => {
    received = true
    const event = parseFrame<Progress>(payloadOf(e))
    // A malformed frame is skipped rather than aborting a run that is otherwise
    // proceeding normally.
    if (event !== null) handlers.progress(event)
  })

  source.addEventListener('done', (e: Event) => {
    source.close()
    handlers.done(parseFrame<Done>(payloadOf(e)))
  })

  source.addEventListener('error', (e: Event) => {
    source.close()
    const data = payloadOf(e)
    // A payload-less error is the browser reporting the connection, not the
    // server reporting the run.
    if (data === undefined || data === null || data === '') {
      handlers.disconnected(received)
      return
    }
    handlers.failed(parseFrame<Failure>(data))
  })

  return { close: () => source.close() }
}
