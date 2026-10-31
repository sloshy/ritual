import { Command } from 'commander'
import { createList, isListLifecycleError } from '../list/list-lifecycle'
import type { ListType } from '../list/list-type'
import { parseListTypeArg } from '../list/list-type-arg'
import { isMessageParseError } from '../sync/message'
import { localizedCommandError, messageCommandError, ExitCode } from '../util/errors'
import { t } from '../i18n/t'
import { runCommandAction, lifecycleErrorToCommandError } from '../cli/action'
import { addScriptingOptions } from '../cli/options'
import { emitOutput, normalizeScriptingOptions, type ScriptingOptions } from '../cli/output'
import { FLAG } from '../util/cli-tokens'

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
  const type = parseListTypeArg(rawType)
  if (isMessageParseError(type)) {
    throw messageCommandError('usage_error', ExitCode.UsageError, type.error)
  }
  if (format !== undefined && type !== 'deck') {
    throw localizedCommandError('usage_error', ExitCode.UsageError, 'cli.new.formatDecksOnly', {
      flag: FLAG.format,
    })
  }

  const result = await createList(type, name, format)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(t('cli.new.created', { type, file: result.filePath }), scripting)
    }
    return
  }

  const payload: NewListResult = {
    type,
    slug: result.slug,
    name,
    filePath: result.filePath,
  }
  emitOutput(payload, scripting)
}
