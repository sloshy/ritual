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
  getRitualConfigPath,
  getSiteDeployConfig,
  isMigrationCounter,
  isConfigParseError,
  parseRitualConfig,
  readRawRitualConfig,
  refreshRitualConfig,
  writeRawRitualConfig,
  type InitSiteConfig,
  type ManagedConfig,
  type RitualConfig,
} from '../config/ritual-config'
import { deleteAtPath, setAtPath } from '../config/config-fields'
import { getBaseDir } from '../config/base-dir'
import { compareVersions, isValidSemver } from '../config/semver'
import { isReleaseBuild, version as ritualVersion } from '../config/version'
import {
  CardCommandError,
  ExitCode,
  localizedCommandError,
  messageCommandError,
} from '../util/errors'
import { nestSync, syncMessage, type SyncMessage } from '../sync/message'
import { isRecord } from '../util/json'
import { backUpFiles } from '../util/safekeeping'
import { renameWithRetry } from '../util/atomic-write'
import {
  finishLegacyCacheMove,
  moveLegacyCache,
  type LegacyCacheMoveResult,
} from '../cache/relocate'
import { SKILLS } from '../skills/catalog'
import type { RitualSkill } from '../skills/types'
import {
  applyManagedRefresh,
  computeManagedOutput,
  planManagedRefresh,
  type ManagedOutput,
  type ManagedRefreshPlan,
  type ManagedRefreshResult,
} from './managed-output'
import { downloadsPinnedRelease, writeWorkspaceFile } from './managed-files'
import { MIGRATIONS, latestMigrationId } from './migrations'
import {
  isCacheOp,
  isFileOp,
  type CacheOp,
  type FileOp,
  type Migration,
  type MigrationContext,
  type MigrationOp,
  type RawConfig,
} from './types'
import { COMMAND, FILE, FLAG, bareCommandLine, commandLine } from '../util/cli-tokens'

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

/**
 * A pin bump: the running release is newer than the workspace's pin, so
 * applying moves `managed.version` (what the publish-for-me workflow
 * downloads) forward.
 */
export type PinBump = {
  /** The release the pin moves to — the running build. */
  to: string
  /** The release pinned now; absent when the workspace has no pin yet. */
  from?: string
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
  /**
   * The pin bump, or null when none is due. Only publish-for-me workspaces
   * have one: theirs is the only CI that downloads the pinned release. Other
   * workspaces still get the pin stamped whenever `migrate` does run.
   */
  pinBump: PinBump | null
  /** The `managed` block stamped once everything is applied. */
  managed: ManagedConfig
  /** The build that planned it; only a release records its version in {@link managed}. */
  build: BuildIdentity
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
export type InvalidOutcome = { kind: 'invalid'; error: SyncMessage }

export type PlanOutcome = MigrationPlan | NoConfigOutcome | AheadOutcome | InvalidOutcome

/** Whether applying the plan would change anything. */
export function hasPendingWork(plan: MigrationPlan): boolean {
  return plan.refresh !== null || plan.pinBump !== null || hasPendingMigrations(plan)
}

/** Whether any pending migration still has ops to run. */
export function hasPendingMigrations(plan: MigrationPlan): boolean {
  return plan.migrations.some((pending) => pending.ops.length > 0)
}

/** The localized refusal for an outcome no command may act on. */
export function refusalError(outcome: AheadOutcome | InvalidOutcome): CardCommandError {
  if (outcome.kind === 'invalid') {
    // The validator's refusal nests, so the CLI words both in its language and
    // the `--output json` envelope carries the English of each.
    return messageCommandError(
      'runtime_error',
      ExitCode.RuntimeError,
      syncMessage('cli.migrate.invalid', {
        error: nestSync(outcome.error),
        file: FILE.config,
        command: commandLine(COMMAND.migrate),
      }),
    )
  }
  const command = aheadRemedyCommand(outcome)
  return outcome.version === undefined
    ? localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.aheadNoVersion', {
        applied: outcome.applied,
        latest: outcome.latest,
        command,
      })
    : localizedCommandError('runtime_error', ExitCode.RuntimeError, 'cli.migrate.ahead', {
        version: outcome.version,
        command,
      })
}

/**
 * The command that brings a newer Ritual to a workspace one updated: `self-update
 * --tag` (the message appends the version) when the release is known, or a plain
 * `self-update` when only its migration number is.
 */
