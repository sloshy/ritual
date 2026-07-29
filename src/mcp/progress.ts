import type { ProgressNotification, ServerContext } from '@modelcontextprotocol/server'
import type { RouteProgress, RouteProgressSink } from '../progress'

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
 * Tasks-ready: when the `io.modelcontextprotocol/tasks` extension becomes
 * adoptable, a task-backed call drives this same sink from its status updates —
 * the four long tools need no change beyond how the sink is obtained.
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
