/**
 * Where the card cache lives. One rule, read by every cache file
 * (`getCacheDir()` in `./file-cache.ts`), by `cache status`, and by the
 * migration that moves a workspace's old `cache/` into it:
 *
 * 1. `RITUAL_CACHE_DIR`, when set and not blank;
 * 2. the workspace's `cacheDir` config key, when set and not blank;
 * 3. the per-user default (`defaultUserCacheDir`), shared by every workspace.
 *
 * A relative value — from either source — resolves against the workspace (the
 * base dir), so `cacheDir: "cache"` or `RITUAL_CACHE_DIR=cache` keeps a
 * workspace's cache in its own `cache/` folder.
 *
 * Pure: the environment, the workspace and the configured value are inputs, so
 * every platform's default can be checked from any host (a relative override
 * resolves with the host's own path rules).
 */

import path from 'node:path'
import { ENV_VAR } from '../util/cli-tokens'
import { isSameOrWithin } from '../util/path-validation'
import {
  defaultUserCacheDir,
  nonBlank,
  PROCESS_ENVIRONMENT,
  type UserDirsEnvironment,
} from '../util/user-dirs'

/**
 * Every tier of the precedence, highest first. `legacy` is a workspace still
 * using its own old `cache/` folder until `ritual migrate` (migration
 * {@link SHARED_CACHE_MIGRATION_ID}) has dealt with it — so Ritual never
 * downloads into an empty shared cache while a workspace's own cache sits
 * unmigrated beside it.
 */
export const CACHE_DIR_SOURCES = ['env', 'config', 'legacy', 'default'] as const

/** The workspace migration that moves a workspace's old `cache/` into the shared cache. */
export const SHARED_CACHE_MIGRATION_ID = 3

/** The workspace-relative folder every workspace kept its cache in before the shared cache. */
export const LEGACY_CACHE_DIR = 'cache'

/** Which tier of the precedence chose the cache directory. */
export type CacheDirSource = (typeof CACHE_DIR_SOURCES)[number]

/** The resolved cache directory and the tier that chose it. */
export type CacheDirLocation = {
  /** Absolute path of the cache directory. */
  dir: string
  source: CacheDirSource
}

/** What {@link resolveCacheDir} reads. */
export type CacheDirInputs = {
  /** The workspace root; relative overrides resolve against it. */
  baseDir: string
  /** The workspace's `cacheDir` config value, when it has one. */
  configured?: string
  /**
   * Whether the workspace's old `cache/` folder is still the one to use: it
   * holds cache data and migration {@link SHARED_CACHE_MIGRATION_ID} has not
   * run. The caller decides (it needs the file system and the config); a
   * function is asked only when no override applies.
   */
  legacyPending?: boolean | (() => boolean)
  /** The process environment, platform and home directory; the running process by default. */
  environment?: UserDirsEnvironment
  /**
   * When given, an override naming a folder the cache must never take over
   * (see {@link cacheDirProblem}) is skipped — the next tier applies — and
   * reported through `onRejected`.
   */
  check?: CacheDirCheckContext
  onRejected?: (rejected: RejectedCacheDir) => void
}

/** An override {@link resolveCacheDir} skipped, and why. */
export type RejectedCacheDir = {
  source: 'env' | 'config'
  value: string
  problem: CacheDirProblem
}

/** Resolve the card cache directory by the precedence in the module comment. */
export function resolveCacheDir(inputs: CacheDirInputs): CacheDirLocation {
  const environment = inputs.environment ?? PROCESS_ENVIRONMENT
  const usable = (source: 'env' | 'config', value: string | undefined): string | undefined => {
    if (value === undefined || inputs.check === undefined) return value
    const problem = cacheDirProblem(value, inputs.check)
    if (problem === null) return value
    inputs.onRejected?.({ source, value: value.trim(), problem })
    return undefined
  }
  const fromEnv = usable('env', nonBlank(environment.env[ENV_VAR.cacheDir]))
  if (fromEnv !== undefined) {
    return { dir: path.resolve(inputs.baseDir, fromEnv.trim()), source: 'env' }
  }
  const fromConfig = usable('config', nonBlank(inputs.configured))
  if (fromConfig !== undefined) {
    return { dir: path.resolve(inputs.baseDir, fromConfig.trim()), source: 'config' }
  }
  const legacy =
    typeof inputs.legacyPending === 'function' ? inputs.legacyPending() : inputs.legacyPending
  if (legacy === true) {
    return { dir: path.resolve(inputs.baseDir, LEGACY_CACHE_DIR), source: 'legacy' }
  }
  return { dir: defaultUserCacheDir(environment), source: 'default' }
}

/** Why a `cacheDir` / `RITUAL_CACHE_DIR` value cannot name the card cache. */
export type CacheDirProblem =
  /** Starts with `~`, which only a shell expands — Ritual would make a folder named `~`. */
  | 'tilde'
  /** A file system root. */
  | 'root'
  /** The home directory itself. */
  | 'home'
  /** The workspace itself, or a folder containing it. */
  | 'workspace'
  /** One of the workspace's list folders, or a folder inside one. */
  | 'list-dir'

/** What {@link cacheDirProblem} checks a value against. */
export type CacheDirCheckContext = {
  baseDir: string
  /** The workspace's deck, collection and wanted-list folders, as configured. */
  listDirs: readonly string[]
  home: string
  /** Whose path rules apply (case); the running platform by default. */
  platform?: NodeJS.Platform
}

/**
 * The reason a cache directory value is unusable, or null. The cache is
 * hundreds of megabytes of files Ritual writes, renames and (on a move)
 * deletes, so it must never be pointed at a folder that holds anything else
 * of the user's.
 */
export function cacheDirProblem(
  value: string,
  context: CacheDirCheckContext,
): CacheDirProblem | null {
  const trimmed = value.trim()
  if (trimmed.startsWith('~')) return 'tilde'
  const platform = context.platform ?? process.platform
  const resolved = path.resolve(context.baseDir, trimmed)
  if (path.parse(resolved).root === resolved) return 'root'
  const home = path.resolve(context.home)
  if (isSameOrWithin(resolved, home, platform) && isSameOrWithin(home, resolved, platform)) {
    return 'home'
  }
  if (isSameOrWithin(path.resolve(context.baseDir), resolved, platform)) return 'workspace'
  const listDirs = context.listDirs.map((dir) => path.resolve(context.baseDir, dir))
  if (listDirs.some((dir) => isSameOrWithin(resolved, dir, platform))) return 'list-dir'
  return null
}
