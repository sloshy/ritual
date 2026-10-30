/**
 * Moving a workspace's legacy `cache/` folder into the cache directory it now
 * resolves to (the per-user shared cache, unless `RITUAL_CACHE_DIR` or the
 * `cacheDir` key names another). Used by workspace migration 3
 * (`src/migrate/migrations.ts`), which plans with {@link legacyCacheAction} and
 * applies with {@link moveLegacyCache} / {@link finishLegacyCacheMove}.
 *
 * The rules:
 *
 * - A cache only ever moves into a target that holds no cache data.
 * - Nothing is deleted that the target did not receive whole: an entry
 *   copied across file systems is copied under a temporary name and renamed
 *   into place before its source is removed, and a destination entry is never
 *   deleted.
 * - A move covers itself with a marker in the target naming the folder it
 *   moves from. An interrupted move is resumed only by that same workspace;
 *   to any other workspace a marked target counts as holding data.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { renameWithRetry } from '../util/atomic-write'
import { ExitCode, getErrorMessage, hasErrorCode, localizedCommandError } from '../util/errors'
import { createDefaultFileSystemClient } from '../util/interfaces'
import { isSameFile } from '../util/same-file'
import { COMMAND, commandLine } from '../util/cli-tokens'
import { entriesOf, hasCacheData } from './cache-entries'
import { CACHE_LOCK_FILENAME, withCacheLock } from './lock'

/** Written into the target while a move runs; it names the folder being moved. */
export const CACHE_MOVE_MARKER = '.ritual-cache-move'

/** The marker's contents: the real path of the folder the move empties. */
export type CacheMoveMarker = { source: string }

/** Legacy entries a move leaves where they are: they are not cache data. */
const NOT_MOVED: ReadonlySet<string> = new Set([CACHE_LOCK_FILENAME, CACHE_MOVE_MARKER])

/** Files operating systems drop into folders on their own. */
const OS_LITTER: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

/** The infix of an entry being copied across file systems, before it is renamed into place. */
const PARTIAL_INFIX = '.partial-'

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

/** File systems whose default volumes compare names without case. */
function caseInsensitive(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Whether the two directories overlap on disk: by real path, by real path
 * ignoring case on a platform whose file system usually does (`Cache/sub`
 * inside `cache`), or as one directory reached two ways (same inode).
 * Erring towards "overlap" only ever means "do not move".
 */
async function dirsOverlap(a: string, b: string, platform: NodeJS.Platform): Promise<boolean> {
  const [realA, realB] = [await canonicalPath(a), await canonicalPath(b)]
  if (pathsOverlap(realA, realB)) return true
  if (caseInsensitive(platform) && pathsOverlap(realA.toLowerCase(), realB.toLowerCase())) {
    return true
  }
  return isSameFile(a, b)
}

/** Who started the move a target's marker records. */
type MarkerOwner = 'none' | 'ours' | 'foreign'

/** Read the target's move marker and say whether this legacy folder wrote it. */
async function markerOwner(target: string, legacyReal: string): Promise<MarkerOwner> {
  let raw: string
  try {
    raw = await fs.readFile(path.join(target, CACHE_MOVE_MARKER), 'utf-8')
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT') || hasErrorCode(e, 'ENOTDIR')) return 'none'
    throw e
  }
  try {
    const marker = JSON.parse(raw) as Partial<CacheMoveMarker>
    return marker.source === legacyReal ? 'ours' : 'foreign'
  } catch {
    // Unreadable: nobody can prove it is theirs, so it is no one's to resume.
    return 'foreign'
  }
}

/** What to do with a legacy cache folder. */
export type LegacyCacheAction =
  /** Nothing: no data, or the target is (around, inside) the folder itself. */
  | 'none'
  /** Move it, or resume this workspace's interrupted move. */
  | 'move'
  /** Leave it: the target already holds another cache. */
  | 'keep'
  /** This workspace's move moved everything but did not remove its marker and folder. */
  | 'finish'

/** Seams for tests; production uses the running platform. */
export type LegacyCacheActionOptions = { platform?: NodeJS.Platform }

/** Decide what a legacy cache folder needs, as {@link LegacyCacheAction} describes. */
export async function legacyCacheAction(
  legacy: string,
  target: string,
  options: LegacyCacheActionOptions = {},
): Promise<LegacyCacheAction> {
  if (await dirsOverlap(legacy, target, options.platform ?? process.platform)) return 'none'
  const owner = await markerOwner(target, await canonicalPath(legacy))
  const legacyHasData = await hasCacheData(legacy)
  if (owner === 'ours') return legacyHasData ? 'move' : 'finish'
  if (!legacyHasData) return 'none'
  if (owner === 'foreign') return 'keep'
  return (await hasCacheData(target)) ? 'keep' : 'move'
}

/** How a move or finish went. */
export type LegacyCacheMoveResult =
  | { outcome: 'moved' }
  /** The target turned out to hold another cache; nothing moved. */
  | { outcome: 'kept' }
  /** Everything moved, but these entries were left in (or appeared in) the old folder. */
  | { outcome: 'partial'; left: string[] }

/** Seams for tests; production uses the real file system. */
export type MoveLegacyCacheDeps = {
  /** Rename one entry; `EXDEV` falls back to copy-then-rename-then-delete. */
  rename?: (from: string, to: string) => Promise<void>
  /** Runs after a cross-device copy is in place and before its source is removed. */
  afterCopy?: (destination: string) => Promise<void>
}

/** Whether a path exists, without following a final symlink. */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file)
    return true
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT')) return false
    throw e
  }
}

