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
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type DeleteOptions = ListTypeFlags & { confirm?: string } & Partial<ScriptingOptions>

type DeleteResult = {
  type: ListType
  slug: string
  deleted: true
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

async function runDelete(
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
    confirmed = await promptConfirmName()
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

  const payload: DeleteResult = { type: resolved.type, slug, deleted: true }
  emitOutput(payload, scripting)
}

async function promptConfirmName(): Promise<string> {
  let exited = false
  const resp = await prompts({
    type: 'text',
    name: 'value',
    message: 'Type the list name to confirm:',
    onState: (state: PromptState) => {
      if (state.exited) exited = true
    },
  })
  if (exited || typeof resp.value !== 'string') {
    throw new CardCommandError('usage_error', 'Cancelled.', ExitCode.UsageError)
  }
  return resp.value
}
