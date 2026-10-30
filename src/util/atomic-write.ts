import { randomUUID } from 'node:crypto'
import * as nodeFs from 'node:fs/promises'
import { hasErrorCode, type ErrnoCode } from './errno'
import {
  createDefaultFileSystemClient,
  type FileSystemClient,
  type WriteFileOptions,
} from './interfaces'

/** How {@link writeFileAtomic} writes. */
export type AtomicWriteOptions = WriteFileOptions & {
  /**
   * The file system to write through; the real one by default. Only the real
   * one follows a symlinked target and keeps a replaced file's mode, since
   * {@link FileSystemClient} has no way to ask.
   */
  fs?: FileSystemClient
  /**
   * Runs once the new contents are fully written, just before they replace
   * the target. Throwing abandons the write: the temporary file is removed and
   * the target is left as it was. Lets a caller re-check, as late as possible,
   * that the file is still the one it read. Receives the temporary file's path.
   */
  beforeRename?: (tmpPath: string) => Promise<void>
}

const defaultFileSystem = createDefaultFileSystemClient()

/**
 * The rename errors Windows raises while another process (an antivirus
 * scanner, the search indexer, an editor) briefly holds the target open.
 */
const TRANSIENT_RENAME_ERRORS = ['EPERM', 'EACCES', 'EBUSY'] as const satisfies readonly ErrnoCode[]
const RENAME_ATTEMPTS = 8
const RENAME_RETRY_MS = 100

/** How {@link renameWithRetry} renames, for callers with their own seams. */
export type RenameRetryOptions = {
  /** The rename to retry; the real file system's by default. */
  rename?: (source: string, destination: string) => Promise<void>
  /** The platform whose rules apply; the running one by default. */
  platform?: NodeJS.Platform
}

/**
 * Rename `source` onto `destination`, retrying for a few seconds on Windows
 * while another process (an antivirus scanner on a fresh file, the indexer,
 * an editor) holds either one open.
 */
export async function renameWithRetry(
  source: string,
  destination: string,
  options: RenameRetryOptions = {},
): Promise<void> {
  const { rename = defaultFileSystem.rename, platform = process.platform } = options
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(source, destination)
      return
    } catch (e) {
      const transient =
        platform === 'win32' && TRANSIENT_RENAME_ERRORS.some((code) => hasErrorCode(e, code))
      if (!transient || attempt === RENAME_ATTEMPTS) throw e
      await Bun.sleep(RENAME_RETRY_MS * attempt)
    }
  }
}

/** The file a write to `filePath` lands in: the symlink's target, or `filePath` itself. */
async function resolveTarget(filePath: string): Promise<string> {
  try {
    return await nodeFs.realpath(filePath)
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT')) return filePath
    throw e
  }
}

/** The permission bits of the file at `filePath`, or undefined when there is none. */
async function existingMode(filePath: string): Promise<number | undefined> {
  try {
    return (await nodeFs.stat(filePath)).mode & 0o7777
  } catch (e) {
    if (hasErrorCode(e, 'ENOENT')) return undefined
    throw e
  }
}

/**
 * Write `data` to `filePath` through a temp file and a rename, so the file
 * always holds either its old content or the new, never a torn or truncated
 * write, even when the process dies mid-write.
 *
 * - A symlinked `filePath` is followed, so the link stays a link.
 * - The written file takes `mode` when given, otherwise the replaced file's
 *   mode (a new file gets the process default). The owner is not kept.
 * - The temp name embeds the pid and a random part, and a failed write
 *   removes its temp file.
 * - A target that is itself a mount point (a single-file Docker bind mount)
 *   cannot be renamed over, so it is written in place instead, without the
 *   atomicity.
 *
 * The containing directory must already exist. The rename makes each file
 * atomic on its own, not a group of files: a crash between a list file and
 * its `.sha256` sidecar still leaves the two disagreeing, which
 * `detect-changes` reports as an unrecorded edit rather than losing data.
 */
export async function writeFileAtomic(
  filePath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { fs = defaultFileSystem, mode } = options
  const real = options.fs === undefined
  const target = real ? await resolveTarget(filePath) : filePath
  const fileMode = mode ?? (real ? await existingMode(target) : undefined)
  const tmpPath = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await fs.writeFile(tmpPath, data, fileMode === undefined ? undefined : { mode: fileMode })
    // `writeFile`'s mode is filtered through the umask; the replaced file's
    // bits are restored exactly.
    if (real && fileMode !== undefined) await nodeFs.chmod(tmpPath, fileMode)
    await options.beforeRename?.(tmpPath)
    try {
      await renameWithRetry(tmpPath, target, { rename: (from, to) => fs.rename(from, to) })
    } catch (e) {
      if (process.platform === 'win32' || !hasErrorCode(e, 'EBUSY')) throw e
      await fs.writeFile(target, data)
      await fs.unlink(tmpPath)
    }
  } catch (e) {
    await fs.unlink(tmpPath).catch(() => undefined)
    throw e
  }
}
