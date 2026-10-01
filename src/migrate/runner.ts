/**
 * The migration runner: plan every pending numbered migration and any due
 * managed-output refresh against the raw config, then apply the plan.
 *
 * Planning writes nothing, so `ritual migrate --dry-run` prints exactly what an
 * apply would do. The runner reads the config as raw JSON because the strict
 * parser rejects the very keys a migration exists to remove or retype; the
 * migrated result — with the `managed` block this run would stamp — is
 * validated with the strict parser at plan time, so a config that would still
 * be invalid aborts before anything is written.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  isMigrationCounter,
  isConfigParseError,
  parseRitualConfig,
  readRawRitualConfig,
  refreshRitualConfig,
  writeRawRitualConfig,
  type ManagedConfig,
} from '../config/ritual-config'
import { deleteAtPath, setAtPath } from '../config/config-fields'
import { getBaseDir } from '../config/base-dir'
import { compareVersions, isValidSemver } from '../config/semver'
import { isReleaseBuild, version as ritualVersion } from '../config/version'
import { CardCommandError, ExitCode, localizedCommandError } from '../util/errors'
import { isRecord } from '../util/json'
import { SKILLS } from '../skills/catalog'
import type { RitualSkill } from '../skills/types'
import {
  applyManagedRefresh,
  computeManagedOutput,
  planManagedRefresh,
  type ManagedRefreshPlan,
  type ManagedRefreshResult,
} from './managed-output'
import { writeWorkspaceFile } from './managed-files'
import { MIGRATIONS, latestMigrationId } from './migrations'
import {
  isFileOp,
  type FileOp,
  type Migration,
  type MigrationContext,
  type MigrationOp,
  type RawConfig,
} from './types'

/** The build doing the migrating — what may be recorded as `managed.version`. */
export type BuildIdentity = {
  version: string
  /** Only a release build records its version (see `isReleaseVersion`). */
  release: boolean
}

/** The running build's identity. */
export const RUNNING_BUILD: BuildIdentity = { version: ritualVersion, release: isReleaseBuild }

/** Seams for tests; production uses the defaults. */
export type MigrateOptions = {
  migrations?: readonly Migration[]
  skills?: readonly RitualSkill[]
  build?: BuildIdentity
}

/** One migration above the recorded counter, with the ops it still needs. */
export type PendingMigration = {
  migration: Migration
  /** Empty when the workspace already satisfies the migration. */
  ops: MigrationOp[]
}

/** Everything `migrate` would do, computed without writing. */
export type MigrationPlan = {
  kind: 'plan'
  /** The config file as read. */
  raw: RawConfig
  /** The valid parts of the recorded `managed` block (a malformed counter reads as 0). */
  recorded: ManagedConfig
  /** Every migration with an id above the recorded counter, in id order. */
  migrations: PendingMigration[]
  /** The managed-output refresh, or null when none is due. */
  refresh: ManagedRefreshPlan | null
  /** The `managed` block stamped once everything is applied. */
  managed: ManagedConfig
  /** Whether this build records its version in {@link managed}. */
  release: boolean
}

/** There is no `ritual.config.json`, so there is nothing to migrate. */
export type NoConfigOutcome = { kind: 'no-config' }

/**
 * A newer Ritual last updated this workspace: it applied migrations this build
 * does not know, or it recorded a newer release than this one.
 */
export type AheadOutcome = {
  kind: 'ahead'
  applied: number
  latest: number
  /** The release that updated it, when one was recorded. */
  version?: string
}

/** The migrated config would still fail strict validation; nothing may be written. */
export type InvalidOutcome = { kind: 'invalid'; error: string }

export type PlanOutcome = MigrationPlan | NoConfigOutcome | AheadOutcome | InvalidOutcome

/** Whether applying the plan would change anything. */
export function hasPendingWork(plan: MigrationPlan): boolean {
  return plan.refresh !== null || plan.migrations.some((pending) => pending.ops.length > 0)
}

/** Whether any pending migration still has ops to run. */
export function hasPendingMigrations(plan: MigrationPlan): boolean {
  return plan.migrations.some((pending) => pending.ops.length > 0)
}

/** The localized refusal for an outcome no command may act on. */
export function refusalError(outcome: AheadOutcome | InvalidOutcome): CardCommandError {
  if (outcome.kind === 'invalid') {
    return localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.invalid', {
      error: outcome.error,
    })
  }
  return outcome.version === undefined
    ? localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.aheadNoVersion', {
        applied: outcome.applied,
        latest: outcome.latest,
      })
    : localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.ahead', {
        version: outcome.version,
      })
}

/**
 * The valid parts of the raw `managed` block. A counter that is not a
 * non-negative integer reads as 0 — plans are state-based, so a wrong counter
 * costs a re-plan, never a wrong change — and a malformed `version` or
 * `output` is dropped, to be replaced by this run's stamp.
 */
function recordedManaged(raw: RawConfig): ManagedConfig {
  const managed = isRecord(raw.managed) ? raw.managed : {}
  const recorded: ManagedConfig = {
    migration: isMigrationCounter(managed.migration) ? managed.migration : 0,
  }
  if (typeof managed.version === 'string' && isValidSemver(managed.version)) {
    recorded.version = managed.version
  }
  if (typeof managed.output === 'string' && managed.output.startsWith('sha256:')) {
    recorded.output = managed.output
  }
  return recorded
}

