import type { ProgressNotification, ServerContext } from '@modelcontextprotocol/server'
import type { RouteProgress, RouteProgressSink } from '../util/progress'
import type { CallApiOptions } from './dispatch'
import { taskRunOf } from './tasks/run-context'

/**
 * Bridge a tool call's in-process progress reports onto `notifications/progress`.
 *
 * Returns `undefined` when the client did not supply a `progressToken`, which is
 * the spec's opt-in: a server emits progress only for a request that asked for
 * it. The token appears on `ctx.mcpReq._meta.progressToken`, stamped by the
 * client only when it passed `onprogress` to the call.
 *
 * `notifications/progress` needs no declared capability, and `ctx.mcpReq.notify`
 * stamps `relatedRequestId` for us, which is what lets the per-request HTTP
 * transport route the frame — and, with the default `responseMode: 'auto'`,
 * upgrade the response to SSE so the frames arrive *during* the call.
 *
 * Note for a client driving a long tool: the SDK's default request timeout is
 * 60 seconds and `resetTimeoutOnProgress` defaults to `false`, so progress alone
 * does not keep a multi-minute call alive. That is a client-side option Ritual
 * cannot set.
 *
 * A task-backed call (see `tasks/runtime.ts`) never gets here with a token: the
 * spec forbids progress notifications for a task, so the runtime strips the
 * token and reports progress as the task's status instead — see
 * {@link toolCallOptions}.
 */
export function createToolProgressSink(ctx: ServerContext): RouteProgressSink | undefined {
  const progressToken = ctx.mcpReq._meta?.progressToken
  if (progressToken === undefined) return undefined

  // The spec requires progress to increase. The cache refresh's percentage is
  // throttled to ~10 reports a second and repeats a value freely, so the guard
  // is both the wire requirement and the flood control.
  let lastProgress: number | undefined

  return (report: RouteProgress): void => {
    if (ctx.mcpReq.signal.aborted) return
    if (lastProgress !== undefined && report.progress <= lastProgress) return
    lastProgress = report.progress

    const notification: ProgressNotification = {
      method: 'notifications/progress',
      params: { progressToken, ...report },
    }
    // A closed transport rejects with `NotConnected`; an unhandled rejection
    // would be strictly worse than a dropped progress frame.
    void ctx.mcpReq.notify(notification).catch(() => {})
  }
}

/**
 * The progress sink and cancellation signal a long tool hands its route.
 *
 * On a plain call: progress notifications (when the client asked for them) and
 * the request's own signal. On a task run: the task's status sink, the task's
 * own signal (which the runtime has already put on the context), and the build
 * slot a `build_site` task claimed — so a long tool is task-ready by obtaining
 * its options here and nowhere else.
 */
export function toolCallOptions(ctx: ServerContext): CallApiOptions {
  const run = taskRunOf(ctx)
  if (run === undefined) {
    return { onProgress: createToolProgressSink(ctx), signal: ctx.mcpReq.signal }
  }
  return { onProgress: run.onProgress, signal: ctx.mcpReq.signal, buildClaim: run.buildClaim }
}
