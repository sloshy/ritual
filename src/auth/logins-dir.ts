import fs from 'node:fs/promises'
import path from 'node:path'
import { getBaseDir } from '../config/base-dir'
import { writeFileAtomic } from '../util/atomic-write'
import { hasErrorCode } from '../util/errno'

/** The workspace folder holding sign-ins and the admin audit log, relative to the base dir. */
export const LOGINS_DIR = '.logins'

/** The `.gitignore` Ritual keeps inside {@link LOGINS_DIR}, relative to the base dir. */
export const LOGINS_GITIGNORE = `${LOGINS_DIR}/.gitignore`

/**
 * The contents of {@link LOGINS_GITIGNORE}: ignore everything in the folder,
 * this file included, so git never sees the folder at all. It lives inside
 * `.logins/` rather than in the workspace's own `.gitignore` so a workspace that
 * never ran `init-site` is covered too, without Ritual editing a file the user
 * owns. Workspace content, like the managed `.gitignore` block: English by
 * contract.
 */
// i18n-exempt: workspace file content, written into the user's repository
export const LOGINS_GITIGNORE_CONTENT = '# Written by Ritual: sign-ins never belong in git.\n*\n'

export function getLoginsDir(): string {
  return path.join(getBaseDir(), LOGINS_DIR)
}

/**
 * Create the private `.logins/` folder (`0700`) if needed, and the `.gitignore`
 * inside it if that is missing. Every write into the folder goes through here,
 * so nothing is stored in it before it is ignored. An existing `.gitignore` is
 * left as it is: a user who edited it meant to. `baseDir` is the workspace
 * (the bound one by default).
 */
export async function ensureLoginsDir(baseDir: string = getBaseDir()): Promise<void> {
  const loginsDir = path.join(baseDir, LOGINS_DIR)
  try {
    await fs.access(loginsDir)
  } catch {
    await fs.mkdir(loginsDir, { recursive: true, mode: 0o700 })
  }
  await createLoginsGitignore(baseDir)
}

/**
 * Create {@link LOGINS_GITIGNORE} when it is missing, whole or not at all: it
 * is written under a temporary name and renamed into place (`writeFileAtomic`).
 * Writing it in place could leave an empty file behind a crash or a full disk,
 * which every later run (and migration 4) would take for the user's own and
 * keep. An existing file is left alone.
 */
async function createLoginsGitignore(baseDir: string): Promise<void> {
  const target = path.join(baseDir, LOGINS_GITIGNORE)
  try {
    await fs.access(target)
    return
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) throw error
  }
  await writeFileAtomic(target, LOGINS_GITIGNORE_CONTENT)
}

/**
 * Write `value` as JSON to `filePath` under `.logins/`, creating the private
 * directory if needed. The file is readable by its owner only (`0600`) from
 * the moment it exists, even when it replaces a wider one.
 */
export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await ensureLoginsDir()
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