/**
 * Move one entry: a rename on the same file system (retried through Windows'
 * transient locks); across file systems, a copy under a temporary name, a
 * rename into place, then removal of the source.
 */
async function moveEntry(from: string, to: string, deps: MoveLegacyCacheDeps): Promise<void> {
  try {
    try {
      await renameWithRetry(from, to, deps.rename === undefined ? {} : { rename: deps.rename })
      return
    } catch (e) {
      if (!hasErrorCode(e, 'EXDEV')) throw e
    }
    const partial = `${to}${PARTIAL_INFIX}${process.pid}`
    await fs.rm(partial, { recursive: true, force: true })
    await fs.cp(from, partial, { recursive: true, errorOnExist: true, force: false })
    await renameWithRetry(partial, to)
    await deps.afterCopy?.(to)
    await fs.rm(from, { recursive: true, force: true })
  } catch (e) {
    throw localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.cacheMoveFailed', {
      path: from,
      reason: getErrorMessage(e),
      command: commandLine(COMMAND.migrate),
    })
  }
}

/**
 * Remove the emptied legacy folder — unlinking it when it is a symlink —
 * after removing the marker. Entries still in it (an older Ritual's lock
 * file, or files it wrote meanwhile) make the result `partial`.
 */
async function removeLegacy(legacy: string, target: string): Promise<LegacyCacheMoveResult> {
  await fs.rm(path.join(target, CACHE_MOVE_MARKER), { force: true })
  const left = (await entriesOf(legacy)).filter((entry) => entry !== CACHE_MOVE_MARKER)
  if (left.length > 0) return { outcome: 'partial', left: left.sort() }
  const stats = await fs.lstat(legacy).catch(() => null)
  if (stats === null) return { outcome: 'moved' }
  if (stats.isSymbolicLink()) {
    await fs.unlink(legacy)
    return { outcome: 'moved' }
  }
  try {
    await fs.rmdir(legacy)
  } catch (e) {
    // Something arrived between the listing and the removal.
    if (!hasErrorCode(e, 'ENOTEMPTY') && !hasErrorCode(e, 'EEXIST')) throw e
    return { outcome: 'partial', left: (await entriesOf(legacy)).sort() }
  }
  return { outcome: 'moved' }
}

/** Run `body` holding the cache-write lock in `target`. */
function underTargetLock<T>(target: string, body: () => Promise<T>): Promise<T> {
  return withCacheLock(
    createDefaultFileSystemClient(),
    // i18n-exempt: lock-file `operation`, read back by other ritual processes — English by contract
    'workspace cache move',
    body,
    { lockDir: target },
  )
}

/**
 * Move every entry of `legacy` (but a lock file) into `target`, then remove
 * `legacy`. Holds the cache-write lock in `target` and decides again under it:
 * another workspace may have filled (or started moving into) the target since
 * the move was planned, and then nothing moves (`kept`).
 *
 * Resuming this workspace's own interrupted move, an entry already present in
 * `target` arrived whole (only a complete copy is ever renamed into place),
 * so only its source is removed; leftover partial copies are discarded.
 */
export function moveLegacyCache(
  legacy: string,
  target: string,
  deps: MoveLegacyCacheDeps = {},
): Promise<LegacyCacheMoveResult> {
  return underTargetLock(target, async (): Promise<LegacyCacheMoveResult> => {
    const legacyReal = await canonicalPath(legacy)
    const owner = await markerOwner(target, legacyReal)
    if (owner === 'foreign') return { outcome: 'kept' }
    if (owner === 'none' && (await hasCacheData(target))) return { outcome: 'kept' }

    const marker: CacheMoveMarker = { source: legacyReal }
    await fs.writeFile(path.join(target, CACHE_MOVE_MARKER), JSON.stringify(marker))
    for (const entry of await entriesOf(target)) {
      if (entry.includes(PARTIAL_INFIX)) {
        await fs.rm(path.join(target, entry), { recursive: true, force: true })
      }
    }
    for (const entry of await entriesOf(legacy)) {
      if (NOT_MOVED.has(entry)) continue
      const source = path.join(legacy, entry)
      const destination = path.join(target, entry)
      if (await exists(destination)) {
        // Resuming, the destination was moved whole by the earlier attempt, so
        // only the source is left to remove. Otherwise the name is taken by the
        // target's own file: drop the source only when it is OS litter, and
        // leave anything else in place (it is reported as left behind).
        if (owner === 'ours' || OS_LITTER.has(entry)) {
          await fs.rm(source, { recursive: true, force: true })
        }
        continue
      }
      await moveEntry(source, destination, deps)
    }
    return removeLegacy(legacy, target)
  })
}

/**
 * Finish this workspace's move that moved every entry but stopped before
 * removing its marker and the old folder. A marker that is no longer this
 * workspace's is left alone (`kept`).
 */
export function finishLegacyCacheMove(
  legacy: string,
  target: string,
): Promise<LegacyCacheMoveResult> {
  return underTargetLock(target, async (): Promise<LegacyCacheMoveResult> => {
    if ((await markerOwner(target, await canonicalPath(legacy))) !== 'ours') {
      return { outcome: 'kept' }
    }
    return removeLegacy(legacy, target)
  })
}
