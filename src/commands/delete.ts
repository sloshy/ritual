import { Command } from 'commander'
import path from 'node:path'
import {
  deleteList,
  isListLifecycleError,
  listDisplayName,
  requireDeleteConfirmation,
} from '../list/list-lifecycle'
import { type ListType } from '../list/list-type'
import { type ListTypeFlags } from '../list/resolve-list'
import { CardCommandError, ExitCode } from '../util/errors'
import { t } from '../i18n/t'
import { addListTypeFlags, resolveListSelection, resolveListTypeFlag } from './card-target'
import { cancelledError, runCommandAction, lifecycleErrorToCommandError } from '../cli/action'
import { requireInteractive } from '../util/no-input'
import { ask } from '../cli/prompts'
import { addScriptingOptions } from '../cli/options'
import {
  emitOutput,
  emitWarnings,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'

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
    addListTypeFlags(
      program
        .command('delete')
        .description(t('help.delete.description'))
        .argument('<list>', t('help.listArg.prefixed')),
    ).option('--confirm <name>', t('help.delete.confirm')),
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
      emitOutput(t('cli.delete.deleted', { type: resolved.type, name: displayName }), scripting)
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
    notice: t('cli.delete.notice', { type, name: displayName, file: filePath }),
    prompt: t('cli.delete.promptConfirm', { name: displayName }),
  }
}

/** Prompt for the typed confirmation, naming the exact string that will pass. */
async function promptConfirmName(message: string): Promise<string> {
  const value = await ask<string>({
    type: 'text',
    message,
  })
  if (typeof value !== 'string') throw cancelledError()
  return value
}
