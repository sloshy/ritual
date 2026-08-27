/**
 * Publishing a built site without ever leaving the published directory broken.
 *
 * A build used to clear its output directory before writing it, so a failure
 * partway through (a cold network, an empty cache, a bad card) left the site
 * *gone* rather than merely stale. Both builders — `ritual build-site` and the
 * admin `POST /api/build-site` route — now build into a scratch directory beside
 * the target and rename it into place only once the build has succeeded, so the
 * directory is replaced wholesale rather than emptied and refilled.
 *
 * One implementation, two callers: the admin route grew this first, and the CLI
 * inheriting it (rather than a second copy) is what keeps the guarantee the docs
 * make true of every build.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * How old a leftover build directory must be before the sweep will remove it.
 *
 * The sweep cannot tell *its* leftovers from another process's live scratch
 * directory — a CLI build, the admin server, `ritual mcp`, and a second admin
 * instance all write `.dist-build-*` beside the same `dist/`, and
 * {@link publishAtomically} parks the previous site in `.dist-old-*` for the
 * width of two renames. So the rule is age, not name: nothing a concurrent build
 * could still be holding is touched, and a genuinely abandoned directory is
 * collected on the next build.
 */
export const STALE_BUILD_DIR_MAX_AGE_MS = 6 * 60 * 60 * 1000

/** Scratch/parked directory name prefixes, both swept by {@link sweepStaleBuildDirs}. */
const BUILD_DIR_PREFIXES = ['.dist-build-', '.dist-old-'] as const

/**
 * Remove leftovers from an interrupted earlier build in `dir` — those older than
 * {@link STALE_BUILD_DIR_MAX_AGE_MS}. Best effort throughout: housekeeping must
 * never fail a build.
 */
export async function sweepStaleBuildDirs(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir)
    const cutoff = Date.now() - STALE_BUILD_DIR_MAX_AGE_MS
    await Promise.all(
      entries
        .filter((name) => BUILD_DIR_PREFIXES.some((prefix) => name.startsWith(prefix)))
        .map(async (name) => {
          const full = path.join(dir, name)
          const stats = await fs.stat(full).catch(() => null)
          if (stats === null || stats.mtimeMs > cutoff) return
          await fs.rm(full, { recursive: true, force: true }).catch(() => {})
        }),
    )
  } catch {
    // The sweep is housekeeping; a build must not fail because of it.
  }
}

/**
 * Create the scratch directory a build for `distDir` writes into.
 *
 * Made beside `distDir` so the publishing rename is a same-filesystem move, and
 * preceded by a sweep of abandoned scratch directories from earlier runs.
 *
 * The mode is reset from `mkdtemp`'s private `0700` to what `mkdir` would have
 * produced, because this directory *becomes* the published site: a `dist/` only
 * its owner can enter is not servable by an `nginx`/`www-data` that reads it,
 * and the directory the build replaced was world-readable.
 */
export async function createBuildScratchDir(distDir: string): Promise<string> {
  const parent = path.dirname(path.resolve(distDir))
  await fs.mkdir(parent, { recursive: true })
  await sweepStaleBuildDirs(parent)
  const dir = await fs.mkdtemp(path.join(parent, '.dist-build-'))
  // `process.umask()` with no argument only reads the mask; it does not set it.
  await fs.chmod(dir, 0o777 & ~process.umask())
  return dir
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
export async function publishAtomically(tmpDir: string, distDir: string): Promise<void> {
  // Resolved exactly as `createBuildScratchDir` resolves it, so both helpers
  // park and build in the same directory even for a relative `distDir`.
  const parked = path.join(
    path.dirname(path.resolve(distDir)),
    `.dist-old-${process.pid}-${Date.now()}`,
  )
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
 * Run `build` against a scratch directory and publish it into `distDir` only on
 * success. A build that throws, or that reports failure by returning `false`,
 * leaves the previously published site exactly as it was.
 *
 * @returns whatever `build` returned, after the swap.
 */
export async function buildAndPublish(
  distDir: string,
  build: (buildDir: string) => Promise<boolean>,
): Promise<boolean> {
  const buildDir = await createBuildScratchDir(distDir)
  try {
    const succeeded = await build(buildDir)
    if (!succeeded) return false
    await publishAtomically(buildDir, distDir)
    return true
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {})
  }
}
