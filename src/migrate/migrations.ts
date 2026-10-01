/**
 * The numbered workspace migrations, oldest first. Append only: an id, once
 * released, is never reused, renumbered or removed, because
 * `managed.migration` in every workspace records how far it got.
 */

import { isRecord } from '../util/json'
import type { Migration, MigrationContext, MigrationOp } from './types'

export const MIGRATIONS: readonly Migration[] = [
  {
    // `site.version` recorded the Ritual that last ran `init-site`. The
    // `managed` block (migration counter, output hash, release pin) replaces it.
    id: 1,
    descriptionKey: 'cli.migrate.migration.dropSiteVersion',
    applies: (ctx: MigrationContext): boolean => isRecord(ctx.config.site),
    plan: (ctx: MigrationContext): Promise<MigrationOp[]> => {
      const site = ctx.config.site
      const needed = isRecord(site) && site.version !== undefined
      return Promise.resolve(needed ? [{ type: 'config-delete', path: ['site', 'version'] }] : [])
    },
  },
]

/** The highest migration id in a list, or 0 for none. */
export function latestMigrationId(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, migration) => Math.max(max, migration.id), 0)
}
