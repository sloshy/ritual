/**
 * Moving a workspace's legacy `cache/` folder into the cache directory it now
 * resolves to (the per-user shared cache, unless `RITUAL_CACHE_DIR` or the
 * `cacheDir` key names another). Used by workspace migration 3
 * (`src/migrate/migrations.ts`), which plans with {@link legacyCacheAction} and
 * applies with {@link moveLegacyCache}.
 *
 * The move is all or nothing, and nothing in the target is ever merged into,
 * swept or deleted:
 *
 * - The target must not exist, or be an empty directory. Anything in it —
 *   another workspace's cache, the user's files, even a `.DS_Store` — and the
 *   old folder is kept where it is; the user is told which folder to clear.
 * - On one file system, the whole old folder is renamed to the target in one
 *   step (an empty target directory is first removed with `rmdir`, which
 *   refuses a non-empty one).
 * - Across file systems (and for a symlinked `cache/`), the tree is copied to
 *   a uniquely named temporary folder beside the target, which is renamed to
 *   the target in one step; only then is the old folder removed. A failure
 *   removes only that temporary folder, so the old one is untouched.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameWithRetry } from '../util/atomic-write'
import { ExitCode, getErrorMessage, hasErrorCode, localizedCommandError } from '../util/errors'
import { createDefaultFileSystemClient } from '../util/interfaces'
import { isSameFile } from '../util/same-file'
import { pathsOverlap } from '../util/path-validation'
import { COMMAND, commandLine } from '../util/cli-tokens'
import { entriesOf, hasCacheData } from './cache-entries'
import { CACHE_LOCK_FILENAME, isCacheLockHeld, withCacheLock } from './lock'

/** The prefix of the temporary folder a cross-device move copies into, beside the target. */
export const INCOMING_PREFIX = '.ritual-cache-incoming-'

/** The lock two moves into the same target take, in the target's parent. */
const MOVE_LOCK_NAME = '.ritual-cache-move-lock'

/** How old an abandoned temporary folder must be before a later move removes it. */
const STALE_INCOMING_MS = 60 * 60 * 1000

/**
 * `dir` with symlinks resolved as far as it exists: the real path of its
 * deepest existing ancestor, with the rest appended. Only a missing path is
 * tolerated; any other failure to resolve is an error.
 */
export async function canonicalPath(dir: string): Promise<string> {
  const resolved = path.resolve(dir)
  try {
    return await fs.realpath(resolved)
  } catch (e) {
    if (!hasErrorCode(e, 'ENOENT') && !hasErrorCode(e, 'ENOTDIR')) throw e
    const parent = path.dirname(resolved)
    if (parent === resolved) return resolved
    return path.join(await canonicalPath(parent), path.basename(resolved))
  }
}

/**
 * Whether the two directories overlap on disk: by real path (case-folded on a
 * platform whose file system ignores case, so `Cache/sub` is inside `cache`),
 * or as one directory reached two ways (same inode). Erring towards
 * "overlap" only ever means "do not move".
 */
async function dirsOverlap(a: string, b: string, platform: NodeJS.Platform): Promise<boolean> {
  if (pathsOverlap(await canonicalPath(a), await canonicalPath(b), platform)) return true
  return isSameFile(a, b)
}

/** Whether a cache may move into `target`: it does not exist, or is an empty directory. */
export async function targetAcceptsMove(target: string): Promise<boolean> {
  return (await entriesOf(target)).length === 0
}

/** What to do with a legacy cache folder. */
export type LegacyCacheAction =
  /** Nothing: no cache data, or the target is (around, inside) the folder itself. */
  | 'none'
  /** Move it. */
  | 'move'
  /** Leave it: the target is not empty. */
  | 'keep'

/** Seams for tests; production uses the running platform. */
export type LegacyCacheActionOptions = { platform?: NodeJS.Platform }

/** Decide what a legacy cache folder needs, as {@link LegacyCacheAction} describes. */
export async function legacyCacheAction(
  legacy: string,
  target: string,
  options: LegacyCacheActionOptions = {},
): Promise<LegacyCacheAction> {
  if (await dirsOverlap(legacy, target, options.platform ?? process.platform)) return 'none'
  if (!(await hasCacheData(legacy))) return 'none'
  return (await targetAcceptsMove(target)) ? 'move' : 'keep'
}

/** How a move went. */
export type LegacyCacheMoveResult =
  | { outcome: 'moved' }
  /** The target was not empty by the time the move ran; nothing changed. */
  | { outcome: 'kept' }
  /**
   * `cache/` was a symlink: what it pointed at was copied into the target and
   * the link removed; the folder it pointed at (`linked`) was left as it was.
   */
  | { outcome: 'copied-link'; linked: string }
  /** Copied whole into the target, but the old folder could not be removed (`reason`). */
  | { outcome: 'partial'; reason: string }

/** Seams for tests; production uses the real file system. */
export type MoveLegacyCacheDeps = {
  /** Renames the old folder to the target (the same-file-system move). */
  rename?: (from: string, to: string) => Promise<void>
  /** Runs once the cross-device copy is complete, before it is renamed into place. */
  afterCopy?: (copy: string) => Promise<void>
}

