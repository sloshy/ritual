import { Command } from 'commander'
import fs from 'node:fs/promises'
import { formatChange } from '../change-event'
import { LIST_TYPE_DISPLAY, listTypeLabel } from '../list-type'
import {
  type ChangeBundle,
  type ChangeBundleList,
  bundleChangeCount,
  countLabel,
  parseChangeBundle,
} from '../editor/change-bundle'
import {
  type BundleImportResponse,
  type BundleImportResult,
  applyChangeBundle,
  bundleImportMessage,
} from '../admin/api/import-changes'
import type { ImportConflict } from '../editor/import-changes'
import { suppressAutoCommit } from '../admin/git'
import { ask } from './prompts-helpers'
import {
  canPromptWithOutput,
  type ScriptingOptions,
  addScriptingOptions,
  installScriptingLogger,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'

type ImportChangesOptions = {
  yes?: boolean
} & Partial<ScriptingOptions>

/**
 * The `--output json`/`ndjson` payload: byte-for-byte the body the admin
 * `POST /api/import-changes` route responds with, `success: true` envelope
 * included. The MCP `import_change_bundle` tool returns the same fields minus
 * that constant key, which the MCP layer strips from every result. A partial
 * import is still a success on all three surfaces — `failedCount`, and each
 * list's own `error`, are what report the failures; the CLI additionally exits
 * non-zero.
 */
type ImportChangesReport = BundleImportResponse

function listHeading(list: ChangeBundleList): string {
  return `${LIST_TYPE_DISPLAY[list.kind].icon} ${list.name} (${listTypeLabel(list.kind)} '${list.slug}')`
}

/** Print the full change list grouped by target list, for pre-apply review. */
function printPreview(bundle: ChangeBundle): void {
  for (const list of bundle.lists) {
    console.log(`\n${listHeading(list)} — ${countLabel(list.changes.length, 'change')}`)
    for (const change of list.changes) {
      console.log(`  • ${formatChange(change)}`)
    }
  }
  console.log('')
}

/** Why a change was skipped, in the wording the CLI prints. */
const CONFLICT_REASON_LABEL: Record<ImportConflict['reason'], string> = {
  'target-not-found': 'card not found',
  'not-applicable': 'not applicable to this list',
}

/**
 * The per-reason breakdown for a list's skipped changes — `card not found: 2,
 * not applicable to this list: 1` — so a summary never claims a reason the
 * engine did not report.
 */
function summarizeConflictReasons(conflicts: readonly ImportConflict[]): string {
  const counts = new Map<ImportConflict['reason'], number>()
  for (const conflict of conflicts) {
    counts.set(conflict.reason, (counts.get(conflict.reason) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([reason, count]) => `${CONFLICT_REASON_LABEL[reason]}: ${count}`)
    .join(', ')
}

/** Print per-list applied counts, skipped conflicts, and failures after an apply. */
function printResults(result: BundleImportResult, quiet: boolean): void {
  for (const list of result.lists) {
    const heading = `${LIST_TYPE_DISPLAY[list.kind].icon} ${list.name}`
    if (list.error !== undefined) {
      console.error(`✗ ${heading}: ${list.error}`)
      continue
    }
    // Skipped changes are the one thing `--quiet` must never hide: nothing else
    // reports them and they do not affect the exit code, so a silent run would
    // look like a clean apply. The applied count is chatter; this is data loss.
    if (quiet) {
      if (list.conflicts.length > 0) {
        console.error(
          `⚠ ${heading}: ${countLabel(list.conflicts.length, 'change')} skipped (${summarizeConflictReasons(list.conflicts)})`,
        )
      }
      continue
    }
    console.log(`✓ ${heading}: applied ${countLabel(list.applied, 'change')}`)
    for (const conflict of list.conflicts) {
      console.error(
        `  ⚠ Skipped (${CONFLICT_REASON_LABEL[conflict.reason]}): ${formatChange(conflict.change)}`,
      )
    }
  }
}

export function registerImportChangesCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('import-changes')
      .description('Apply a change bundle exported from the site editor to your lists')
      .argument('<file>', 'Path to the exported change-bundle JSON (one or more lists)')
      .option('-y, --yes', 'Apply without asking for confirmation', false),
  ).action(async (file: string, options: ImportChangesOptions) => {
    const scripting = normalizeScriptingOptions(options)
    // The apply path resolves cards through the shared data layer, whose logger
    // writes to stdout; divert it so json/ndjson stdout stays pure, and drop it
    // entirely under `--quiet`.
    installScriptingLogger(scripting)

    let text: string
    try {
      text = await fs.readFile(file, 'utf-8')
    } catch (error) {
      const failure = classifyFileReadError(error)
      emitError(
        failure.errorCode,
        `Cannot read '${file}': ${error instanceof Error ? error.message : error}`,
        scripting,
      )
      process.exitCode = failure.exitCode
      return
    }

    const bundle = parseChangeBundle(text)
    if (typeof bundle === 'string') {
      emitError('usage_error', `Invalid change bundle: ${bundle}`, scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    const total = bundleChangeCount(bundle)
    if (total === 0) {
      emitError('not_found', 'The file contains no changes to apply.', scripting)
      process.exitCode = ExitCode.NotFound
      return
    }

    if (scripting.output === 'text' && !scripting.quiet) {
      printPreview(bundle)
    }

    if (!options.yes) {
      // Without this guard a piped stdin would silently resolve false or hang.
      if (!canPromptWithOutput(scripting)) {
        emitError(
          'usage_error',
          'Confirmation required: pass --yes to apply changes non-interactively.',
          scripting,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      const confirmed = await ask<boolean>({
        type: 'confirm',
        message: `Apply ${countLabel(total, 'change')} to ${countLabel(bundle.lists.length, 'list')}?`,
        initial: false,
      })
      if (!confirmed) {
        emitError('usage_error', 'Cancelled.', scripting)
        process.exitCode = ExitCode.UsageError
        return
      }
    }

    // The apply replays the bundle through the admin save handlers in-process,
    // whose git auto-commit is governed by the admin.git* keys. Those keys
    // cover the admin surfaces (web UI + MCP) only — CLI commands never
    // auto-commit — so the handlers run with auto-commit suppressed here.
    const result = await suppressAutoCommit(() => applyChangeBundle(bundle))
    if (scripting.output === 'text') {
      printResults(result, scripting.quiet)
    } else {
      const report: ImportChangesReport = {
        success: true,
        ...result,
        message: bundleImportMessage(result),
      }
      emitOutput(report, scripting)
    }
    if (result.failedCount > 0) {
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
