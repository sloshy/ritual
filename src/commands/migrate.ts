import { Option, type Command } from 'commander'
import { runCommandAction } from '../cli/action'
import { addDryRunOption, type DryRunOptions } from '../cli/options'
import { TEXT_ONLY } from '../cli/output'
import { ask } from '../cli/prompts'
import { t } from '../i18n/t'
import {
  refreshChangesFiles,
  type ManagedRefreshPlan,
  type ManagedRefreshResult,
} from '../migrate/managed-output'
import {
  applyMigration,
  hasPendingWork,
  planMigration,
  refusalError,
  type MigrationPlan,
  type MigrationResult,
  type PinBump,
} from '../migrate/runner'
import type { MigrationOp } from '../migrate/types'
import { ExitCode } from '../util/errors'
import { requireFlag } from '../util/no-input'
import { printGitignoreRefresh } from './init-site'
import { workspaceRelative } from '../config/base-dir'
import { COMMAND, CONFIG_KEY, FILE, FLAG, commandLine } from '../util/cli-tokens'
import { renderSyncParam } from '../sync/message'

export type MigrateCommandOptions = DryRunOptions & {
  yes?: boolean
  check?: boolean
}

/** One plan line for a migration op. */
function formatOp(op: MigrationOp): string {
  switch (op.type) {
    case 'config-set':
      return t('cli.migrate.opConfigSet', {
        path: op.path.join('.'),
        value: JSON.stringify(op.value),
        file: FILE.config,
      })
    case 'config-delete':
      return t('cli.migrate.opConfigDelete', { path: op.path.join('.'), file: FILE.config })
    case 'write':
      return t('cli.migrate.opWrite', { path: op.path })
    case 'delete':
      return t('cli.migrate.opDelete', { path: op.path })
    case 'rename':
      return t('cli.migrate.opRename', { from: op.from, to: op.to })
    default:
      return op satisfies never
  }
}

function printRefreshPlan(refresh: ManagedRefreshPlan): void {
  console.log(t('cli.migrate.refreshHeading'))
  if (!refreshChangesFiles(refresh)) {
    console.log(t('cli.migrate.refreshRecordOnly'))
    return
  }
  for (const file of refresh.filesToWrite) {
    console.log(t('cli.migrate.opWrite', { path: file.path }))
  }
  if (refresh.gitignoreMissing.length > 0) {
    console.log(
      t('cli.migrate.refreshGitignore', {
        entries: refresh.gitignoreMissing.join(', '),
        file: FILE.gitignore,
      }),
    )
  }
  for (const name of refresh.skillsToWrite) {
    console.log(t('cli.migrate.refreshSkill', { name }))
  }
  for (const name of refresh.skillsToRemove) {
    console.log(t('cli.migrate.refreshRemoveSkill', { name }))
  }
}

/** Print every change the plan makes: migrations that still have ops, then the refresh. */
export function printPlan(plan: MigrationPlan): void {
  console.log(t('cli.migrate.planHeading'))
  for (const { migration, ops } of plan.migrations) {
    if (ops.length === 0) continue
    console.log(
      t('cli.migrate.migrationHeading', {
        id: migration.id,
        description: renderSyncParam(migration.description),
      }),
    )
    for (const op of ops) console.log(formatOp(op))
  }
  if (plan.refresh !== null) printRefreshPlan(plan.refresh)
  if (plan.pinBump !== null) console.log(formatPinBump(plan.pinBump))
}

/** The plan line for a pin bump. */
function formatPinBump(pinBump: PinBump): string {
  return pinBump.from === undefined
    ? t('cli.migrate.pinBumpNew', { version: pinBump.to })
    : t('cli.migrate.pinBump', { version: pinBump.to, previous: pinBump.from })
}

function printRefreshResult(refresh: ManagedRefreshResult): void {
  for (const file of refresh.filesWritten) console.log(t('cli.migrate.wrote', { path: file }))
  printGitignoreRefresh(refresh.gitignore, { reportUnchanged: false })
  for (const name of refresh.skillsWritten) console.log(t('cli.migrate.skillUpdated', { name }))
  for (const name of refresh.skillsRemoved) console.log(t('cli.migrate.skillRemoved', { name }))
}

function printResult(plan: MigrationPlan, result: MigrationResult): void {
  for (const migration of result.applied) {
    console.log(
      t('cli.migrate.applied', {
        id: migration.id,
        description: renderSyncParam(migration.description),
      }),
    )
  }
  if (result.backupDir !== null) {
    console.log(t('cli.migrate.backedUp', { path: workspaceRelative(result.backupDir) }))
  }
  if (result.refresh !== null) printRefreshResult(result.refresh)
  if (plan.pinBump !== null) console.log(t('cli.migrate.pinned', { version: plan.pinBump.to }))
  console.log(t('cli.migrate.done'))
  // Only a release build records itself as `managed.version`, so a dev build
  // that changed the workspace's shape leaves the pin behind those changes.
  if (!plan.build.release && result.applied.length > 0) {
    const pinned = plan.managed.version
    const version = plan.build.version
    console.warn(
      pinned === undefined
        ? t('cli.migrate.devBuildNoPin', {
            version,
            configKey: CONFIG_KEY.managedVersion,
            command: commandLine(COMMAND.migrate),
          })
        : t('cli.migrate.devBuild', {
            version,
            pinned,
            configKey: CONFIG_KEY.managedVersion,
            command: commandLine(COMMAND.migrate),
          }),
    )
  }
}

/**
 * Apply a confirmed plan and report what it did — the one apply path, shared by
 * `ritual migrate` and the pre-command offer (`./migrate-check.ts`).
 */
export async function applyAndReport(plan: MigrationPlan): Promise<void> {
  printResult(plan, await applyMigration(plan))
}

async function runMigrate(options: MigrateCommandOptions): Promise<void> {
  const outcome = await planMigration()
  if (outcome.kind === 'no-config') {
    if (!options.check) console.log(t('cli.migrate.noConfig', { file: FILE.config }))
    return
  }
  if (outcome.kind === 'ahead' || outcome.kind === 'invalid') throw refusalError(outcome)
  const plan = outcome

  if (!hasPendingWork(plan)) {
    if (!options.check) console.log(t('cli.migrate.upToDate'))
    return
  }

  if (options.check) {
    console.log(t('cli.migrate.pending', { command: commandLine(COMMAND.migrate) }))
    process.exitCode = ExitCode.UpdatesPending
    return
  }

  printPlan(plan)

  if (options.dryRun) {
    console.log(t('cli.migrate.dryRunDone'))
    return
  }

  if (!options.yes) {
    requireFlag(FLAG.yes)
    const confirmed = await ask<boolean>({
      type: 'confirm',
      message: t('cli.migrate.confirm'),
      initial: true,
    })
    if (confirmed !== true) {
      console.error(t('cli.migrate.cancelled'))
      process.exitCode = ExitCode.UsageError
      return
    }
  }

  await applyAndReport(plan)
}

export function registerMigrateCommand(program: Command): void {
  addDryRunOption(
    program
      .command('migrate')
      .description(t('help.migrate.description'))
      .option('-y, --yes', t('help.migrate.yes'))
      .addOption(new Option('--check', t('help.migrate.check')).conflicts(['yes', 'dryRun'])),
    t('help.migrate.dryRun'),
  ).action(async (options: MigrateCommandOptions) => {
    await runCommandAction(TEXT_ONLY, () => runMigrate(options))
  })
}