/** What {@link buildManagedStamp} records. */
export type ManagedStampInput = {
  migration: number
  build: BuildIdentity
  /** The release already recorded, kept when this build is not a release. */
  recordedVersion?: string
  /** The managed-output hash to record; omitted when there is none to claim. */
  output?: string
}

/** The `managed` block to stamp: only a release build records its own version. */
export function buildManagedStamp(input: ManagedStampInput): ManagedConfig {
  const managed: ManagedConfig = { migration: input.migration }
  const version = input.build.release ? input.build.version : input.recordedVersion
  if (version !== undefined) managed.version = version
  if (input.output !== undefined) managed.output = input.output
  return managed
}

/** Replace the raw config's `managed` block. */
function withManaged(raw: RawConfig, managed: ManagedConfig): RawConfig {
  return { ...raw, managed }
}

/** Apply one migration's config ops to a raw config (file ops are skipped). */
function applyConfigOps(raw: RawConfig, ops: readonly MigrationOp[]): RawConfig {
  let next = raw
  for (const op of ops) {
    if (op.type === 'config-set') next = setAtPath(next, [...op.path], op.value)
    else if (op.type === 'config-delete') next = deleteAtPath(next, [...op.path])
  }
  return next
}

/**
 * Plan everything pending for the workspace at the current base dir: each
 * migration above the recorded counter (planned in id order against the config
 * as the earlier ones leave it), and a managed-output refresh when the output
 * hash changed.
 */
export async function planMigration(options: MigrateOptions = {}): Promise<PlanOutcome> {
  const migrations = [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.id - b.id)
  const skills = options.skills ?? SKILLS
  const build = options.build ?? RUNNING_BUILD

  const raw = await readRawRitualConfig()
  if (raw === null) return { kind: 'no-config' }

  const recorded = recordedManaged(raw)
  const latest = latestMigrationId(migrations)
  const ahead =
    recorded.migration > latest ||
    (build.release &&
      recorded.version !== undefined &&
      compareVersions(build.version, recorded.version) < 0)
  if (ahead) {
    return recorded.version === undefined
      ? { kind: 'ahead', applied: recorded.migration, latest }
      : { kind: 'ahead', applied: recorded.migration, latest, version: recorded.version }
  }

  const baseDir = getBaseDir()
  let simulated = raw
  const pending: PendingMigration[] = []
  for (const migration of migrations) {
    if (migration.id <= recorded.migration) continue
    const ctx: MigrationContext = { config: simulated, baseDir }
    const ops = migration.applies(ctx) ? await migration.plan(ctx) : []
    simulated = applyConfigOps(simulated, ops)
    pending.push({ migration, ops })
  }

  // Validate what would be written — the migrated config with this run's
  // stamp, not the recorded block, so a malformed `managed` never locks out
  // the command that fixes it. The output hash is always a well-formed
  // `sha256:` string, so adding it after validation cannot invalidate it.
  const stamp = buildManagedStamp({
    migration: latest,
    build,
    recordedVersion: recorded.version,
  })
  const parsed = parseRitualConfig(withManaged(simulated, stamp))
  if (isConfigParseError(parsed)) return { kind: 'invalid', error: parsed.error }

  const output = computeManagedOutput(parsed, skills)
  const refresh =
    output !== null && output.hash !== recorded.output
      ? await planManagedRefresh(output, skills)
      : null
  const managed = output === null ? stamp : { ...stamp, output: output.hash }

  return {
    kind: 'plan',
    raw,
    recorded,
    migrations: pending,
    refresh,
    managed,
    release: build.release,
  }
}

async function applyFileOp(op: FileOp): Promise<void> {
  const baseDir = getBaseDir()
  switch (op.type) {
    case 'write':
      await writeWorkspaceFile(op.path, op.content)
      return
    case 'delete':
      await fs.rm(path.join(baseDir, op.path), { force: true })
      return
    case 'rename': {
      const to = path.join(baseDir, op.to)
      await fs.mkdir(path.dirname(to), { recursive: true })
      await fs.rename(path.join(baseDir, op.from), to)
      return
    }
    default:
      op satisfies never
  }
}

/** What an apply did. */
export type MigrationResult = {
  /** The migrations that changed something, in order. */
  applied: Migration[]
  refresh: ManagedRefreshResult | null
}

/**
 * Apply a plan. The config must still be exactly what was planned against —
 * otherwise nothing is written. Each migration with ops runs in order and
 * `managed.migration` is stamped right after it, so a failure part-way resumes
 * at the failed migration on the next run. The refresh follows, then the final
 * `managed` stamp. Every stamp replaces the whole block.
 */
export async function applyMigration(
  plan: MigrationPlan,
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  const current = await readRawRitualConfig()
  if (JSON.stringify(current) !== JSON.stringify(plan.raw)) {
    throw localizedCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      'cli.migrate.changedSincePlan',
    )
  }

  const skills = options.skills ?? SKILLS
  let config = plan.raw
  const applied: Migration[] = []
  for (const { migration, ops } of plan.migrations) {
    if (ops.length === 0) continue
    for (const op of ops) {
      if (isFileOp(op)) await applyFileOp(op)
    }
    config = withManaged(applyConfigOps(config, ops), { ...plan.recorded, migration: migration.id })
    await writeRawRitualConfig(config)
    applied.push(migration)
  }

  const refresh = plan.refresh === null ? null : await applyManagedRefresh(plan.refresh, skills)

  await writeRawRitualConfig(withManaged(config, plan.managed))
  await refreshRitualConfig()
  return { applied, refresh }
}
