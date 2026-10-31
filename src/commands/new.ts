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
    const typed = joinTwoWordType(rawType, nameParts)
    await runCommandAction(scripting, () =>
      runNew(typed.rawType, typed.nameParts.join(' ').trim(), options.format, scripting),
    )
  })
}

/** The `<type>` argument and the name words, after {@link joinTwoWordType}. */
type TypedNameArgs = { rawType: string; nameParts: string[] }

/**
 * `ritual new wanted list Grails` types the two-word type unquoted, so the
 * shell hands `list` over as the name's first word. A bare `list`/`lists` word
 * after `wanted`, followed by more name, is read back into the type: no one
 * names a wanted list "list Grails" on purpose, and a quoted name (`"List of
 * Grails"`) arrives as one word and is never split.
 */
export function joinTwoWordType(rawType: string, nameParts: readonly string[]): TypedNameArgs {
  const [first, ...rest] = nameParts
  if (
    rawType.toLowerCase() === 'wanted' &&
    first !== undefined &&
    /^lists?$/i.test(first) &&
    rest.length > 0
  ) {
    return { rawType: `${rawType} ${first}`, nameParts: rest }
  }
  return { rawType, nameParts: [...nameParts] }
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
