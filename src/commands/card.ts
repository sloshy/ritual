import { Command } from 'commander'
import fs from 'node:fs/promises'
import { classifyFetchCard, scryfallClient } from '../scryfall'
import { getErrorMessage } from '../errors'
import {
  addFieldsOption,
  addOutputOption,
  classifyFileReadError,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  OUTPUT_FORMATS,
  projectFields,
  rejectFieldsWithTextOutput,
  renderCardSummary,
  type OutputFormat,
} from './scripting'

type CardCommandOptions = {
  fuzzy: boolean
  set?: string
  output?: OutputFormat
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
  // `--output` only: every line `card` prints is payload or an error, so there
  // is no non-essential chatter for `--quiet` to suppress.
  addOutputOption(
    addFieldsOption(
      program
        .command('card')
        .description('Look up a single card by name using Scryfall')
        .argument('[name]', 'Card name to search for')
        .option('--fuzzy', 'Use fuzzy matching instead of exact', false)
        .option('--set <code>', 'Filter by set code')
        .option('--stdin', 'Read card names from stdin (one per line)')
        .option('--from-file <path>', 'Read card names from file (one per line)'),
    ),
    OUTPUT_FORMATS,
    'json',
  ).action(async (name: string | undefined, options: CardCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'json')
    if (rejectFieldsWithTextOutput(options.fields, scriptingOptions)) {
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
    /**
     * `--output json` emits ONE document, batch or not — the same contract
     * `scry` documents. A batch buffers its cards into a single array so the
     * shape never depends on how many lines the input happened to contain;
     * `--output ndjson` stays the opt-in streaming mode. A single lookup keeps
     * emitting the bare card object.
     */
    const bufferJson = batchMode && scriptingOptions.output === 'json'
    const jsonCards: unknown[] = []
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
          scriptingOptions,
        )
        hadFailure = true
        continue
      }

      if (outcome.kind === 'not-found') {
        emitError('not_found', `Card '${cardName}' not found.`, scriptingOptions)
        hadMissing = true
        continue
      }

      const card = outcome.card

      if (scriptingOptions.output === 'text') {
        emitOutput(renderCardSummary(card), scriptingOptions)
        continue
      }

      if (bufferJson) {
        jsonCards.push(projectFields(card, options.fields))
        continue
      }

      emitOutput(projectFields(card, options.fields), scriptingOptions)
    }

    // One array for the whole batch, however many names it held — including the
    // empty array when every lookup failed, so stdout parses as the same shape
    // no matter how the run went (failures are on stderr and in the exit code).
    if (bufferJson) {
      emitOutput(jsonCards, scriptingOptions)
    }

    // A request failure outranks a genuine not-found when both occur in one batch.
    if (hadFailure) {
      process.exitCode = ExitCode.RuntimeError
    } else if (hadMissing) {
      process.exitCode = ExitCode.NotFound
    }
  })
}
