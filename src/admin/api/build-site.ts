/**
 * `POST /api/build-site` — publish the static site.
 *
 * The build runs as a child process rather than in-process (it is the one long
 * operation whose engine lives in `src/commands/` and prints to stdout), and it
 * is awaited asynchronously: Bun is single-threaded, so the old blocking
 * `execSync` stalled the entire admin server — and, over MCP, the entire MCP
 * process — for the several minutes a build takes.
 *
 * The child builds into a scratch directory that is swapped into `dist/` only
 * once it exits cleanly, so `dist/` holds either the previous tree or the new
 * one at every instant — and a cancelled build leaves the published site
 * untouched. The mechanism itself lives in `src/site/publish.ts`, shared with
 * `ritual build-site`, which now takes the same care on its own.
 */

import fs from 'node:fs/promises'
import { apiHandler } from '../utils'
import { apiMessage, pickMessage, type ApiMessage } from '../../api/result'
import { apiError, type ApiErrorResponse } from '../../api/http'
import { isRecord } from '../../util/json'
import { getErrorMessage } from '../../util/errors'
import { sseResponse } from '../../util/sse'
import { getBaseDir } from '../../config/base-dir'
import { getSiteSellMode } from '../../config/ritual-config'
import { defaultDistDir, ritualArgv } from '../../site-build/dist-dir'
import {
  createBuildScratchDir,
  publishAtomically,
  STALE_BUILD_DIR_MAX_AGE_MS,
} from '../../site-build/publish'
import type { RouteProgress, RouteProgressSink } from '../../util/progress'

// Re-exported: the sweep's age rule is shared with the CLI builder now, but this
// route is where its tests and callers have always addressed it.
export { STALE_BUILD_DIR_MAX_AGE_MS }

/** `POST /api/build-site` — the site build finished. */
export interface BuildSiteResponse extends ApiMessage {
  success: true
  /** The directory the build was published to (always the base dir's `dist/`). */
  outDir: string
  /** Wall-clock duration of the build, in milliseconds. */
  durationMs: number
}

/** Builds the child-process command line for a build publishing into `outDir`. */
export type BuildSiteArgv = (outDir: string) => string[]

/** Where the child's output goes, one line at a time, as it is printed. */
export type BuildOutputSink = (line: string) => void

/** Everything {@link handleBuildSite} takes beyond the request itself. */
export type BuildSiteRunOptions = {
  /**
   * The three structural steps the handler itself owns (see {@link BUILD_STEPS}),
   * rather than a scrape of the child's log lines — the same reason the cache
   * refresh grew a real callback seam.
   */
  onProgress?: RouteProgressSink
  /**
   * The child's stdout and stderr, line by line as they arrive. This is what a
   * live client shows between the three steps: a build prints what it is doing
   * for the minutes `Building…` would otherwise sit still.
   */
  onOutput?: BuildOutputSink
  /**
   * Cancels the build: the child is killed and the scratch directory removed,
   * leaving `dist/` untouched. This is the long route whose partial state the
   * scratch directory makes fully recoverable at any instant.
   */
  signal?: AbortSignal
  /** The child's command line; injectable so tests need not run a real build. */
  buildArgv?: BuildSiteArgv
}

// The base dir is passed explicitly: the child inherits this process's
// environment, so without the flag an exported RITUAL_BASE_DIR would outrank
// the spawn's `cwd` and silently build a different workspace than the server's.
//
// `--sell-mode` is forwarded whenever sell mode is effectively on, because a
// `ritual admin --sell-mode` run sets a *process-global* override that cannot
// cross a spawn boundary — without this the server would advertise sell mode
// and then publish a site with it off. Passing it when the config would have
// enabled it anyway is harmless: the flag is enable-only.
export const defaultBuildArgv: BuildSiteArgv = (outDir) =>
  ritualArgv([
    '--base-dir',
    getBaseDir(),
    'build-site',
    '--out-dir',
    outDir,
    ...(getSiteSellMode() ? ['--sell-mode'] : []),
  ])

/**
 * One build at a time. A second concurrent build would race the swap and fight
 * over the shared card cache. Refused with 503 rather than 409 deliberately:
 * the MCP layer maps 409 to its conflict code, whose canned recovery advice
 * ("re-read the list with get_list") would be actively wrong here.
 */
let buildInFlight = false

