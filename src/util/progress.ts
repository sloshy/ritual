/**
 * The normalized progress vocabulary shared by every long-running route.
 *
 * Sibling of `src/sse.ts`: that module owns the *browser's* delivery channel
 * (per-feature SSE event maps with their own richer vocabularies); this one owns
 * the shape an in-process caller — today the MCP adapter — consumes. One handler,
 * two delivery channels, so the admin UI's SSE contracts never churn when a new
 * client wants a progress bar.
 */

/** One progress report from a long-running route, as any client renders it. */
export interface RouteProgress {
  /** Work done so far, on the same scale as `total`. Must increase across a run. */
  progress: number
  /** The scale's endpoint, when the route knows it. */
  total?: number
  /** A human-readable description of the current step. */
  message?: string
}

/**
 * Where a long-running route reports progress to an IN-PROCESS caller.
 *
 * The HTTP delivery of the same information is each feature's `/api/…/stream`
 * SSE route, which keeps its own richer per-feature event vocabulary; this is
 * the normalized form every client can render as a bar.
 *
 * Tasks-ready: when `io.modelcontextprotocol/tasks` becomes adoptable, a
 * task-backed call drives this same sink from its status updates — the routes
 * and engines below it need no change.
 */
export type RouteProgressSink = (report: RouteProgress) => void

/**
 * The report for item `index` (0-based) of `total`, as both syncs report one:
 * `progress` counts items *finished*, so starting item 0 of 3 is `0/3`, while
 * the message counts them 1-based the way a person reads them.
 */
export function itemStartProgress(label: string, index: number, total: number): RouteProgress {
  return { progress: index, total, message: `${label} (${index + 1}/${total})` }
}

/**
 * The terminal report of a run that counted items: everything finished.
 *
 * `total` must be the **same** number the run's {@link itemStartProgress}
 * reports counted against — the engine's item total — not a count taken from the
 * finished report. Those differ whenever an item never started, and a final frame
 * on a different scale is how a bar reaches 100% of a denominator it never saw
 * (or worse, goes backwards).
 */
export function itemsDoneProgress(total: number, message: string): RouteProgress {
  return { progress: total, total, message }
}
