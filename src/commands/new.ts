import { Command } from 'commander'
import { createList, isListLifecycleError } from '../list-lifecycle'
import { isListType, listTypeLabel, type ListType } from '../list-type'
import { CardCommandError } from '../errors'
import { runCommandAction } from './card-target'
import { lifecycleErrorToCommandError } from './lifecycle'
import {
  addScriptingOptions,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

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
      .description('Create a new deck, collection, or wanted list')
      .argument('<type>', "List type: 'deck', 'collection', or 'wanted'")
      .argument('<name...>', 'Name of the list')
      .option('-f, --format <format>', 'Deck format (decks only; e.g., standard, commander)'),
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
    throw new CardCommandError(
      'usage_error',
      `Invalid list type '${rawType}'. Use 'deck', 'collection', or 'wanted'.`,
      ExitCode.UsageError,
    )
  }
  if (format !== undefined && rawType !== 'deck') {
    throw new CardCommandError(
      'usage_error',
      '--format only applies to decks.',
      ExitCode.UsageError,
    )
  }

  const result = await createList(rawType, name, format)
  if (isListLifecycleError(result)) throw lifecycleErrorToCommandError(result)

  if (scripting.output === 'text') {
    if (!scripting.quiet) {
      emitOutput(`Created ${listTypeLabel(rawType)}: ${result.filePath}`, scripting)
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
