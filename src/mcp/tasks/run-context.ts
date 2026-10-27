import type { ServerContext } from '@modelcontextprotocol/server'
import type { BuildClaim } from '../../admin/api/build-site'
import type { RouteProgressSink } from '../../util/progress'

/** What a task run hands the tool that does its work. */
export type TaskRun = {
  /** Where the work's progress goes: the task's status line. */
  onProgress: RouteProgressSink
  /** The build slot the task claimed before it was created (`build_site` only). */
  buildClaim?: BuildClaim
}

/**
 * Each task-backed tool run, keyed by the context the runtime hands the tool.
 * A plain call's context is never in here, which is how a tool tells the two
 * apart without a parameter of its own: the SDK passes the context object
 * through to the tool callback untouched (its tool executor forwards `ctx`
 * as-is; `task-runtime.test.ts` pins that progress arrives through it).
 */
const taskRuns = new WeakMap<ServerContext, TaskRun>()

/** Mark `ctx` as a task run. */
export function bindTaskRun(ctx: ServerContext, run: TaskRun): void {
  taskRuns.set(ctx, run)
}

/** The task run `ctx` belongs to, or `undefined` for a plain call. */
export function taskRunOf(ctx: ServerContext): TaskRun | undefined {
  return taskRuns.get(ctx)
}
