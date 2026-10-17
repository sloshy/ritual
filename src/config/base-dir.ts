import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveStringOverride } from './env-override'
import { getErrorMessage, hasErrorCode } from '../util/errors'
import { syncMessage, type MessageParseError } from '../sync/message'

let baseDir: string = process.cwd()

export function getBaseDir(): string {
  return baseDir
}

export function setBaseDir(dir: string): void {
  baseDir = path.resolve(dir)
}

/** `file`'s path relative to the workspace, as a message shows it to the user. */
export function workspaceRelative(file: string): string {
  return path.relative(baseDir, file)
}

/**
 * Resolve the requested base dir from the `--base-dir` flag and the
 * `RITUAL_BASE_DIR` environment variable (same precedence pattern as
 * `RITUAL_CACHE_SERVER` and `RITUAL_NO_INPUT`): an explicit flag wins, an
 * empty/whitespace value counts as unset, and `undefined` means "stay in the
 * current working directory".
 */
export function resolveBaseDir(
  cliValue: string | undefined,
  envValue: string | undefined = process.env.RITUAL_BASE_DIR,
): string | undefined {
  return resolveStringOverride(cliValue, envValue)
}

/**
 * Resolve a requested base dir to an absolute path, rejecting anything that is
 * not an existing directory. A typo'd base dir must not read as an empty
 * workspace (nor quietly fork a new one), so this is the CLI's usage-error gate
 * — it never creates the directory.
 */
export async function parseBaseDir(value: string): Promise<string | MessageParseError> {
  const resolved = path.resolve(value)
  try {
    const stats = await fs.stat(resolved)
    if (!stats.isDirectory()) {
      return { error: syncMessage('cli.baseDir.notDirectory', { path: resolved }) }
    }
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { error: syncMessage('cli.baseDir.missing', { path: resolved }) }
    }
    // A file somewhere in the path prefix (e.g. `--base-dir <file>/sub`).
    if (hasErrorCode(error, 'ENOTDIR')) {
      return { error: syncMessage('cli.baseDir.notDirectory', { path: resolved }) }
    }
    return {
      error: syncMessage('cli.baseDir.unreadable', {
        path: resolved,
        reason: getErrorMessage(error),
      }),
    }
  }
  return resolved
}
