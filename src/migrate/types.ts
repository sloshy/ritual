/**
 * The shapes of the workspace-migration engine: a numbered {@link Migration}
 * plans the {@link MigrationOp}s still needed to bring one aspect of a
 * workspace up to date, and the runner (`runner.ts`) applies them.
 */

import type { RawConfig } from '../config/ritual-config'
import type { SyncMessageRef } from '../sync/message'
import type { CacheDirSource } from '../config/cache-location'
import type { JsonValue } from '../util/json'

export type { RawConfig } from '../config/ritual-config'

/** What a migration may inspect while planning. */
export type MigrationContext = {
  /**
   * The raw config as it will stand when this migration runs — the file on
   * disk with every earlier pending migration's config ops already applied.
   */
  config: RawConfig
  /** The workspace root; op paths are relative to it. */
  baseDir: string
}

/** A key path into the raw config; never empty. */
export type ConfigKeyPath = readonly [string, ...string[]]

/** Set the value at a key path of the raw config. */
export type ConfigSetOp = { type: 'config-set'; path: ConfigKeyPath; value: JsonValue }
/** Remove the key at a key path of the raw config. */
export type ConfigDeleteOp = { type: 'config-delete'; path: ConfigKeyPath }
/** Write a workspace file (path relative to the base dir). */
export type WriteOp = { type: 'write'; path: string; content: string }
/** Delete a workspace file (path relative to the base dir); a missing file is fine. */
export type DeleteOp = { type: 'delete'; path: string }
/** Move a workspace file (paths relative to the base dir). */
export type RenameOp = { type: 'rename'; from: string; to: string }

/**
 * Move the workspace's legacy cache folder (`from`, relative to the base dir)
 * into the cache directory it now resolves to (`to`, absolute — outside the
 * workspace as a rule). Not a {@link FileOp}: it leaves the workspace, and its
 * hundreds of megabytes of regenerable data are never backed up.
 */
export type CacheMoveOp = {
  type: 'cache-move'
  from: string
  to: string
  /** Which setting chose `to`, so the plan can say a config or variable named it. */
  source: CacheDirSource
}
/**
 * Leave the legacy cache folder (`path`, relative to the base dir) where it
 * is, because the cache directory it would move to (`shared`) already holds
 * data. Changes nothing on disk; applying it tells the user once that the
 * folder is no longer read and can be deleted.
 */
export type CacheKeepOp = { type: 'cache-keep'; path: string; shared: string }

export type ConfigOp = ConfigSetOp | ConfigDeleteOp
export type FileOp = WriteOp | DeleteOp | RenameOp
export type CacheOp = CacheMoveOp | CacheKeepOp
export type MigrationOp = ConfigOp | FileOp | CacheOp

/** Whether an op concerns the card cache folder. */
export function isCacheOp(op: MigrationOp): op is CacheOp {
  return op.type === 'cache-move' || op.type === 'cache-keep'
}

/** Whether an op touches workspace files rather than the config. */
export function isFileOp(op: MigrationOp): op is FileOp {
  return op.type === 'write' || op.type === 'delete' || op.type === 'rename'
}

/**
 * One append-only, numbered, one-time change to a workspace's shape. Ids are
 * never reused or reordered: `managed.migration` records the highest one
 * applied.
 */
export type Migration = {
  id: number
  /**
   * What this migration does: a catalog key and the config keys and files it
   * names as params, rendered in the active UI locale when the plan is printed.
   */
  description: SyncMessageRef
  /**
   * Whether this migration may have ops for the workspace — cheap and
   * in-memory. The pre-command check (`checkPendingWork`) trusts a `false`
   * here to mean "nothing to do", so it must not be true for a workspace the
   * migration has nothing left to change in.
   */
  applies: (ctx: MigrationContext) => boolean
  /**
   * Inspect the current state and return the operations still needed — none
   * when the workspace already satisfies the migration, so re-running an
   * applied migration (or trusting a wrong counter) is harmless.
   */
  plan: (ctx: MigrationContext) => Promise<MigrationOp[]>
}