export function aheadRemedyCommand(outcome: AheadOutcome): string {
  return outcome.version === undefined
    ? commandLine(COMMAND.selfUpdate)
    : commandLine(COMMAND.selfUpdate, FLAG.tag)
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

/**
 * The pin bump a release build owes a publish-for-me workspace whose pin is
 * older than the build (or absent), or null. A dev build never pins, and other
 * deploys run no Ritual in CI, so neither is ever owed one. A release older
 * than the pin never reaches here — the planner refuses it as `ahead`.
 */
export function planPinBump(
  deploy: InitSiteConfig | null,
  build: BuildIdentity,
  pinned: string | undefined,
): PinBump | null {
  if (!build.release || !downloadsPinnedRelease(deploy)) return null
  if (pinned === undefined) return { to: build.version }
  return compareVersions(build.version, pinned) > 0 ? { to: build.version, from: pinned } : null
}

/**
 * The `ahead` outcome when a newer Ritual last updated the workspace — its
 * counter is above every migration this build knows, or (for a release build)
 * the recorded release is newer than this one — else null.
 */
function aheadOutcome(
  recorded: ManagedConfig,
  latest: number,
  build: BuildIdentity,
): AheadOutcome | null {
  const ahead =
    recorded.migration > latest ||
    (build.release &&
      recorded.version !== undefined &&
      compareVersions(build.version, recorded.version) < 0)
  if (!ahead) return null
  return recorded.version === undefined
    ? { kind: 'ahead', applied: recorded.migration, latest }
    : { kind: 'ahead', applied: recorded.migration, latest, version: recorded.version }
}

/** The fast check found nothing pending. */
export type CurrentStatus = { kind: 'current' }

/** The fast check found something that may be pending; only a full plan can tell. */
export type MaybePendingStatus = { kind: 'maybe-pending' }

export type PendingStatus = NoConfigOutcome | AheadOutcome | CurrentStatus | MaybePendingStatus

/**
 * The cheap pre-command check: one config read and in-memory work only — no
 * migration plans, no comparison of generated files against disk. A
 * migration above the recorded counter that {@link Migration.applies} to the
 * raw config, a managed-output hash that differs from the recorded one, or a
 * pin bump makes the workspace `maybe-pending`; {@link planMigration} then
 * decides whether there really is work (a state-based migration plan can turn
 * out empty). Testing `applies` against the raw config rather than the config
 * each earlier migration leaves cannot miss work: a later migration that only
 * applies after an earlier one runs implies the earlier one applies too.
 *
 * A config the strict parser rejects reads as `current` once no migration
 * applies: nothing `migrate` could do would fix it (its plan would refuse it
 * as `invalid`), and the lenient loader reports the bad fields itself.
 */
export async function checkPendingWork(options: MigrateOptions = {}): Promise<PendingStatus> {
  const resolved = resolveMigrateOptions(options)
  const read = await readRecorded(resolved)
  if (read.kind !== 'recorded') return read
  const { raw, recorded } = read

  const ctx: MigrationContext = { config: raw, baseDir: getBaseDir() }
  const migrationDue = resolved.migrations.some(
    (migration) => migration.id > recorded.migration && migration.applies(ctx),
  )
  if (migrationDue) return { kind: 'maybe-pending' }

  const parsed = parseRitualConfig(withManaged(raw, recorded))
  if (isConfigParseError(parsed)) return { kind: 'current' }
  const due = managedWorkDue(parsed, recorded, resolved)
  return due.refreshDue || due.pinBump !== null ? { kind: 'maybe-pending' } : { kind: 'current' }
}

/** {@link MigrateOptions} with every default filled in; migrations in id order. */
type ResolvedMigrateOptions = Required<MigrateOptions>

function resolveMigrateOptions(options: MigrateOptions): ResolvedMigrateOptions {
  return {
    migrations: [...(options.migrations ?? MIGRATIONS)].sort((a, b) => a.id - b.id),
    skills: options.skills ?? SKILLS,
    build: options.build ?? RUNNING_BUILD,
  }
}

/** The config as read, with the valid parts of its `managed` block. */
type RecordedWorkspace = { kind: 'recorded'; raw: RawConfig; recorded: ManagedConfig }

/** Read the raw config and its recorded `managed` block, unless there is none or it is ahead. */
async function readRecorded(
  options: ResolvedMigrateOptions,
): Promise<NoConfigOutcome | AheadOutcome | RecordedWorkspace> {
  const raw = await readRawRitualConfig()
  if (raw === null) return { kind: 'no-config' }
  const recorded = recordedManaged(raw)
  const ahead = aheadOutcome(recorded, latestMigrationId(options.migrations), options.build)
  return ahead ?? { kind: 'recorded', raw, recorded }
}

/** The managed-output and pin work a parsed config owes, shared by the fast check and the plan. */
type ManagedWorkDue = {
  output: ManagedOutput | null
  /** The output hash differs from the recorded one. */
  refreshDue: boolean
  pinBump: PinBump | null
}

/**
 * The one definition of "managed work is due", so the pre-command check can
 * never call a workspace current that the plan would find work in.
 */
function managedWorkDue(
  parsed: RitualConfig,
  recorded: ManagedConfig,
  options: ResolvedMigrateOptions,
): ManagedWorkDue {
  const output = computeManagedOutput(parsed, options.skills)
  return {
    output,
    refreshDue: output !== null && output.hash !== recorded.output,
    pinBump: planPinBump(getSiteDeployConfig(parsed.site), options.build, recorded.version),
  }
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
  const resolved = resolveMigrateOptions(options)
  const { migrations, skills, build } = resolved
  const read = await readRecorded(resolved)
  if (read.kind !== 'recorded') return read
  const { raw, recorded } = read
  const latest = latestMigrationId(migrations)

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

  const { output, refreshDue, pinBump } = managedWorkDue(parsed, recorded, resolved)
  const refresh = output !== null && refreshDue ? await planManagedRefresh(output, skills) : null
  const managed = output === null ? stamp : { ...stamp, output: output.hash }

  return {
    kind: 'plan',
    raw,
    recorded,
    migrations: pending,
    refresh,
    pinBump,
    managed,
    build,
  }
}

/** The workspace paths a file op replaces or removes, relative to the base dir. */
function overwrittenPaths(op: FileOp): string[] {
  switch (op.type) {
    case 'write':
    case 'delete':
      return [op.path]
    case 'rename':
      return [op.from, op.to]
    default:
      return op satisfies never
  }
}

/**
 * Copy what the plan's migrations are about to change — `ritual.config.json`
 * and every file an op rewrites, removes or moves — into a backup folder,
 * returning it, or null when no migration has ops. The managed refresh is not
 * backed up: it only writes generated files and appends to `.gitignore`.
 */
async function backUpPlannedChanges(plan: MigrationPlan): Promise<string | null> {
  const changing = plan.migrations.filter(({ ops }) => ops.length > 0)
  const last = changing.at(-1)
  if (last === undefined) return null
  const baseDir = getBaseDir()
  const files = changing.flatMap(({ ops }) =>
    ops.filter(isFileOp).flatMap((op) => overwrittenPaths(op).map((p) => path.join(baseDir, p))),
  )
  return backUpFiles([getRitualConfigPath(), ...files], `migration-${last.migration.id}`)
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
      await renameWithRetry(path.join(baseDir, op.from), to)
      return
    }
    default:
      op satisfies never
  }
}

