import { Command } from 'commander'
import path from 'node:path'
import { isListLifecycleError, renameList } from '../list-lifecycle'
import { listTypeLabel, type ListType } from '../list-type'
import { type ListTypeFlags } from '../resolve-list'
import { resolveListSelection, resolveListTypeFlag, runCommandAction } from './card-target'
import { lifecycleErrorToCommandError } from './lifecycle'
import {
  addScriptingOptions,
  emitOutput,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

type RenameOptions = ListTypeFlags & Partial<ScriptingOptions>

type RenameResult = {
  type: ListType
  oldSlug: string
  newSlug: string
  name: string
}

export function registerRenameCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('rename')
      .description('Rename a deck, collection, or wanted list')
      .argument(
        '<list>',
        "Name of the list (optionally prefixed with 'deck:', 'collection:', or 'wanted:')",
      )
      .argument('<newName...>', 'New display name for the list')
      .option('--deck', 'Resolve the name as a deck')
      .option('--collection', 'Resolve the name as a collection')
      .option('--wanted', 'Resolve the name as a wanted list'),
    'text',
  ).action(async (listArg: string, newNameParts: string[], options: RenameOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    const type = resolveListTypeFlag(options, scripting)
    if (type === 'conflict') return
    await runCommandAction(scripting, () =>
      runRename(listArg, newNameParts.join(' ').trim(), type, scripting),
    )
  })
}

async function runRename(
  listArg: string,
  newName: string,
  type: ListType | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  const resolved = await resolveListSelection(listArg, type)
  const oldSlug = path.basename(resolved.filePath, '.md')

  const result = await renameList(resolved.type, resolved.filePath, newName)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(
        `Renamed ${listTypeLabel(resolved.type)} '${result.oldName}' to '${newName}' (${result.newFilePath})`,
        scripting,
      )
    }
    return
  }

  const payload: RenameResult = {
    type: resolved.type,
    oldSlug,
    newSlug: result.newSlug,
    name: newName,
  }
  emitOutput(payload, scripting)
}
