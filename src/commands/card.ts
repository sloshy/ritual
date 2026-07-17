import { Command } from 'commander'
import fs from 'node:fs/promises'
import { classifyFetchCard, scryfallClient } from '../scryfall'
import { getErrorMessage } from '../errors'
import {
  addScriptingOptions,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseFields,
  projectFields,
} from './scripting'

type CardCommandOptions = {
  fuzzy: boolean
  set?: string
  output?: 'text' | 'json' | 'ndjson'
  quiet?: boolean
  stdin?: boolean
  fromFile?: string
  fields?: string[]
}

async function readLinesFromStdin(): Promise<string[]> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) {
    chunks.push(String(chunk))
  }

  return chunks
    .join('')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseInputNames(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function registerCardCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('card')
      .description('Look up a single card by name using Scryfall')
      .argument('[name]', 'Card name to search for')
      .option('--fuzzy', 'Use fuzzy matching instead of exact', false)
      .option('--set <code>', 'Filter by set code')
      .option('--stdin', 'Read card names from stdin (one per line)')
      .option('--from-file <path>', 'Read card names from file (one per line)')
      .option('--fields <list>', 'Comma-separated fields for json/ndjson output', parseFields),
    'json',
  ).action(async (name: string | undefined, options: CardCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'json')
    if (options.fields && options.fields.length > 0 && scriptingOptions.output === 'text') {
      emitError(
        'usage_error',
        '--fields requires --output json or --output ndjson.',
        scriptingOptions,
      )
      process.exitCode = ExitCode.UsageError
      return
    }
    if (options.stdin && options.fromFile) {
      emitError('usage_error', 'Use either --stdin or --from-file, not both.', scriptingOptions)
      process.exitCode = ExitCode.UsageError
      return
    }

    let names: string[] = []
    if (options.stdin) {
      names = await readLinesFromStdin()
    } else if (options.fromFile) {
      let fileContent: string
      try {
        fileContent = await fs.readFile(options.fromFile, 'utf-8')
      } catch (e) {
        const failure = classifyFileReadError(e)
        emitError(
          failure.errorCode,
          `Could not read file '${options.fromFile}': ${getErrorMessage(e)}`,
          scriptingOptions,
        )
        process.exitCode = failure.exitCode
        return
      }
      names = parseInputNames(fileContent)
    } else if (name) {
      names = [name]
    }

    if (names.length === 0) {
      emitError(
        'usage_error',
        'Provide a card name argument or use --stdin/--from-file for batch input.',
        scriptingOptions,
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    const batchMode = names.length > 1
    const effectiveOptions = {
      ...scriptingOptions,
      output:
        batchMode && scriptingOptions.output === 'json'
          ? ('ndjson' as const)
          : scriptingOptions.output,
    }
    let hadMissing = false
    let hadFailure = false

    for (const cardName of names) {
      const outcome = classifyFetchCard(
        await scryfallClient.fetchNamedCard(cardName, {
          fuzzy: options.fuzzy,
          set: options.set?.toLowerCase(),
        }),
      )

      if (outcome.kind === 'failed') {
        emitError(
          'runtime_error',
          `Failed to fetch card '${cardName}': ${outcome.message}`,
          effectiveOptions,
        )
        hadFailure = true
        continue
      }

      if (outcome.kind === 'not-found') {
        emitError('not_found', `Card '${cardName}' not found.`, effectiveOptions)
        hadMissing = true
        continue
      }

      const card = outcome.card

      if (effectiveOptions.output === 'text') {
        emitOutput(`${card.name} (${card.set.toUpperCase()})`, effectiveOptions)
        continue
      }

      emitOutput(projectFields(card, options.fields), effectiveOptions)
    }

    // A request failure outranks a genuine not-found when both occur in one batch.
    if (hadFailure) {
      process.exitCode = ExitCode.RuntimeError
    } else if (hadMissing) {
      process.exitCode = ExitCode.NotFound
    }
  })
}
