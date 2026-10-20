/**
 * The numbered workspace migrations, oldest first. Append only: an id, once
 * released, is never reused, renumbered or removed, because
 * `managed.migration` in every workspace records how far it got.
 */

import { syncRef, type SyncMessageRef } from '../sync/message'
import { isRecord } from '../util/json'
import type { Migration, MigrationContext, MigrationOp } from './types'
import { CONFIG_KEY, FILE, RETIRED_CONFIG_KEY, type RetiredConfigKey } from '../util/cli-tokens'

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
]

/** The highest migration id in a list, or 0 for none. */
export function latestMigrationId(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, migration) => Math.max(max, migration.id), 0)
}
