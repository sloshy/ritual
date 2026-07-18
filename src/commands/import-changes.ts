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
  type BundleImportResult,
  applyChangeBundle,
  bundleImportMessage,
} from '../admin/api/import-changes'
import { ask } from './prompts-helpers'
import {
  type ScriptingOptions,
  addScriptingOptions,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
} from './scripting'
import { isNoInput } from '../no-input'
import { STDERR_LOGGER, setLogger } from '../logger'

type ImportChangesOptions = {
  yes?: boolean
} & Partial<ScriptingOptions>

/**
 * The `--output json`/`ndjson` payload: the shared {@link BundleImportResult}
 * plus its summary message — byte-for-byte the body the admin
 * `POST /api/import-changes` route (and therefore the MCP `import_changes`
 * tool) responds with.
 */
type ImportChangesReport = BundleImportResult & { message: string }

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

/** Print per-list applied counts, skipped conflicts, and failures after an apply. */
function printResults(result: BundleImportResult, quiet: boolean): void {
  for (const list of result.lists) {
    const heading = `${LIST_TYPE_DISPLAY[list.kind].icon} ${list.name}`
    if (list.error !== undefined) {
      console.error(`✗ ${heading}: ${list.error}`)
      continue
    }
    if (quiet) continue
    console.log(`✓ ${heading}: applied ${countLabel(list.applied, 'change')}`)
    for (const conflict of list.conflicts) {
      console.log(`  ⚠ Skipped (card not found): ${formatChange(conflict.change)}`)
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
    // The apply path resolves cards through the shared data layer, whose
    // logger writes to stdout; divert it so json/ndjson stdout stays pure.
    if (scripting.output !== 'text') {
      setLogger(STDERR_LOGGER)
    }

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
      // The confirm prompt needs a terminal, enabled prompting, and ownership
      // of stdout (JSON/NDJSON output cannot share it with a prompt); without
      // this guard a piped stdin would silently resolve false or hang.
      const interactive =
        scripting.output === 'text' && !isNoInput() && process.stdin.isTTY === true
      if (!interactive) {
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

    const result = await applyChangeBundle(bundle)
    if (scripting.output === 'text') {
      printResults(result, scripting.quiet)
    } else {
      const report: ImportChangesReport = { ...result, message: bundleImportMessage(result) }
      emitOutput(report, scripting)
    }
    if (!result.success) {
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
