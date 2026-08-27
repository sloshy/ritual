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
import { apiMessage, type ApiMessage } from './result'
import { apiError } from './save-helpers'
import { getBaseDir } from '../../config/base-dir'
import { getSiteSellMode } from '../../config/ritual-config'
import { defaultDistDir, ritualArgv } from '../../site-build/dist-dir'
import {
  createBuildScratchDir,
  publishAtomically,
  STALE_BUILD_DIR_MAX_AGE_MS,
} from '../../site-build/publish'
import type { RouteProgressSink } from '../../util/progress'

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
const BUILD_CANCELLED_MESSAGE = 'The site build was cancelled.'

/**
 * Three transitions are reported on the scale: starting (0), building (1),
 * publishing (2), done (3).
 */
const BUILD_STEPS = 3

/**
 * Run the site build and publish it.
 *
 * `onProgress` reports the three structural steps the handler itself owns rather
 * than scraping the child's log lines — the same reason the cache refresh grew a
 * real callback seam. A finer scale becomes available the day `runBuildSite`
 * grows its own `onProgress`.
 *
 * `signal` cancels the build: the child is killed and the scratch directory
 * removed, leaving `dist/` untouched. This is the one long route that honours
 * cancellation, because it is the one whose partial state the scratch directory
 * makes fully recoverable.
 *
 * Tasks-ready: a future `io.modelcontextprotocol/tasks` adoption drives the same
 * two seams from a task's status updates and `tasks/cancel`.
 */
export function handleBuildSite(
  onProgress?: RouteProgressSink,
  signal?: AbortSignal,
  buildArgv: BuildSiteArgv = defaultBuildArgv,
): Promise<Response> {
  return apiHandler(async () => {
    if (buildInFlight) {
      return apiError('A site build is already running; wait for it to finish.', 503)
    }
    buildInFlight = true

    const baseDir = getBaseDir()
    const distDir = defaultDistDir()
    const startedAt = Date.now()

    // Everything after the flag is claimed runs inside the try, so a failure
    // setting the build up (an unwritable base dir, say) still releases it —
    // otherwise the server would refuse every later build with a 503.
    let onAbort: (() => void) | undefined
    let tmpDir: string | undefined
    try {
      // A caller that cancelled before the handler got this far gets the same
      // answer without a scratch directory or a child process being made first.
      if (signal?.aborted) return apiError(BUILD_CANCELLED_MESSAGE, 499)

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
      const stdoutText = new Response(proc.stdout).text().catch(() => '')
      const stderrText = new Response(proc.stderr).text().catch(() => '')

      // Awaited on its own, so a cancel answers as soon as the child is gone.
      // `sh -c 'sleep …; …'` forks rather than execs, and the orphan inherits the
      // pipes — waiting for those to reach EOF would make a cancelled build take
      // exactly as long as the build it cancelled.
      const exitCode = await proc.exited
      if (cancelled) {
        return apiError(BUILD_CANCELLED_MESSAGE, 499)
      }
      const stderr = await stderrText
      await stdoutText
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
