/**
 * Moving a workspace's legacy `cache/` folder into the cache directory it now
 * resolves to (the per-user shared cache, unless `RITUAL_CACHE_DIR` or the
 * `cacheDir` key names another). Used by workspace migration 3
 * (`src/migrate/migrations.ts`), which plans with {@link legacyCacheAction} and
 * applies with {@link moveLegacyCache}.
 *
 * The rule: a cache is only ever moved into a target that holds no cache data,
 * and nothing is deleted that the target did not receive. When the target
 * already has data (another workspace filled it first), the legacy folder is
 * left exactly as it is for the user to delete. A move interrupted part-way
 * leaves a marker in the target, so the next run resumes it rather than
 * mistaking the half-filled target for another workspace's cache.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { renameWithRetry } from '../util/atomic-write'
import { hasErrorCode } from '../util/errors'
import { createDefaultFileSystemClient } from '../util/interfaces'
import { isSameFile } from '../util/same-file'
import { CACHE_LOCK_FILENAME, withCacheLock } from './lock'

/** The workspace-relative folder every workspace kept its cache in before the shared cache. */
export const LEGACY_CACHE_DIR = 'cache'

/** Written into the target while a move runs; its presence means "resume me". */
export const CACHE_MOVE_MARKER = '.ritual-cache-move'

/** Entries that are bookkeeping, not cache data. */
const NOT_DATA: ReadonlySet<string> = new Set([CACHE_LOCK_FILENAME, CACHE_MOVE_MARKER])

/** A directory's entries, or none when it does not exist (or is not a directory). */
async function entriesOf(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir)
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT') || hasErrorCode(e, 'ENOTDIR')) return []
    throw e
  }
}

/**
 * Whether a cache directory holds cache data: any entry but the cache-write
 * lock file and the move marker. A missing directory holds none.
 */
export async function hasCacheData(dir: string): Promise<boolean> {
  return (await entriesOf(dir)).some((entry) => !NOT_DATA.has(entry))
}

/** Whether a move into `dir` was interrupted and should be resumed. */
async function moveInterrupted(dir: string): Promise<boolean> {
  return (await entriesOf(dir)).includes(CACHE_MOVE_MARKER)
}

/**
 * Whether `child` is `parent` or lies inside it, by path. A name that merely
 * starts with two dots (`..cache`) is inside.
 */
function isSameOrWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child)
  if (relative === '') return true
  if (path.isAbsolute(relative)) return false
  return relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/** Whether one path is the other or lies inside it. */
export function pathsOverlap(a: string, b: string): boolean {
  return isSameOrWithin(a, b) || isSameOrWithin(b, a)
}

/** `dir` with symlinks resolved, or as given when it does not exist yet. */
async function realOrResolved(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir)
  } catch {
    return path.resolve(dir)
  }
}

/**
 * Whether the two directories overlap on disk: by path once symlinks are
 * resolved, or as one directory reached by two spellings (a case-insensitive
 * file system's `Cache` and `cache`).
 */
async function dirsOverlap(a: string, b: string): Promise<boolean> {
  if (pathsOverlap(await realOrResolved(a), await realOrResolved(b))) return true
  return isSameFile(a, b)
}

/** What to do with a legacy cache folder. */
export type LegacyCacheAction = 'none' | 'move' | 'keep'

/**
 * Decide what a legacy cache folder needs: `none` when there is nothing to
 * move (no data, or the target is that folder — or inside it, or around it),
 * `keep` when the target already has data of its own, `move` otherwise
 * (including resuming an interrupted move).
 */
export async function legacyCacheAction(legacy: string, target: string): Promise<LegacyCacheAction> {
  if (await dirsOverlap(legacy, target)) return 'none'
  if (!(await hasCacheData(legacy))) return 'none'
  if (await moveInterrupted(target)) return 'move'
  return (await hasCacheData(target)) ? 'keep' : 'move'
}

/** How a move went: everything moved, or the target turned out to have data. */
export type LegacyCacheMoveOutcome = 'moved' | 'kept'

/** Seams for tests; production uses the real file system. */
export type MoveLegacyCacheDeps = {
  /** Rename one entry; `EXDEV` falls back to copy-then-delete. */
  rename?: (from: string, to: string) => Promise<void>
}

/**
 * Move one directory entry: a rename on the same file system (retried through
 * Windows' transient locks), else a recursive copy followed by deleting the
 * source — only once the copy has finished.
 */
async function moveEntry(
  from: string,
  to: string,
  rename: ((from: string, to: string) => Promise<void>) | undefined,
): Promise<void> {
  try {
    await renameWithRetry(from, to, rename === undefined ? {} : { rename })
  } catch (e) {
    if (!hasErrorCode(e, 'EXDEV')) throw e
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await fs.rm(from, { recursive: true, force: true })
  }
}

/**
 * Move every entry of `legacy` (except a cache-write lock file) into `target`,
 * then remove `legacy` if that left it empty. Holds the cache-write lock in
 * `target` throughout and re-checks it first: another workspace's process may
 * have filled the target since the move was planned, and then nothing is
 * moved (`kept`). A marker in `target` covers the move, so an interrupted one
 * is resumed by the next run; an entry already present in `target` then is a
 * partial copy of this move's own and is replaced.
 */
export async function moveLegacyCache(
  legacy: string,
  target: string,
  deps: MoveLegacyCacheDeps = {},
): Promise<LegacyCacheMoveOutcome> {
  return withCacheLock(
    createDefaultFileSystemClient(),
    // i18n-exempt: lock-file `operation`, read back by other ritual processes — English by contract
    'workspace cache move',
    async (): Promise<LegacyCacheMoveOutcome> => {
      const resuming = await moveInterrupted(target)
      if (!resuming && (await hasCacheData(target))) return 'kept'
      const marker = path.join(target, CACHE_MOVE_MARKER)
      await fs.writeFile(marker, '')
      for (const entry of await entriesOf(legacy)) {
        if (entry === CACHE_LOCK_FILENAME) continue
        const destination = path.join(target, entry)
        if (resuming) await fs.rm(destination, { recursive: true, force: true })
        await moveEntry(path.join(legacy, entry), destination, deps.rename)
      }
      await fs.rm(marker, { force: true })
      try {
        await fs.rmdir(legacy)
      } catch (e) {
        // Still holds the lock file of a running older Ritual: leave it be.
        if (!hasErrorCode(e, 'ENOTEMPTY') && !hasErrorCode(e, 'EEXIST')) throw e
      }
      return 'moved'
    },
    { lockDir: target },
  )
}