/** How much of the child's stderr a failure message carries. */
const STDERR_TAIL_CHARS = 2000

/**
 * The 499 body a cancelled build answers with. `dist/` is untouched either way —
 * the build never leaves its scratch directory until it has exited cleanly.
 */
function buildCancelled(): Response {
  return apiError(apiMessage('admin.api.buildSite.cancelled'), 499)
}

/**
 * How long the handler waits for the child's pipes to reach EOF after it
 * exited. A build that forked a helper which inherited the pipes would
 * otherwise hold the response — and the one-at-a-time flag — until that
 * helper died.
 */
const PIPE_DRAIN_GRACE_MS = 2_000

/**
 * Three transitions are reported on the scale: starting (0), building (1),
 * publishing (2), done (3).
 */
const BUILD_STEPS = 3

/**
 * Drain a child's output stream, handing each complete line to `onLine` as it
 * arrives and returning the stream's last {@link STDERR_TAIL_CHARS} once it
 * ends.
 *
 * Read incrementally rather than collected with `Response.text()`: the point of
 * the line callback is that a client sees the build's log *during* the minutes
 * it runs. Only a tail is kept, because a failure's message carries the end of
 * stderr and nothing reads the rest — a build prints tens of megabytes. A bare
 * `\r` ends a line too: the build's progress meter redraws one line with
 * carriage returns, and treating those as one endless line would hold every
 * frame of a bulk download back until the next newline.
 */
async function drainLines(
  stream: ReadableStream<Uint8Array>,
  onLine: BuildOutputSink | undefined,
): Promise<string> {
  const decoder = new TextDecoder()
  let tail = ''
  let pending = ''
  const emit = (piece: string): void => {
    tail = (tail + piece).slice(-STDERR_TAIL_CHARS)
    if (!onLine) return
    pending += piece
    const lines = pending.split(/\r\n|\n|\r/)
    pending = lines.pop() ?? ''
    for (const line of lines) if (line.length > 0) onLine(line)
  }
  for await (const chunk of stream) emit(decoder.decode(chunk, { stream: true }))
  emit(decoder.decode())
  if (onLine && pending.length > 0) onLine(pending)
  return tail
}

/**
 * Run the site build and publish it.
 *
 * The options are the handler's seams — step progress, the child's output, and
 * cancellation — described on {@link BuildSiteRunOptions}. A finer progress
 * scale becomes available the day `runBuildSite` grows its own `onProgress`.
 *
 * Tasks-ready: a future `io.modelcontextprotocol/tasks` adoption drives the same
 * seams from a task's status updates and `tasks/cancel`.
 */
