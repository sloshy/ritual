/**
 * The numbered workspace migrations, oldest first. Append only: an id, once
 * released, is never reused, renumbered or removed, because
 * `managed.migration` in every workspace records how far it got.
 */

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { syncRef, type SyncMessageRef } from '../sync/message'
import { isRecord } from '../util/json'
import type { Migration, MigrationContext, MigrationOp } from './types'
import {
  COMMAND,
  CONFIG_KEY,
  ENV_VAR,
  commandLine,
  FILE,
  RETIRED_CONFIG_KEY,
  type RetiredConfigKey,
} from '../util/cli-tokens'
import {
  LEGACY_CACHE_DIR,
  resolveCacheDir,
  SHARED_CACHE_MIGRATION_ID,
  type CacheDirCheckContext,
  type CacheDirLocation,
} from '../config/cache-location'
import { warnRejectedCacheDirOnce } from '../cache/file-cache'
import { hasCacheDataSync } from '../cache/cache-entries'
import { legacyCacheAction } from '../cache/relocate'
import { pathsOverlap } from '../util/path-validation'
import { PROCESS_ENVIRONMENT, type UserDirsEnvironment } from '../util/user-dirs'
import { LOGINS_DIR, LOGINS_GITIGNORE, LOGINS_GITIGNORE_CONTENT } from '../auth/logins-dir'

/** A migration that removes one retired key from the `site` block, when present. */
function dropSiteKey(
  id: number,
  retired: RetiredConfigKey,
  description: SyncMessageRef,
): Migration {
  const key = retired.slice('site.'.length)
  return {
    id,
    description,
    applies: (ctx: MigrationContext): boolean =>
      isRecord(ctx.config.site) && ctx.config.site[key] !== undefined,
    plan: (ctx: MigrationContext): Promise<MigrationOp[]> => {
      const site = ctx.config.site
      const needed = isRecord(site) && site[key] !== undefined
      return Promise.resolve(needed ? [{ type: 'config-delete', path: ['site', key] }] : [])
    },
  }
}

/** A raw config value, when it is a string. */
function rawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Where the workspace's cache resolves to, read from the config as this
 * migration sees it. The legacy tier is left out: the old folder is what moves.
 */
function cacheTarget(ctx: MigrationContext, environment?: UserDirsEnvironment): CacheDirLocation {
  const running = environment ?? PROCESS_ENVIRONMENT
  const check: CacheDirCheckContext = {
    baseDir: ctx.baseDir,
    listDirs: [
      rawString(ctx.config.decksDir) ?? './decks',
      rawString(ctx.config.collectionsDir) ?? './collections',
      rawString(ctx.config.wantedDir) ?? './wanted',
    ],
    home: running.home,
    platform: running.platform,
  }
  // Exactly as the cache resolves at run time: an override naming a folder the
  // cache may not take over is skipped (with the same one-time warning), and
  // the next tier is the target.
  return resolveCacheDir({
    baseDir: ctx.baseDir,
    configured: rawString(ctx.config.cacheDir),
    environment: running,
    check,
    onRejected: (rejected) => warnRejectedCacheDirOnce(rejected, check),
  })
}

/**
 * Migration 3: the card cache moved out of every workspace's `cache/` folder
 * into one per-user cache (unless `RITUAL_CACHE_DIR` or the `cacheDir` key
 * names another directory). Until it runs, a workspace with data in `cache/`
 * keeps reading that folder (`src/cache/file-cache.ts`), so nothing downloads
 * into the shared cache first.
 *
 * - The target does not exist, or is an empty folder: the old cache moves
 *   there whole, all or nothing (see `src/cache/relocate.ts`).
 * - The target holds anything at all (another workspace's cache, the user's
 *   files, a `.DS_Store`): the old folder is left untouched and the user is
 *   told it can be deleted. Nothing in the target is ever merged into or deleted.
 * - The cache still resolves to `cache/` itself (`cacheDir: "cache"`), or the
 *   folder holds no cache data: nothing to do.
 *
 * `environment` is the tests' seam; production reads the running process.
 */
