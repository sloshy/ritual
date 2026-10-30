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
import {
  defaultUserCacheDir,
  nonBlank,
  PROCESS_ENVIRONMENT,
  type UserDirsEnvironment,
} from '../util/user-dirs'

/** Every tier of the precedence, highest first. */
export const CACHE_DIR_SOURCES = ['env', 'config', 'default'] as const

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
  /** The process environment, platform and home directory; the running process by default. */
  environment?: UserDirsEnvironment
}

/** Resolve the card cache directory by the precedence in the module comment. */
export function resolveCacheDir(inputs: CacheDirInputs): CacheDirLocation {
  const environment = inputs.environment ?? PROCESS_ENVIRONMENT
  const fromEnv = nonBlank(environment.env[ENV_VAR.cacheDir])
  if (fromEnv !== undefined) {
    return { dir: path.resolve(inputs.baseDir, fromEnv.trim()), source: 'env' }
  }
  const fromConfig = nonBlank(inputs.configured)
  if (fromConfig !== undefined) {
    return { dir: path.resolve(inputs.baseDir, fromConfig.trim()), source: 'config' }
  }
  return { dir: defaultUserCacheDir(environment), source: 'default' }
}
