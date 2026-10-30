/**
 * Per-user directories outside any workspace: the state directory, small files
 * Ritual keeps for itself between runs (see `src/util/user-state.ts`), which
 * are neither configuration nor cache — losing them costs at most a repeated
 * prompt or check — and the default home of the card cache, which every
 * workspace shares unless it names its own (see `src/config/cache-location.ts`).
 */

import os from 'node:os'
import path from 'node:path'

/** The application directory name under each platform's base directory. */
const APP_DIR = 'ritual'

/** What the resolvers here read; defaults to the running process. */
export type UserDirsEnvironment = {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  home: string
}

export const PROCESS_ENVIRONMENT: UserDirsEnvironment = {
  get env(): Record<string, string | undefined> {
    return process.env
  },
  platform: process.platform,
  get home(): string {
    return os.homedir()
  },
}

/**
 * An XDG base-directory variable's value: unset when blank or relative, since
 * the XDG Base Directory specification says a relative path is invalid and
 * must be ignored.
 */
function xdgDir(value: string | undefined): string | undefined {
  const set = nonBlank(value)
  return set !== undefined && path.posix.isAbsolute(set) ? set : undefined
}

/** An environment variable's value, with blank read as unset. */
export function nonBlank(value: string | undefined): string | undefined {
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
  const stateHome = xdgDir(env.XDG_STATE_HOME) ?? path.posix.join(home, '.local', 'state')
  return path.posix.join(stateHome, APP_DIR)
}

/**
 * The platform's per-user cache directory for Ritual — where the card cache
 * lives when neither `RITUAL_CACHE_DIR` nor the `cacheDir` config key names
 * another (the precedence lives in `src/config/cache-location.ts`):
 *
 * - Linux and other Unixes: `$XDG_CACHE_HOME/ritual`, or `~/.cache/ritual` (an unset,
 *   blank or relative `XDG_CACHE_HOME` reads as unset, per the XDG specification);
 * - macOS: `~/Library/Caches/ritual`;
 * - Windows: `%LOCALAPPDATA%\ritual\cache`, or `~\AppData\Local\ritual\cache`
 *   (a `cache` folder inside the state directory, which uses no such name).
 *
 * Joined with the target platform's separator, like {@link resolveUserStateDir}.
 */
export function defaultUserCacheDir(
  environment: UserDirsEnvironment = PROCESS_ENVIRONMENT,
): string {
  const { env, platform, home } = environment
  if (platform === 'win32') {
    const localAppData = nonBlank(env.LOCALAPPDATA) ?? path.win32.join(home, 'AppData', 'Local')
    return path.win32.join(localAppData, APP_DIR, 'cache')
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Caches', APP_DIR)
  }
  const cacheHome = xdgDir(env.XDG_CACHE_HOME) ?? path.posix.join(home, '.cache')
  return path.posix.join(cacheHome, APP_DIR)
}
