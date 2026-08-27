import { Command } from 'commander'
import fs from 'node:fs/promises'
import { formatChange } from '../changes/change-message'
import { listRefLabel } from '../changes/change-event'
import { t } from '../i18n/t'
import { LIST_TYPE_DISPLAY, listTypeLabel } from '../list/list-type'
import {
  type ChangeBundle,
  type ChangeBundleList,
  bundleChangeCount,
  bundleListCount,
  moveFromEventOf,
  replacementAddEventOf,
  parseChangeBundle,
} from '../changes/change-bundle'
import {
  type BundleImportResponse,
  type BundleImportResult,
  applyChangeBundle,
  bundleImportMessage,
} from '../admin/api/import-changes'
import { IMPORT_CONFLICT_REASON_KEY, type ImportConflict } from '../editor/import-changes'
import { suppressAutoCommit } from '../admin/git'
import { ask } from '../cli/prompts'
import {
  canPromptWithOutput,
  type ScriptingOptions,
  installScriptingLogger,
  classifyFileReadError,
  emitOutput,
  normalizeScriptingOptions,
} from '../cli/output'
import { fail } from '../cli/action'
import { addScriptingOptions } from '../cli/options'
import { ExitCode } from '../util/errors'

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
  return `${LIST_TYPE_DISPLAY[list.kind].icon} ${t('cli.importChanges.listHeading', {
    name: list.name,
    type: listTypeLabel(list.kind),
    slug: list.slug,
  })}`
}

/**
 * Print the full change list grouped by target list, then the cross-list moves
 * (each a physical copy leaving one list for another — the bundle records them
 * once, apart from either list's own changes), for pre-apply review.
 */
function printPreview(bundle: ChangeBundle): void {
  for (const list of bundle.lists) {
    console.log(
      `\n${t('cli.importChanges.previewHeading', {
        heading: listHeading(list),
        changes: t('domain.count.changes', { count: list.changes.length }),
      })}`,
    )
    for (const change of list.changes) {
      console.log(`  • ${formatChange(change)}`)
    }
  }
  if (bundle.moves.length > 0) {
    console.log(
      `\n${t('cli.importChanges.movesHeading', {
        moves: t('domain.count.moves', { count: bundle.moves.length }),
      })}`,
    )
    for (const move of bundle.moves) {
      // The outgoing half names the destination; the source is added beside it.
      const from = moveFromEventOf(move)
      console.log(
        `  • ${t('cli.importChanges.moveLine', {
          change: formatChange(from),
          from: listRefLabel({ type: move.from.kind, name: move.from.name }),
        })}`,
      )
      // The printing the source gets back for the copy, when the move carries one.
      const replacement = replacementAddEventOf(move)
      if (replacement) {
        console.log(
          `    ↩ ${t('cli.importChanges.replacementLine', {
            change: formatChange(replacement),
            list: listRefLabel({ type: move.from.kind, name: move.from.name }),
          })}`,
        )
      }
    }
  }
  console.log('')
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
    .map(([reason, count]) => `${t(IMPORT_CONFLICT_REASON_KEY[reason])}: ${count}`)
    .join(', ')
}

/** Print per-list applied counts, skipped conflicts, and failures after an apply. */
function printResults(result: BundleImportResult, quiet: boolean): void {
  for (const list of result.lists) {
    const heading = `${LIST_TYPE_DISPLAY[list.kind].icon} ${list.name}`
    if (list.error !== undefined) {
      console.error(`✗ ${t('cli.importChanges.listFailed', { heading, reason: list.error })}`)
      continue
    }
    // Skipped changes are the one thing `--quiet` must never hide: nothing else
    // reports them and they do not affect the exit code, so a silent run would
    // look like a clean apply. The applied count is chatter; this is data loss.
    if (quiet) {
      if (list.conflicts.length > 0) {
        console.error(
          `⚠ ${t('cli.importChanges.listSkipped', {
            heading,
            changes: t('domain.count.changes', { count: list.conflicts.length }),
            reasons: summarizeConflictReasons(list.conflicts),
          })}`,
        )
      }
      continue
    }
    console.log(
      `✓ ${t('cli.importChanges.listApplied', {
        heading,
        changes: t('domain.count.changes', { count: list.applied }),
      })}`,
    )
    for (const conflict of list.conflicts) {
      console.error(
        `  ⚠ ${t('cli.importChanges.skippedChange', {
          reason: t(IMPORT_CONFLICT_REASON_KEY[conflict.reason]),
          change: formatChange(conflict.change),
        })}`,
      )
    }
  }
}

export function registerImportChangesCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('import-changes')
      .description(t('help.importChanges.description'))
      .argument('<file>', t('help.importChanges.file'))
      .option('-y, --yes', t('help.importChanges.yes'), false),
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
      fail(scripting, classifyFileReadError(error).errorCode, 'cli.importChanges.unreadable', {
        file,
        reason: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const bundle = parseChangeBundle(text)
    if (typeof bundle === 'string') {
      fail(scripting, 'usage_error', 'cli.importChanges.invalidBundle', {
        reason: bundle,
      })
      return
    }

    const total = bundleChangeCount(bundle)
    if (total === 0) {
      fail(scripting, 'not_found', 'cli.importChanges.empty')
      return
    }

    if (scripting.output === 'text' && !scripting.quiet) {
      printPreview(bundle)
    }

    if (!options.yes) {
      // Without this guard a piped stdin would silently resolve false or hang.
      if (!canPromptWithOutput(scripting)) {
        fail(scripting, 'usage_error', 'cli.importChanges.confirmationRequired')
        return
      }
      const confirmed = await ask<boolean>({
        type: 'confirm',
        message: t('cli.importChanges.confirmApply', {
          changes: t('domain.count.changes', { count: total }),
          lists: t('domain.count.lists', { count: bundleListCount(bundle) }),
        }),
        initial: false,
      })
      if (!confirmed) {
        fail(scripting, 'usage_error', 'cli.import.cancelled')
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
