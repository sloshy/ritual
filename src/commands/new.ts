import { Command } from 'commander'
import { createList, isListLifecycleError } from '../list/list-lifecycle'
import { isListType, type ListType } from '../list/list-type'
import { localizedCommandError, ExitCode } from '../util/errors'
import { t } from '../i18n/t'
import { runCommandAction, lifecycleErrorToCommandError } from '../cli/action'
import { addScriptingOptions } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'

type NewOptions = { format?: string } & Partial<ScriptingOptions>

type NewListResult = {
  type: ListType
  slug: string
  name: string
  filePath: string
}

export function registerNewCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('new')
      .description(t('help.new.description'))
      .argument('<type>', t('help.new.type'))
      .argument('<name...>', t('help.new.name'))
      .option('-f, --format <format>', t('help.new.format')),
    'text',
  ).action(async (rawType: string, nameParts: string[], options: NewOptions) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    await runCommandAction(scripting, () =>
      runNew(rawType, nameParts.join(' ').trim(), options.format, scripting),
    )
  })
}

async function runNew(
  rawType: string,
  name: string,
  format: string | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  if (!isListType(rawType)) {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.new.invalidType', {
      value: rawType,
    })
  }
  if (format !== undefined && rawType !== 'deck') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.new.formatDecksOnly')
  }

  const result = await createList(rawType, name, format)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(t('cli.new.created', { type: rawType, file: result.filePath }), scripting)
    }
    return
  }

  const payload: NewListResult = {
    type: rawType,
    slug: result.slug,
    name,
    filePath: result.filePath,
  }
  emitOutput(payload, scripting)
}
