/**
 * Fixtures for the workspace-migration engine. The shipped migration list can
 * be empty, so tests that need a pending numbered migration inject one of
 * these through the `migrations` seam (`MigrateOptions`), and tests that spawn
 * the binary use {@link REFRESH_DUE_CONFIG} instead.
 */

import {
  planMigration,
  type BuildIdentity,
  type MigrateOptions,
  type MigrationPlan,
} from '../../src/migrate/runner'
import type {
  ConfigKeyPath,
  Migration,
  MigrationContext,
  MigrationOp,
} from '../../src/migrate/types'
import { syncRef, type SyncMessageRef } from '../../src/sync/message'
import { isRecord } from '../../src/util/json'

/** A dev build: it never records its version as the CI pin. */
export const DEV_BUILD: BuildIdentity = { version: '0.0.0-dev.abc', release: false }

/** A release build of `version`. */
export function releaseBuild(version: string): BuildIdentity {
  return { version, release: true }
}

/** Any params-free key: a test migration's description is never the point. */
export const TEST_MIGRATION_DESCRIPTION: SyncMessageRef = syncRef('cli.migrate.planHeading')

/**
 * Set up by `init-site`, but its generated output never recorded: a managed
 * refresh is due, with no numbered migration involved.
 */
export const REFRESH_DUE_CONFIG = { site: { ciSystem: 'manual' } } as const

/**
 * A test migration that plans a fixed op list whenever it runs. Its `applies`
 * is always true, which breaks the contract `checkPendingWork` relies on once
 * the ops are in place, so use {@link dropKeyMigration} where the fast check
 * is under test.
 */
export function fixedMigration(id: number, ops: MigrationOp[]): Migration {
  return {
    id,
    description: TEST_MIGRATION_DESCRIPTION,
    applies: () => true,
    plan: () => Promise.resolve(ops),
  }
}

/** Whether the raw config has a value at `keyPath`. */
function hasKey(config: Record<string, unknown>, keyPath: ConfigKeyPath): boolean {
  const [key, ...rest] = keyPath
  if (!(key in config)) return false
  if (rest.length === 0) return true
  const child = config[key]
  return isRecord(child) && hasKey(child, rest as unknown as ConfigKeyPath)
}

/**
 * A state-based test migration, shaped like a real one: it removes the key at
 * `keyPath` while the raw config has it, and has nothing to do otherwise.
 */
export function dropKeyMigration(id: number, keyPath: ConfigKeyPath): Migration {
  const present = (ctx: MigrationContext): boolean => hasKey(ctx.config, keyPath)
  return {
    id,
    description: TEST_MIGRATION_DESCRIPTION,
    applies: present,
    plan: (ctx) => Promise.resolve(present(ctx) ? [{ type: 'config-delete', path: keyPath }] : []),
  }
}

/** Plan as a dev build (unless overridden), expecting a plan rather than a refusal. */
export async function expectPlan(options: MigrateOptions = {}): Promise<MigrationPlan> {
  const outcome = await planMigration({ build: DEV_BUILD, ...options })
  if (outcome.kind !== 'plan') throw new Error(`expected a plan, got ${outcome.kind}`)
  return outcome
}
