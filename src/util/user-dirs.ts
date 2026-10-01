/**
 * Per-user directories outside any workspace. Only the state directory exists
 * so far: small files Ritual keeps for itself between runs (see
 * `src/util/user-state.ts`), which are neither configuration nor cache — losing
 * them costs at most a repeated prompt or check.
 */

import os from 'node:os'
import path from 'node:path'

/** The application directory name under each platform's base directory. */
const APP_DIR = 'ritual'

/** What {@link resolveUserStateDir} reads; defaults to the running process. */
export type UserDirsEnvironment = {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  home: string
}

const PROCESS_ENVIRONMENT: UserDirsEnvironment = {
  get env(): Record<string, string | undefined> {
    return process.env
  },
  platform: process.platform,
  get home(): string {
    return os.homedir()
  },
}

/** An environment variable's value, with blank read as unset. */
function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value
}

/**
 * The per-user state directory: `RITUAL_STATE_DIR` when set (resolved against
 * the working directory — the override names the directory itself, which is how tests keep the real home
 * directory untouched), otherwise
 *
 * - Linux and other Unixes: `$XDG_STATE_HOME/ritual`, or `~/.local/state/ritual`;
 * - macOS: `~/Library/Application Support/ritual`;
 * - Windows: `%LOCALAPPDATA%\ritual`, or `~\AppData\Local\ritual`.
 *
 * Paths are joined with the target platform's separator, so every platform's
 * answer can be checked from any host.
 */
export function resolveUserStateDir(
  environment: UserDirsEnvironment = PROCESS_ENVIRONMENT,
): string {
  const { env, platform, home } = environment
  const override = nonBlank(env.RITUAL_STATE_DIR)
  if (override !== undefined) return path.resolve(override.trim())
  if (platform === 'win32') {
    const localAppData = nonBlank(env.LOCALAPPDATA) ?? path.win32.join(home, 'AppData', 'Local')
    return path.win32.join(localAppData, APP_DIR)
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', APP_DIR)
  }
  const stateHome = nonBlank(env.XDG_STATE_HOME) ?? path.posix.join(home, '.local', 'state')
  return path.posix.join(stateHome, APP_DIR)
}
