import { Command } from 'commander'
import path from 'node:path'
import prompts from 'prompts'
import {
  deleteList,
  isListLifecycleError,
  listDisplayName,
  requireDeleteConfirmation,
} from '../list-lifecycle'
import { listTypeLabel, type ListType } from '../list-type'
import { type ListTypeFlags } from '../resolve-list'
import { CardCommandError } from '../errors'
import { resolveListSelection, resolveListTypeFlag, runCommandAction } from './card-target'
import { requireInteractive } from '../no-input'
import { lifecycleErrorToCommandError } from './lifecycle'
import type { PromptState } from './prompts-types'
import {
  addScriptingOptions,
  emitOutput,
  emitWarnings,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type DeleteOptions = ListTypeFlags & { confirm?: string } & Partial<ScriptingOptions>

type DeleteResult = {
  type: ListType
  slug: string
  deleted: true
  /** Every file removed: the list plus whichever sidecars it had. */
  deletedFiles: string[]
}

export function registerDeleteCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('delete')
      .description('Delete a deck, collection, or wanted list and its sidecar files')
      .argument(
        '<list>',
        "Name of the list (optionally prefixed with 'deck:', 'collection:', or 'wanted:')",
      )
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list')
      .option('--confirm <name>', "The list's display name, confirming the deletion"),
    'text',
  ).action(async (listArg: string, options: DeleteOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const type = resolveListTypeFlag(options, scripting)
    if (type === 'conflict') return
    await runCommandAction(scripting, () => runDelete(listArg, type, options.confirm, scripting))
  })
}

/**
 * The command body, exported so the interactive confirmation — the notice on
 * stderr and the prompt string — can be exercised without a real terminal.
 */
export async function runDelete(
  listArg: string,
  type: ListType | undefined,
  confirm: string | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  const resolved = await resolveListSelection(listArg, type)
  const slug = path.basename(resolved.filePath, '.md')
  const displayName = await listDisplayName(resolved.type, resolved.filePath)

  let confirmed = confirm
  if (confirmed === undefined) {
    // Deletion is destructive: without a terminal, --confirm is mandatory.
    requireInteractive('--confirm "<list name>"')
    // <list> resolves by substring and by folded name, so what the user typed
    // need not be what they are about to destroy. Name the resolved target
    // *before* asking — a mismatch error after the fact is too late to be
    // useful, and the expected string (the display name) can differ from both
    // the argument and the file name.
    const text = deleteConfirmationText(resolved.type, displayName, resolved.filePath)
    emitWarnings([text.notice], scripting, { essential: true })
    confirmed = await promptConfirmName(text.prompt)
  }

  const mismatch = requireDeleteConfirmation(confirmed, displayName)
  if (mismatch) {
    throw new CardCommandError('usage_error', mismatch, ExitCode.UsageError)
  }

  const result = await deleteList(resolved.type, resolved.filePath)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(`Deleted ${listTypeLabel(resolved.type)} '${displayName}'`, scripting)
    }
    return
  }

  const payload: DeleteResult = {
    type: resolved.type,
    slug,
    deleted: true,
    deletedFiles: result.deletedFiles,
  }
  emitOutput(payload, scripting)
}

/** What the interactive confirmation says before and while it asks. */
export type DeleteConfirmationText = { notice: string; prompt: string }

/**
 * The two lines of the interactive confirmation. Both name concrete things the
 * user could otherwise only learn by failing: `<list>` resolves by substring and
 * by folded name, so the resolved target is not necessarily what was typed, and
 * the string that passes is the **display name**, which can differ from both the
 * argument and the file name.
 */
export function deleteConfirmationText(
  type: ListType,
  displayName: string,
  filePath: string,
): DeleteConfirmationText {
  return {
    notice: `About to delete ${listTypeLabel(type).toLowerCase()} '${displayName}' (${filePath}) and its sidecar files.`,
    prompt: `Type '${displayName}' to confirm:`,
  }
}

/** Prompt for the typed confirmation, naming the exact string that will pass. */
async function promptConfirmName(message: string): Promise<string> {
  let exited = false
  const resp = await prompts({
    type: 'text',
    name: 'value',
    message,
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.value !== 'string') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  return resp.value
}