export function sharedCacheMigration(id: number, environment?: UserDirsEnvironment): Migration {
  return {
    id,
    description: syncRef('cli.migrate.migration.sharedCache', {
      dir: `${LEGACY_CACHE_DIR}/`,
      envVar: ENV_VAR.cacheDir,
      configKey: CONFIG_KEY.cacheDir,
    }),
    // Cheap by contract: a listing of `cache/` and path comparisons (the plan
    // also resolves symlinks and case-insensitive spellings).
    applies: (ctx: MigrationContext): boolean => {
      const legacy = path.join(ctx.baseDir, LEGACY_CACHE_DIR)
      const target = cacheTarget(ctx, environment)
      if (!existsSync(legacy)) return false
      if (pathsOverlap(target.dir, path.resolve(legacy))) return false
      return hasCacheDataSync(legacy)
    },
    plan: async (ctx: MigrationContext): Promise<MigrationOp[]> => {
      const legacy = path.join(ctx.baseDir, LEGACY_CACHE_DIR)
      const target = cacheTarget(ctx, environment)
      switch (await legacyCacheAction(legacy, target.dir)) {
        case 'none':
          return []
        case 'move':
          return [
            { type: 'cache-move', from: LEGACY_CACHE_DIR, to: target.dir, source: target.source },
          ]
        case 'keep':
          return [{ type: 'cache-keep', path: LEGACY_CACHE_DIR, shared: target.dir }]
      }
    },
  }
}

/** Whether `relative` (to the workspace) is a directory. */
function isDirectory(baseDir: string, relative: string): boolean {
  return statSync(path.join(baseDir, relative), { throwIfNoEntry: false })?.isDirectory() ?? false
}

/**
 * Migration 4: a `.logins/` folder keeps a `.gitignore` of its own, so sign-ins
 * stay out of git in a workspace that never ran `init-site` (whose root
 * `.gitignore` is the only other thing that ignored them). Ritual now writes it
 * whenever it writes into the folder; this adds it to a folder made before.
 * An existing `.logins/.gitignore` is left as it is, and a workspace with no
 * `.logins/` folder has nothing to do.
 */
function loginsGitignoreMigration(id: number): Migration {
  const needed = (ctx: MigrationContext): boolean =>
    isDirectory(ctx.baseDir, LOGINS_DIR) && !existsSync(path.join(ctx.baseDir, LOGINS_GITIGNORE))
  return {
    id,
    description: syncRef('cli.migrate.migration.loginsGitignore', {
      dir: `${LOGINS_DIR}/`,
      file: LOGINS_GITIGNORE,
      gitignore: FILE.gitignore,
      command: commandLine(COMMAND.initSite),
    }),
    applies: needed,
    plan: (ctx: MigrationContext): Promise<MigrationOp[]> =>
      Promise.resolve(
        needed(ctx)
          ? [{ type: 'write', path: LOGINS_GITIGNORE, content: LOGINS_GITIGNORE_CONTENT }]
          : [],
      ),
  }
}

export const MIGRATIONS: readonly Migration[] = [
  // `site.version` recorded the Ritual that last ran `init-site`. The
  // `managed` block (migration counter, output hash, release pin) replaces it.
  dropSiteKey(
    1,
    RETIRED_CONFIG_KEY.siteVersion,
    syncRef('cli.migrate.migration.dropSiteVersion', {
      configKey: RETIRED_CONFIG_KEY.siteVersion,
      file: FILE.config,
    }),
  ),
  // `site.prerelease` chose the release channel the publish-for-me workflow
  // downloaded. The workflow now downloads the pinned `managed.version`, and
  // the channel is chosen when installing Ritual.
  dropSiteKey(
    2,
    RETIRED_CONFIG_KEY.sitePrerelease,
    syncRef('cli.migrate.migration.dropSitePrerelease', {
      sitePrereleaseConfigKey: RETIRED_CONFIG_KEY.sitePrerelease,
      file: FILE.config,
      managedVersionConfigKey: CONFIG_KEY.managedVersion,
    }),
  ),
  sharedCacheMigration(SHARED_CACHE_MIGRATION_ID),
  loginsGitignoreMigration(4),
]

/** The highest migration id in a list, or 0 for none. */
export function latestMigrationId(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, migration) => Math.max(max, migration.id), 0)
}