/** What a cache op did to the legacy folder `path` and the cache directory `shared`. */
export type CacheOpResult = LegacyCacheMoveResult & {
  /** The legacy folder, relative to the base dir. */
  path: string
  /** The cache directory it moved to, or that already had data. */
  shared: string
}

async function applyCacheOp(op: CacheOp): Promise<CacheOpResult> {
  switch (op.type) {
    case 'cache-move': {
      const result = await moveLegacyCache(path.join(getBaseDir(), op.from), op.to)
      return { ...result, path: op.from, shared: op.to }
    }
    case 'cache-finish': {
      const result = await finishLegacyCacheMove(path.join(getBaseDir(), op.path), op.shared)
      return { ...result, path: op.path, shared: op.shared }
    }
    case 'cache-keep':
      return { outcome: 'kept', path: op.path, shared: op.shared }
    default:
      return op satisfies never
  }
}

/** What an apply did. */
export type MigrationResult = {
  /** The migrations that changed something, in order. */
  applied: Migration[]
  /** What each cache op did — a planned move turns into `kept` when the target filled meanwhile. */
  cache: CacheOpResult[]
  refresh: ManagedRefreshResult | null
  /** The folder holding copies of what the migrations changed, or null when none ran. */
  backupDir: string | null
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
      {
        file: FILE.config,
        commandName: bareCommandLine(COMMAND.migrate),
        command: commandLine(COMMAND.migrate),
      },
    )
  }

  const skills = options.skills ?? SKILLS
  const backupDir = await backUpPlannedChanges(plan)
  let config = plan.raw
  const applied: Migration[] = []
  const cache: CacheOpResult[] = []
  for (const { migration, ops } of plan.migrations) {
    if (ops.length === 0) continue
    for (const op of ops) {
      if (isFileOp(op)) await applyFileOp(op)
      else if (isCacheOp(op)) cache.push(await applyCacheOp(op))
    }
    config = withManaged(applyConfigOps(config, ops), { ...plan.recorded, migration: migration.id })
    await writeRawRitualConfig(config)
    applied.push(migration)
  }

  const refresh = plan.refresh === null ? null : await applyManagedRefresh(plan.refresh, skills)

  await writeRawRitualConfig(withManaged(config, plan.managed))
  await refreshRitualConfig()
  return { applied, cache, refresh, backupDir }
}
