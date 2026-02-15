import { Command } from 'commander'
import fs from 'node:fs/promises'
import { scryfallClient } from '../scryfall'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseFields,
  projectFields,
} from './scripting'

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

export function registerCardCommand(program: Command) {
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
  ).action(
    async (
      name: string | undefined,
      options: {
        fuzzy: boolean
        set?: string
        output?: 'text' | 'json' | 'ndjson'
        quiet?: boolean
        stdin?: boolean
        fromFile?: string
        fields?: string[]
      },
    ) => {
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
        const fileContent = await fs.readFile(options.fromFile, 'utf-8')
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

      for (const cardName of names) {
        const card = await scryfallClient.fetchNamedCard(cardName, {
          fuzzy: options.fuzzy,
          set: options.set,
        })

        if (!card) {
          emitError('not_found', `Card '${cardName}' not found.`, effectiveOptions)
          hadMissing = true
          continue
        }

        if (effectiveOptions.output === 'text') {
          emitOutput(`${card.name} (${card.set.toUpperCase()})`, effectiveOptions)
          continue
        }

        emitOutput(projectFields(card, options.fields), effectiveOptions)
      }

      if (hadMissing) {
        process.exitCode = ExitCode.NotFound
      }
    },
  )
}
