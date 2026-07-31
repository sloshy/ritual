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
 * once it exits cleanly. `runBuildSite` clears its output directory before
 * rebuilding it, so a build interrupted in place used to leave a published site
 * with no `index.html` — broken rather than merely stale. With the swap, `dist/`
 * holds either the previous tree or the new one at every instant.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { apiHandler } from '../utils'
import { apiError } from './save-helpers'
import { getBaseDir } from '../../base-dir'
import { defaultDistDir, ritualArgv } from '../../site/dist-dir'
import type { RouteProgressSink } from '../../progress'

/** `POST /api/build-site` — the site build finished. */
export interface BuildSiteResponse {
  success: true
  message: string
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
const DEFAULT_ARGV: BuildSiteArgv = (outDir) =>
  ritualArgv(['--base-dir', getBaseDir(), 'build-site', '--out-dir', outDir])

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
 * How old a leftover build directory must be before the sweep will remove it.
 *
 * The sweep cannot tell *its* leftovers from another process's live scratch
 * directory — the admin server, `ritual mcp`, and a second admin instance all
 * write `.dist-build-*` under the same base directory, and `publishAtomically`
 * parks the previous site in `.dist-old-*` for the width of two renames. So the
 * rule is age, not name: nothing a concurrent build could still be holding is
 * touched, and a genuinely abandoned directory is collected on the next build.
 */
export const STALE_BUILD_DIR_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Scratch/parked directory name prefixes, both swept by {@link sweepStaleBuildDirs}. */
const BUILD_DIR_PREFIXES = ['.dist-build-', '.dist-old-'] as const

/**
 * Remove leftovers from an interrupted earlier build — those older than
 * {@link STALE_BUILD_DIR_MAX_AGE_MS}, so a concurrent build's scratch directory
 * (and the window in which `.dist-old-*` is the only copy of the published site)
 * is never swept out from under it. Best effort throughout.
 */
async function sweepStaleBuildDirs(baseDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(baseDir)
    const cutoff = Date.now() - STALE_BUILD_DIR_MAX_AGE_MS
    await Promise.all(
      entries
        .filter((name) => BUILD_DIR_PREFIXES.some((prefix) => name.startsWith(prefix)))
        .map(async (name) => {
          const dir = path.join(baseDir, name)
          const stats = await fs.stat(dir).catch(() => null)
          if (stats === null || stats.mtimeMs > cutoff) return
          await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
        }),
    )
  } catch {
    // The sweep is housekeeping; a build must not fail because of it.
  }
}

/**
 * Move `tmpDir` into `distDir`, keeping the published tree present throughout:
 * the previous tree is renamed aside first and removed only after the new one is
 * in place, and is restored if the second rename fails.
 *
 * **The rollback branch is deliberately uncovered.** Reaching it needs the second
 * `rename` to fail after the first succeeded — a cross-device or permissions
 * fault between two operations on the same parent directory, which no seam here
 * can fake without stubbing `node:fs` itself. It is three lines of straight-line
 * code guarding a case where the alternative is a missing `dist/`; a test that
 * mocked the module to reach it would pin the mock, not the behaviour.
 */
async function publishAtomically(tmpDir: string, distDir: string): Promise<void> {
  const parked = path.join(path.dirname(distDir), `.dist-old-${process.pid}-${Date.now()}`)
  const hadPrevious = await fs
    .stat(distDir)
    .then(() => true)
    .catch(() => false)

  if (hadPrevious) await fs.rename(distDir, parked)
  try {
    await fs.rename(tmpDir, distDir)
  } catch (error) {
    if (hadPrevious) await fs.rename(parked, distDir)
    throw error
  }
  if (hadPrevious) {
    await fs.rm(parked, { recursive: true, force: true }).catch(() => {
      console.error(`Could not remove the previous site build at ${parked}.`)
    })
  }
}

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
  buildArgv: BuildSiteArgv = DEFAULT_ARGV,
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

      await sweepStaleBuildDirs(baseDir)
      // Same parent as `dist/`, so the publishing rename is a same-filesystem move.
      tmpDir = await fs.mkdtemp(path.join(baseDir, '.dist-build-'))

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
        message: 'Site built successfully',
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