export function handleBuildSite(options: BuildSiteRunOptions = {}): Promise<Response> {
  const { onProgress, onOutput, signal } = options
  const buildArgv = options.buildArgv ?? defaultBuildArgv
  return apiHandler(async () => {
    if (buildInFlight) {
      return apiError('A site build is already running; wait for it to finish.', 503)
    }
    buildInFlight = true

    // Everything after the flag is claimed runs inside the try — the base-dir
    // reads included, which are what throws on an invalid workspace — so a
    // failure setting the build up still releases it. Otherwise the server
    // would refuse every later build with a 503.
    let onAbort: (() => void) | undefined
    let tmpDir: string | undefined
    try {
      const baseDir = getBaseDir()
      const distDir = defaultDistDir()
      const startedAt = Date.now()

      // A caller that cancelled before the handler got this far gets the same
      // answer without a scratch directory or a child process being made first.
      if (signal?.aborted) return buildCancelled()

      // Beside `dist/`, so the publishing rename is a same-filesystem move; the
      // helper sweeps abandoned scratch directories from earlier runs first.
      tmpDir = await createBuildScratchDir(distDir)

      onProgress?.({ progress: 0, total: BUILD_STEPS, message: 'Starting site build…' })

      const proc = Bun.spawn(buildArgv(tmpDir), {
        cwd: baseDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })

      let cancelled = false
      if (signal) {
        onAbort = (): void => {
          cancelled = true
          proc.kill()
        }
        // Aborting between the check above and the spawn is a real (if narrow)
        // race, so the listener is still armed against an already-aborted signal.
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }

      onProgress?.({ progress: 1, total: BUILD_STEPS, message: 'Building…' })
      // Drained concurrently with the wait, not after it: a build prints far more
      // than a pipe buffer holds, and a child blocked writing to a full pipe
      // never exits. The `catch` keeps an early return below from leaving an
      // unhandled rejection behind.
      const stdoutText = drainLines(proc.stdout, onOutput).catch(() => '')
      const stderrText = drainLines(proc.stderr, onOutput).catch(() => '')

      // Awaited on its own, so a cancel answers as soon as the child is gone.
      // `sh -c 'sleep …; …'` forks rather than execs, and the orphan inherits the
      // pipes — waiting for those to reach EOF would make a cancelled build take
      // exactly as long as the build it cancelled.
      const exitCode = await proc.exited
      if (cancelled) return buildCancelled()
      // Bounded for the same reason: a helper the build forked may still hold
      // the pipes. The tail is best-effort, and the output lines that matter
      // have already been forwarded as they arrived.
      const [stderr] = await Promise.race([
        Promise.all([stderrText, stdoutText]),
        Bun.sleep(PIPE_DRAIN_GRACE_MS).then((): [string, string] => ['', '']),
      ])
      if (exitCode !== 0) {
        const tail = stderr.trim().slice(-STDERR_TAIL_CHARS)
        return apiError(`Site build failed (exit ${exitCode}). ${tail}`.trim(), 500)
      }

      onProgress?.({ progress: 2, total: BUILD_STEPS, message: 'Publishing to dist/…' })
      await publishAtomically(tmpDir, distDir)

      const durationMs = Date.now() - startedAt
      onProgress?.({
        progress: BUILD_STEPS,
        total: BUILD_STEPS,
        message: 'Site built successfully',
      })
      const resp: BuildSiteResponse = {
        success: true,
        ...apiMessage('admin.api.buildSite.built'),
        outDir: distDir,
        durationMs,
      }
      return Response.json(resp)
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
      buildInFlight = false
      if (tmpDir !== undefined) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  })
}

/**
 * One `progress` frame of `GET /api/build-site/stream`: a structural step of
 * the build, or one line of the child's output. The same `kind`-discriminated
 * shape the sync streams use, so a client folds it with one switch.
 */
export type BuildSiteStreamEvent =
  | ({ kind: 'step' } & RouteProgress)
  | { kind: 'output'; line: string }

/** `event: done` payload — the same fields the JSON endpoint returns. */
export type BuildSiteDoneEvent = ApiMessage & Pick<BuildSiteResponse, 'outDir' | 'durationMs'>

/** Whether the JSON handler's body is the success it answers a published build with. */
function isBuildSiteSuccess(body: unknown): body is BuildSiteResponse {
  return isRecord(body) && body.success === true && typeof body.outDir === 'string'
}

/** The event vocabulary of the build stream. */
type BuildSiteStreamEvents = {
  progress: BuildSiteStreamEvent
  done: BuildSiteDoneEvent
  error: ApiMessage
}

/**
 * `GET /api/build-site/stream` — the same build as `POST /api/build-site`,
 * streamed: one `progress` frame per step and per output line, then a single
 * `done` (with where it published and how long it took) or `error`.
 *
 * Built on the JSON handler rather than beside it, so the two cannot disagree
 * about the one-at-a-time guard, the scratch directory, or the publish. A
 * refusal (a build already running) or a failure rides the stream as `error`:
 * `EventSource` exposes no response body for a non-2xx open.
 *
 * Closing the stream does not cancel the build — it runs to completion and
 * publishes, exactly as a dropped sync stream leaves its run in flight.
 */
export function handleBuildSiteStream(buildArgv?: BuildSiteArgv): Promise<Response> {
  const response = sseResponse<BuildSiteStreamEvents>(async (send) => {
    try {
      const resp = await handleBuildSite({
        onProgress: (report) => send('progress', { kind: 'step', ...report }),
        onOutput: (line) => send('progress', { kind: 'output', line }),
        buildArgv,
      })
      const body: unknown = await resp.json()
      if (!isBuildSiteSuccess(body)) {
        // Every refusal the JSON handler makes carries the shared error body.
        send('error', pickMessage(body as ApiErrorResponse))
        return
      }
      send('done', { ...pickMessage(body), outDir: body.outDir, durationMs: body.durationMs })
    } catch (error) {
      send('error', { message: getErrorMessage(error) })
    }
  })
  return Promise.resolve(response)
}
