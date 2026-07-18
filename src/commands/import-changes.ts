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
import { type BundleImportResult, applyChangeBundle } from '../admin/api/import-changes'
import { ask } from './prompts-helpers'
import { classifyFileReadError, ExitCode } from './scripting'
import { isNoInput } from '../no-input'

type ImportChangesOptions = {
  yes?: boolean
}

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
function printResults(result: BundleImportResult): void {
  for (const list of result.lists) {
    const heading = `${LIST_TYPE_DISPLAY[list.kind].icon} ${list.name}`
    if (list.error !== undefined) {
      console.error(`✗ ${heading}: ${list.error}`)
      continue
    }
    console.log(`✓ ${heading}: applied ${countLabel(list.applied, 'change')}`)
    for (const conflict of list.conflicts) {
      console.log(`  ⚠ Skipped (card not found): ${formatChange(conflict.change)}`)
    }
  }
}

export function registerImportChangesCommand(program: Command): void {
  program
    .command('import-changes')
    .description('Apply a change bundle exported from the site editor to your lists')
    .argument('<file>', 'Path to the exported change-bundle JSON (one or more lists)')
    .option('-y, --yes', 'Apply without asking for confirmation', false)
    .action(async (file: string, options: ImportChangesOptions) => {
      let text: string
      try {
        text = await fs.readFile(file, 'utf-8')
      } catch (error) {
        console.error(`Cannot read '${file}': ${error instanceof Error ? error.message : error}`)
        process.exitCode = classifyFileReadError(error).exitCode
        return
      }

      const bundle = parseChangeBundle(text)
      if (typeof bundle === 'string') {
        console.error(`Invalid change bundle: ${bundle}`)
        process.exitCode = ExitCode.UsageError
        return
      }

      const total = bundleChangeCount(bundle)
      if (total === 0) {
        console.error('The file contains no changes to apply.')
        process.exitCode = ExitCode.NotFound
        return
      }

      printPreview(bundle)

      if (!options.yes) {
        // The confirm prompt cannot be answered without a terminal (and is
        // disabled outright under --no-input); without this guard a piped
        // stdin would silently resolve false or hang.
        if (isNoInput() || !process.stdin.isTTY) {
          console.error('Confirmation required: pass --yes to apply changes non-interactively.')
          process.exitCode = ExitCode.UsageError
          return
        }
        const confirmed = await ask<boolean>({
          type: 'confirm',
          message: `Apply ${countLabel(total, 'change')} to ${countLabel(bundle.lists.length, 'list')}?`,
          initial: false,
        })
        if (!confirmed) {
          console.error('Cancelled.')
          process.exitCode = ExitCode.UsageError
          return
        }
      }

      const result = await applyChangeBundle(bundle)
      printResults(result)
      if (!result.success) {
        process.exitCode = ExitCode.RuntimeError
      }
    })
}