/** Remove abandoned temporary folders an earlier, interrupted move left beside the target. */
async function removeStaleIncoming(parent: string): Promise<void> {
  for (const entry of await entriesOf(parent)) {
    if (!entry.startsWith(INCOMING_PREFIX)) continue
    const dir = path.join(parent, entry)
    const stats = await fs.lstat(dir).catch(() => null)
    if (stats?.isDirectory() === true && Date.now() - stats.mtimeMs > STALE_INCOMING_MS) {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

/** Whether a failed `rmdir` or rename means "the target is (no longer) empty". */
function targetTaken(e: unknown): boolean {
  return hasErrorCode(e, 'ENOTEMPTY') || hasErrorCode(e, 'EEXIST') || hasErrorCode(e, 'ENOTDIR')
}

/** The localized failure for a move step that could not complete; nothing was lost. */
function moveFailed(source: string, e: unknown): Error {
  return localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.cacheMoveFailed', {
    path: source,
    reason: getErrorMessage(e),
    command: commandLine(COMMAND.migrate),
  })
}

/**
 * Rename `from` onto `target` only if the target is absent or an empty
 * directory, deleting nothing in it. The empty directory is removed with
 * `rmdir`, which itself refuses a non-empty one — the emptiness check and the
 * removal are one step — and the rename then refuses a target that appeared
 * meanwhile with content. Returns false when the target held something.
 */
async function renameOntoEmpty(
  from: string,
  target: string,
  rename: ((from: string, to: string) => Promise<void>) | undefined,
): Promise<boolean> {
  try {
    await fs.rmdir(target)
  } catch (e) {
    if (targetTaken(e)) return false
    // Windows reports a non-empty directory as EPERM; anything else is a real failure.
    if (hasErrorCode(e, 'EPERM') && (await entriesOf(target)).length > 0) return false
    if (!hasErrorCode(e, 'ENOENT')) throw e
  }
  try {
    await renameWithRetry(from, target, rename === undefined ? {} : { rename })
    return true
  } catch (e) {
    if (targetTaken(e)) return false
    throw e
  }
}

/**
 * Copy the directory `source` (its real directory, when `source` is a
 * symlink; links inside it are copied as links) to a fresh temporary folder
 * beside `target`, leaving out its lock file, then rename that onto the
 * target if the target is still absent or empty. Returns false when it was
 * not. On any failure, or when the target was taken, only the temporary
 * folder is removed.
 */
async function copyIntoPlace(
  source: string,
  target: string,
  deps: MoveLegacyCacheDeps,
): Promise<boolean> {
  const real = await fs.realpath(source)
  const incoming = path.join(
    path.dirname(target),
    `${INCOMING_PREFIX}${process.pid}-${randomUUID().slice(0, 8)}`,
  )
  const lockFile = path.join(real, CACHE_LOCK_FILENAME)
  try {
    await fs.cp(real, incoming, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (entry) => entry !== lockFile,
    })
    await deps.afterCopy?.(incoming)
    if (await renameOntoEmpty(incoming, target, undefined)) return true
    await fs.rm(incoming, { recursive: true, force: true })
    return false
  } catch (e) {
    await fs.rm(incoming, { recursive: true, force: true })
    throw moveFailed(source, e)
  }
}

/** The refusal when a running Ritual still holds the old cache's lock; nothing moved. */
function legacyBusy(legacy: string): Error {
  return localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.cacheBusy', {
    path: legacy,
    lockFile: path.join(legacy, CACHE_LOCK_FILENAME),
    command: commandLine(COMMAND.migrate),
  })
}

/** Run `body` holding `dir`'s own cache-write lock, so refreshes there wait. */
function underCacheLock<T>(dir: string, body: () => Promise<T>): Promise<T> {
  return withCacheLock(
    createDefaultFileSystemClient(),
    // i18n-exempt: lock-file `operation`, read back by other ritual processes — English by contract
    'workspace cache move',
    body,
    { lockDir: dir },
  )
}

/**
 * Move `legacy` to `target`, all or nothing (see the module comment). Holds a
 * move lock in the target's parent, so two workspaces never move into one
 * target at once, and decides again under it: the target may have gained
 * content since the move was planned, and then nothing moves (`kept`). A
 * running Ritual holding the old cache's own lock stops the move with an
 * error (so `ritual migrate` can try again once it is closed).
 *
 * While copying across file systems, the old cache's lock is held, so a
 * refresh in this workspace waits; a single-card save that lands in the old
 * folder during the copy can still be dropped with it (it is fetched again).
 */
export async function moveLegacyCache(
  legacy: string,
  target: string,
  deps: MoveLegacyCacheDeps = {},
): Promise<LegacyCacheMoveResult> {
  const parent = path.dirname(target)
  await fs.mkdir(parent, { recursive: true })
  return withCacheLock(
    createDefaultFileSystemClient(),
    // i18n-exempt: lock-file `operation`, read back by other ritual processes — English by contract
    'workspace cache move',
    async (): Promise<LegacyCacheMoveResult> => {
      await removeStaleIncoming(parent)
      if (!(await targetAcceptsMove(target))) return { outcome: 'kept' }
      if (await isCacheLockHeld(legacy)) throw legacyBusy(legacy)

      const stats = await fs.lstat(legacy)
      if (stats.isSymbolicLink()) {
        const linked = await fs.realpath(legacy)
        const placed = await underCacheLock(linked, () => copyIntoPlace(legacy, target, deps))
        if (!placed) return { outcome: 'kept' }
        await fs.unlink(legacy)
        return { outcome: 'copied-link', linked }
      }

      try {
        if (!(await renameOntoEmpty(legacy, target, deps.rename))) return { outcome: 'kept' }
        return { outcome: 'moved' }
      } catch (e) {
        if (!hasErrorCode(e, 'EXDEV')) throw moveFailed(legacy, e)
      }
      const placed = await underCacheLock(legacy, () => copyIntoPlace(legacy, target, deps))
      if (!placed) return { outcome: 'kept' }
      // The copy is in place, whole; only now does the old folder go.
      try {
        await fs.rm(legacy, { recursive: true, force: true })
      } catch (e) {
        return { outcome: 'partial', reason: getErrorMessage(e) }
      }
      return { outcome: 'moved' }
    },
    { lockDir: parent, lockName: MOVE_LOCK_NAME },
  )
}
