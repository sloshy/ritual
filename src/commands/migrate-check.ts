/**
 * The pending-work check the root preAction hook runs before every command:
 * when the workspace has updates `ritual migrate` would apply, offer to apply
 * them now — at most once a day per workspace — or print one stderr line
 * pointing at `ritual migrate`. A workspace a newer Ritual updated gets a
 * one-line warning.
 *
 * Advisory only. Nothing here changes the exit code or stops the command: a
 * development build can stamp a migration counter the pinned CI release does
 * not know, and that release must still build the site.
 */

import path from 'node:path'
import type { Command } from 'commander'
import { isCommandOrSubcommand, qualifiedCommandName } from '../cli/command-name'
import {
  canPromptWithOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { ask } from '../cli/prompts'
import type { DryRunOptions } from '../cli/options'
import { getBaseDir } from '../config/base-dir'
import { isConfigParseError, parseRitualConfig } from '../config/ritual-config'
import { version as ritualVersion } from '../config/version'
import { t } from '../i18n/t'
import { isMigratePromptSnoozed, recordMigratePrompt } from '../migrate/prompt-snooze'
import {
  checkPendingWork,
  hasPendingWork,
  planMigration,
  aheadRemedyCommand,
  type AheadOutcome,
  type MigrationPlan,
  type PlanOutcome,
} from '../migrate/runner'
import { getErrorMessage } from '../util/errors'
import { isCiEnvironment } from '../util/no-input'
import { readUserState, writeUserStateSection } from '../util/user-state'
import { applyAndReport, printPlan } from './migrate'
import { COMMAND, FILE, FLAG, commandLine } from '../util/cli-tokens'

/**
 * Commands that never run the check, matched by qualified name (`config` also
 * covers `config set`, `config list`, …):
 *
 * - `migrate` is the remedy itself; `self-update` replaces the binary and
 *   previews the new release's own plan afterwards; `init-site` sets the workspace up and
 *   refuses a stale one on its own; `config` must stay usable to repair the
 *   file the check reads; `help` only prints.
 * - `mcp` speaks JSON-RPC on stdout and its stdin is the client, not a person.
 * - `detect-changes` must see the workspace exactly as the user committed it,
 *   and its `--verify` mode must write nothing at all.
 *
 * The root hook in `src/cli/program.ts` separately skips the config load for
 * `migrate`; keep the two in step.
 */
export const MIGRATION_CHECK_EXEMPT = [
  'migrate',
  'self-update',
  'init-site',
  'config',
  'help',
  'mcp',
  'detect-changes',
] as const

/** Whether the check skips this invocation — see {@link MIGRATION_CHECK_EXEMPT}. */
export function isMigrationCheckExempt(actionCommand: Command): boolean {
  return isCommandOrSubcommand(qualifiedCommandName(actionCommand), MIGRATION_CHECK_EXEMPT)
}

/** `--yes` already answered every question the command will ask. */
type YesOption = { yes?: boolean }

/** The action command's options the offer's gate reads. */
type OfferGateOptions = DryRunOptions & YesOption & Partial<ScriptingOptions>

/**
 * Whether this run may stop to ask: prompts are possible (a terminal on stdin,
 * no `--no-input`), stdout is a terminal too, the command speaks plain text
 * (`--output json|ndjson|csv` owns stdout), it is not a dry run (which promises
 * to write nothing), `--yes` did not promise an unattended run, and it is not
 * running under CI.
 */
function mayOfferMigration(actionCommand: Command): boolean {
  // `scry`/`sell` also accept `--output csv`; it is not `text`, so it gates
  // like JSON does even though ScriptingOptions does not name it.
  const options = actionCommand.opts<OfferGateOptions>()
  return (
    canPromptWithOutput(normalizeScriptingOptions(options)) &&
    options.dryRun !== true &&
    options.yes !== true &&
    process.stdout.isTTY === true &&
    !isCiEnvironment()
  )
}

/** The one-line warning for a workspace a newer Ritual updated. */
function warnAhead(outcome: AheadOutcome): void {
  console.warn(
    outcome.version === undefined
      ? t('cli.migrate.notice.aheadNoVersion', {
          applied: outcome.applied,
          latest: outcome.latest,
          command: aheadRemedyCommand(outcome),
        })
      : t('cli.migrate.notice.ahead', {
          version: outcome.version,
          current: ritualVersion,
          command: aheadRemedyCommand(outcome),
        }),
  )
}

/**
 * The one-line pending notice. When the config as it stands fails strict
 * validation but the migrated one passes (the plan exists), the config load's
 * warnings that follow are the migrations' to fix, and the notice says so.
 */
function printPendingNotice(plan: MigrationPlan | null): void {
  const loadWillWarn = plan !== null && isConfigParseError(parseRitualConfig(plan.raw))
  console.warn(
    t(loadWillWarn ? 'cli.migrate.notice.pendingConfig' : 'cli.migrate.notice.pending', {
      file: FILE.config,
      migrateDryRunCommand: commandLine(COMMAND.migrate, FLAG.dryRun),
      migrateCommand: commandLine(COMMAND.migrate),
    }),
  )
}

/**
 * Ask whether to migrate now — unless Ritual already asked about this
 * workspace today, in which case only the notice is printed. Yes applies the
 * plan through the same path as `ritual migrate --yes`; anything else leaves
 * the workspace as it is.
 */
async function offerMigration(plan: MigrationPlan): Promise<void> {
  const baseDir = path.resolve(getBaseDir())
  const now = Date.now()
  const { migratePrompts } = await readUserState()
  if (isMigratePromptSnoozed(migratePrompts, baseDir, now)) {
    printPendingNotice(plan)
    return
  }
  await writeUserStateSection('migratePrompts', recordMigratePrompt(migratePrompts, baseDir, now))

  printPlan(plan)
  const confirmed = await ask<boolean>({
    type: 'confirm',
    message: t('cli.migrate.offer', { command: commandLine(COMMAND.migrate) }),
    initial: true,
  })
  if (confirmed === true) {
    // A failed apply is reported as `ritual migrate` would report it, but the
    // offer stays advisory: the command the user asked for still runs (a
    // part-way failure resumes on the next `ritual migrate`).
    try {
      await applyAndReport(plan)
    } catch (error) {
      console.error(getErrorMessage(error))
    }
  } else {
    console.warn(t('cli.migrate.offerDeclined', { command: commandLine(COMMAND.migrate) }))
  }
}

/**
 * The preAction check. Runs before the config load, against the raw file:
 * the strict loader would warn about the very keys a migration exists to
 * change. Failing to read or plan is never this check's error to report — the
 * config load right after it reports an unreadable file itself.
 */
export async function checkWorkspaceMigrations(actionCommand: Command): Promise<void> {
  if (isMigrationCheckExempt(actionCommand)) return

  let outcome: PlanOutcome
  try {
    const status = await checkPendingWork()
    if (status.kind === 'ahead') {
      warnAhead(status)
      return
    }
    if (status.kind !== 'maybe-pending') return
    outcome = await planMigration()
  } catch {
    return
  }

  if (outcome.kind === 'ahead') {
    warnAhead(outcome)
    return
  }
  if (outcome.kind === 'invalid') {
    // Nothing can be applied, but `ritual migrate` explains why.
    printPendingNotice(null)
    return
  }
  if (outcome.kind === 'no-config' || !hasPendingWork(outcome)) return

  if (mayOfferMigration(actionCommand)) {
    await offerMigration(outcome)
  } else {
    printPendingNotice(outcome)
  }
}
