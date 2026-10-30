/**
 * The numbered workspace migrations, oldest first. Append only: an id, once
 * released, is never reused, renumbered or removed, because
 * `managed.migration` in every workspace records how far it got.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { syncRef, type SyncMessageRef } from '../sync/message'
import { isRecord } from '../util/json'
import type { Migration, MigrationContext, MigrationOp } from './types'
import {
  CONFIG_KEY,
  ENV_VAR,
  FILE,
  RETIRED_CONFIG_KEY,
  type RetiredConfigKey,
} from '../util/cli-tokens'
import { resolveCacheDir, type CacheDirLocation } from '../cache/location'
import { LEGACY_CACHE_DIR, legacyCacheAction, pathsOverlap } from '../cache/relocate'
import type { UserDirsEnvironment } from '../util/user-dirs'

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

/** Where the workspace's cache resolves to, read from the config as this migration sees it. */
function cacheTarget(ctx: MigrationContext, environment?: UserDirsEnvironment): CacheDirLocation {
  const configured = ctx.config.cacheDir
  return resolveCacheDir({
    baseDir: ctx.baseDir,
    configured: typeof configured === 'string' ? configured : undefined,
    environment,
  })
}

/**
 * Migration 3: the card cache moved out of every workspace's `cache/` folder
 * into one per-user cache (unless `RITUAL_CACHE_DIR` or the `cacheDir` key
 * names another directory). A workspace's old cache is moved into the
 * directory it now resolves to when that directory holds no cache data yet —
 * a rename on the same file system, else copy-then-delete. When it already
 * holds data (another workspace got there first), the old folder is left
 * untouched and the user is told it can be deleted: a cache is never deleted
 * that the new location did not receive. A workspace whose cache still
 * resolves to its own `cache/` (`cacheDir: "cache"`) has nothing to do.
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
    // Cheap by contract: one stat, and a path comparison (the plan also
    // resolves symlinks and case-insensitive spellings).
    applies: (ctx: MigrationContext): boolean => {
      const legacy = path.join(ctx.baseDir, LEGACY_CACHE_DIR)
      return (
        existsSync(legacy) && !pathsOverlap(cacheTarget(ctx, environment).dir, path.resolve(legacy))
      )
    },
    plan: async (ctx: MigrationContext): Promise<MigrationOp[]> => {
      const legacy = path.join(ctx.baseDir, LEGACY_CACHE_DIR)
      const target = cacheTarget(ctx, environment).dir
      switch (await legacyCacheAction(legacy, target)) {
        case 'none':
          return []
        case 'move':
          return [{ type: 'cache-move', from: LEGACY_CACHE_DIR, to: target }]
        case 'keep':
          return [{ type: 'cache-keep', path: LEGACY_CACHE_DIR, shared: target }]
      }
    },
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
  sharedCacheMigration(3),
]

/** The highest migration id in a list, or 0 for none. */
export function latestMigrationId(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, migration) => Math.max(max, migration.id), 0)
}
