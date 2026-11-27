import { Command } from 'commander'
import type { ListInfo } from '../list/list-identity'
import { listSlug } from '../list/list-file-name'
import { isListLifecycleError, renameList } from '../list/list-lifecycle'
import type { ListType } from '../list/list-type'
import type { ListTypeFlags } from '../list/resolve-list'
import { t } from '../i18n/t'
import { addListTypeFlags, resolveListTypeFlag, addScriptingOptions } from '../cli/options'
import { resolveListSelection } from './card-target'
import { runCommandAction, lifecycleErrorToCommandError } from '../cli/action'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'

type RenameOptions = ListTypeFlags & Partial<ScriptingOptions>

/** The renamed list as it is now (its new slug and title), plus where it came from. */
type RenameResult = ListInfo & {
  oldSlug: string
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
  const oldSlug = listSlug(resolved.filePath)

  const result = await renameList(resolved.type, resolved.filePath, newName)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(
        t('cli.rename.renamed', {
          type: resolved.type,
          oldName: result.oldName,
          name: result.newName,
          file: result.newFilePath,
        }),
        scripting,
      )
    }
    return
  }

  const payload: RenameResult = {
    listType: resolved.type,
    slug: result.newSlug,
    name: result.newName,
    oldSlug,
    newFilePath: result.newFilePath,
    oldFilePath: result.oldFilePath,
  }
  emitOutput(payload, scripting)
}
