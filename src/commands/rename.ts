import { Command } from 'commander'
import path from 'node:path'
import { isListLifecycleError, renameList } from '../list/list-lifecycle'
import { type ListType } from '../list/list-type'
import { type ListTypeFlags } from '../list/resolve-list'
import { t } from '../i18n/t'
import {
  addListTypeFlags,
  resolveListSelection,
  resolveListTypeFlag,
  runCommandAction,
} from './card-target'
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
  /** Where the list lives now — the path the text output prints. */
  newFilePath: string
  /** Where it lived before, so a script can follow the move without rebuilding it. */
  oldFilePath: string
}

export function registerRenameCommand(program: Command): void {
  addScriptingOptions(
    addListTypeFlags(
      program
        .command('rename')
        .description(t('help.rename.description'))
        .argument('<list>', t('help.listArg.prefixed'))
        .argument('<newName...>', t('help.rename.newName')),
    ),
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
        t('cli.rename.renamed', {
          type: resolved.type,
          oldName: result.oldName,
          name: newName,
          file: result.newFilePath,
        }),
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
    newFilePath: result.newFilePath,
    oldFilePath: result.oldFilePath,
  }
  emitOutput(payload, scripting)
}
