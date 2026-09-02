/**
 * The HTTP shape both sync endpoints share: a JSON run, an SSE stream of the
 * same run, and the progress mapping in front of them.
 *
 * `deck-sync` and `collection-sync` differ in what they validate, what they run,
 * and how they summarize a finished report — and in nothing else. Those three
 * are the {@link SyncRouteConfig} below; everything around them (the refusal
 * body, the progress scale, the `done`/`error` frames, the order the pieces run
 * in) is declared once here so the two endpoints cannot answer differently.
 */

import { getErrorMessage } from '../../util/errors'
import { readJsonObjectBody } from '../../api/http'
import { apiHandler } from '../utils'
import { pickMessage, type ApiMessage } from '../../api/result'
import { itemStartProgress, itemsDoneProgress, type RouteProgressSink } from '../../util/progress'
import { sseResponse } from '../../util/sse'
import type { SyncEvent, SyncEventHandler } from '../../sync/common'
import { renderSyncSummaryEnglish, type SyncSummary } from './sync-summary'

/** The outcome of a run attempt: either a finished report or a reason it never started. */
export type SyncRunOutcome<TReport> =
  | { ok: true; report: TReport }
  | (ApiMessage & { ok: false; status: number; loginRequired: boolean })

/**
 * A run endpoint's response. `success` says whether the run could be performed
 * at all — one that completed with individual items failing is a success
 * carrying a non-zero `report.failedCount` (and, for collection syncs, per-run
 * failure detail in `report.errors`).
 */
export type SyncRunResponse<TReport> =
  | (ApiMessage & { success: true; report: TReport; summary: SyncSummary })
  | (ApiMessage & { success: false; loginRequired: boolean })

/** `event: done` payload — the same shape the JSON endpoint returns. */
export type SyncDoneEvent<TReport> = ApiMessage & { report: TReport; summary: SyncSummary }

/** `event: error` payload for a run that never produced a report. */
export type SyncErrorEvent = ApiMessage & { loginRequired: boolean }

/** The event vocabulary of a sync stream, name paired with payload. */
type SyncStreamEvents<TReport, TResult> = {
  progress: SyncEvent<TResult>
  done: SyncDoneEvent<TReport>
  error: SyncErrorEvent
}

/** What one endpoint contributes: its validation, its run, and its summary. */
export type SyncRouteConfig<TRequest, TReport, TResult> = {
  /** Validate a POST body: the request, or a message saying why it is not one. */
  parseBody: (value: unknown) => TRequest | string
  /** Validate the query string an `EventSource` opens the stream with. */
  parseQuery: (params: URLSearchParams) => TRequest | string
  /**
   * Run the sync. `signal` is an in-process caller's cancellation (the MCP
   * adapter's); the engines honour it at item boundaries and report what they
   * never reached as skipped, so a cancelled run still answers with a report.
   */
  perform: (
    request: TRequest,
    onEvent?: SyncEventHandler<TResult>,
    signal?: AbortSignal,
  ) => Promise<SyncRunOutcome<TReport>>
  /** The finished run as keyed clauses; the request carries what the summary needs. */
  summarize: (report: TReport, request: TRequest) => SyncSummary
}

/**
 * A run that never started, as the JSON endpoint reports it. Takes the whole
 * message triple so a keyed refusal keeps its key on the way out.
 */
function refused<TReport>(reason: ApiMessage, status: number, loginRequired = false): Response {
  const body: SyncRunResponse<TReport> = { success: false, ...pickMessage(reason), loginRequired }
  return Response.json(body, { status })
}

/** A run's event mapper plus the scale its reports counted against. */
type SyncProgressMapping<TResult> = {
  onEvent: SyncEventHandler<TResult>
  scale: () => number
}

/**
 * Map an engine's events onto the shared progress scale, and report the scale
 * they counted against.
 *
 * Only `item-start` advances it: a `log` line has no position on the scale, and
 * forwarding one would either repeat the last value (the spec wants progress to
 * increase) or invent a fake increment. Log lines stay on the SSE channel, where
 * the admin UI renders them as text. The scale is `0` until an event says
 * otherwise, which is also the honest scale for a run that synced nothing. A
 * collection sync's pull and push loops both emit `item-start`, but only one
 * runs per direction, so the scale stays monotonic.
 */
function progressMapping<TResult>(sink: RouteProgressSink): SyncProgressMapping<TResult> {
  let total = 0
  return {
    onEvent: (event: SyncEvent<TResult>): void => {
      if (event.kind !== 'item-start') return
      total = event.total
      sink(itemStartProgress(`Syncing ${event.item}`, event.index, event.total))
    },
    scale: () => total,
  }
}

/**
 * `POST /api/{deck,collection}-sync`: validate the body, run, and report.
 *
 * `signal` cancels the run between items (see {@link SyncRouteConfig.perform});
 * the response is then the ordinary report with its `cancelled` flag set, not
 * an error — the items already synced are real and the caller needs to see
 * them.
 */
export function runSyncRoute<TRequest, TReport, TResult>(
  req: Request,
  onProgress: RouteProgressSink | undefined,
  config: SyncRouteConfig<TRequest, TReport, TResult>,
  signal?: AbortSignal,
): Promise<Response> {
  return apiHandler(async () => {
    const parsedBody = await readJsonObjectBody(req)
    if (!parsedBody.ok) return parsedBody.response

    const parsed = config.parseBody(parsedBody.body)
    // A validation message is composed from the caller's own field names, so it
    // carries no catalog key — the English text is the whole of it.
    if (typeof parsed === 'string') return refused<TReport>({ message: parsed }, 400)

    const mapping = onProgress === undefined ? undefined : progressMapping<TResult>(onProgress)
    const outcome = await config.perform(parsed, mapping?.onEvent, signal)
    if (!outcome.ok) return refused<TReport>(outcome, outcome.status, outcome.loginRequired)

    const summary = config.summarize(outcome.report, parsed)
    const message = renderSyncSummaryEnglish(summary)
    // On the engine's scale, not the report's length: the report also holds
    // items that never emitted an `item-start`, so counting it would move the
    // denominator out from under every frame already sent.
    if (mapping) onProgress?.(itemsDoneProgress(mapping.scale(), message))
    const body: SyncRunResponse<TReport> = {
      success: true,
      message,
      summary,
      report: outcome.report,
    }
    return Response.json(body)
  })
}

/**
 * `GET /api/{deck,collection}-sync/stream`: one `progress` frame per
 * {@link SyncEvent}, then a single `done` (with the report) or `error`.
 *
 * Failures are reported *inside* the stream rather than as an HTTP status,
 * because `EventSource` exposes no response body for a non-2xx open.
 */
export function streamSyncRoute<TRequest, TReport, TResult>(
  req: Request,
  config: SyncRouteConfig<TRequest, TReport, TResult>,
): Promise<Response> {
  const parsed = config.parseQuery(new URL(req.url).searchParams)

  const response = sseResponse<SyncStreamEvents<TReport, TResult>>(async (send) => {
    try {
      if (typeof parsed === 'string') {
        send('error', { message: parsed, loginRequired: false })
        return
      }
      const outcome = await config.perform(parsed, (event) => send('progress', event))
      if (!outcome.ok) {
        send('error', { ...pickMessage(outcome), loginRequired: outcome.loginRequired })
        return
      }
      const summary = config.summarize(outcome.report, parsed)
      const message = renderSyncSummaryEnglish(summary)
      send('done', { message, summary, report: outcome.report })
    } catch (error) {
      send('error', { message: getErrorMessage(error), loginRequired: false })
    }
  })
  return Promise.resolve(response)
}
