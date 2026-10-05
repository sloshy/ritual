import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir, workspaceRelative } from '../config/base-dir'
import { renameWithRetry } from './atomic-write'
import { hasErrorCode } from './errno'
import { isPathWithinDir } from './path-validation'

/**
 * The two workspace folders that keep a copy of what Ritual is about to
 * destroy: `delete` moves a list and its sidecars into {@link TRASH_DIR}, and
 * a migration copies every file it will rewrite into {@link BACKUPS_DIR}
 * first. Each operation gets its own `<stamp>-<label>` folder, inside which a
 * file keeps its path relative to the workspace (one outside the workspace
 * keeps just its name), so restoring one is moving it back. The managed
 * `.gitignore` excludes both folders, and Ritual never empties them.
 */
export const TRASH_DIR = '.trash'
export const BACKUPS_DIR = '.backups'

/** A sortable UTC stamp that is safe in a file name on every platform: `2026-10-05T14-03-22Z`. */
export function safekeepingStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-')
}

/** Where `file` goes inside `folder`: its workspace-relative path, or its base name when it lies outside the workspace. */
function keptPath(folder: string, file: string): string {
  const inside = isPathWithinDir(file, getBaseDir())
  return path.join(folder, inside ? workspaceRelative(file) : path.basename(file))
}

/** Create a fresh `<root>/<stamp>-<label>` folder in the workspace, suffixing `-2`, `-3`… past one that exists. */
async function createFolder(root: string, label: string, now: Date): Promise<string> {
  const base = path.join(getBaseDir(), root, `${safekeepingStamp(now)}-${label}`)
  await fs.mkdir(path.dirname(base), { recursive: true })
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    try {
      await fs.mkdir(candidate)
      return candidate
    } catch (e) {
      if (!hasErrorCode(e, 'EEXIST')) throw e
    }
  }
}

/** Move `from` to `to`, copying when the two are on different devices (a Docker bind mount). */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await renameWithRetry(from, to)
  } catch (e) {
    if (!hasErrorCode(e, 'EXDEV')) throw e
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL)
    await fs.unlink(from)
  }
}

/** One file {@link moveToTrash} has moved, so a failure can put it back. */
type TrashedFile = { from: string; to: string }

/**
 * Move `files` (which must exist) into a new trash folder labelled `label`,
 * in order, returning the folder. A failure part-way moves the files already
 * trashed back before rethrowing, so a caller that lists its most important
 * file last never loses it while its companions stay behind.
 */
export async function moveToTrash(
  files: readonly string[],
  label: string,
  now: Date = new Date(),
): Promise<string> {
  if (files.length === 0) throw new Error('moveToTrash needs at least one file')
  const folder = await createFolder(TRASH_DIR, label, now)
  const moved: TrashedFile[] = []
  try {
    for (const from of files) {
      const to = keptPath(folder, from)
      await fs.mkdir(path.dirname(to), { recursive: true })
      await moveFile(from, to)
      moved.push({ from, to })
    }
  } catch (e) {
    for (const { from, to } of moved.reverse()) await moveFile(to, from).catch(() => undefined)
    throw e
  }
  return folder
}

/**
 * Copy those of `paths` that exist (files or whole directories) into a new
 * backup folder labelled `label`, returning the folder, or null when none of
 * them existed, in which case that folder is removed again.
 */
export async function backUpFiles(
  paths: readonly string[],
  label: string,
  now: Date = new Date(),
): Promise<string | null> {
  const folder = await createFolder(BACKUPS_DIR, label, now)
  let copied = 0
  for (const source of new Set(paths)) {
    try {
      await fs.cp(source, keptPath(folder, source), {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
      copied++
    } catch (e) {
      // ENOTDIR: a parent on the path is a file, so the path cannot exist either.
      if (!hasErrorCode(e, 'ENOENT') && !hasErrorCode(e, 'ENOTDIR')) throw e
    }
  }
  if (copied > 0) return folder
  await fs.rm(folder, { recursive: true, force: true })
  return null
}
