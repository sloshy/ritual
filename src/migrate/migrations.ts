/**
 * The numbered workspace migrations, oldest first.
 *
 * Numbering restarted for the 0.1.0 release: the counter is back at 0 (none
 * applied) and the first migration added from here is id 1. The migrations
 * written during pre-release development were dropped along with the code that
 * existed only for them. That reset was a one-time, pre-release event, not a
 * precedent. From here the list is append only: an id, once released, is
 * never reused, renumbered or removed, because `managed.migration` in every
 * workspace records how far it got.
 */

import type { Migration } from './types'

export const MIGRATIONS: readonly Migration[] = []

/** The highest migration id in a list, or 0 for none. */
export function latestMigrationId(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.reduce((max, migration) => Math.max(max, migration.id), 0)
}
