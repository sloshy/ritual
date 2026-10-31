import { Command } from 'commander'
import fs from 'node:fs/promises'
import { classifyFetchCard, scryfallClient } from '../scryfall'
import { getDefaultPriceCurrency } from '../config/ritual-config'
import { renderCardDetail } from './card-text'
import { getErrorMessage, ExitCode } from '../util/errors'
import { t, type MessageParams } from '../i18n/t'
import { addFieldsOption, addOutputOption } from '../cli/options'
import {
  classifyFileReadError,
  emitError,
  emitOutput,
  normalizeScriptingOptions,
  OUTPUT_FORMATS,
  projectFields,
  rejectFieldsWithTextOutput,
  resolveFieldsOutput,
  writeStderr,
  type OutputFormat,
} from '../cli/output'
import { fail } from '../cli/action'
import { envelopeRef, renderSyncMessage, syncMessage } from '../sync/message'
import { FLAG } from '../util/cli-tokens'

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

  return parseInputNames(chunks.join(''))
}

function parseInputNames(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function registerCardCommand(program: Command): void {
  // `--output` only: every line `card` prints is payload or an error (with a
  // not-found's retry hint), so there is no non-essential chatter for `--quiet`
  // to suppress.
  addOutputOption(
    addFieldsOption(
      program
        .command('card')
        .description(t('help.card.description'))
        .argument('[name]', t('help.card.name'))
        .option('--fuzzy', t('help.card.fuzzy'), false)
        .option('--set <code>', t('help.card.set'))
        .option('--stdin', t('help.card.stdin'))
        .option('--from-file <path>', t('help.card.fromFile')),
    ),
    OUTPUT_FORMATS,
    'text',
  ).action(async (name: string | undefined, options: CardCommandOptions, command: Command) => {
    const scriptingOptions = normalizeScriptingOptions({
      output: resolveFieldsOutput(
        options.output ?? 'text',
        options.fields,
        command.getOptionValueSource('output') === 'cli',
      ),
    })
    if (rejectFieldsWithTextOutput(options.fields, scriptingOptions)) {
      return
    }
    if (options.stdin && options.fromFile) {
      fail(scriptingOptions, 'usage_error', 'cli.card.stdinOrFile', {
        stdinFlag: FLAG.stdin,
        fromFileFlag: FLAG.fromFile,
      })
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
        fail(scriptingOptions, classifyFileReadError(e).errorCode, 'cli.card.readFailed', {
          file: options.fromFile,
          reason: getErrorMessage(e),
        })
        return
      }
      names = parseInputNames(fileContent)
    } else if (name) {
      names = [name]
    }

    if (names.length === 0) {
      fail(scriptingOptions, 'usage_error', 'cli.card.nameRequired', {
        stdinFlag: FLAG.stdin,
        fromFileFlag: FLAG.fromFile,
      })
      return
    }

    const batchMode = names.length > 1
    const currency = getDefaultPriceCurrency()
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
    let printedText = false

    for (const cardName of names) {
      const outcome = classifyFetchCard(
        await scryfallClient.fetchNamedCard(cardName, {
          fuzzy: options.fuzzy,
          set: options.set?.toLowerCase(),
        }),
      )

      if (outcome.kind === 'failed') {
        // The reason nests unrendered: the line reads in the CLI's language,
        // and `envelopeRef` gives the envelope its params in English.
        const failure = syncMessage('cli.card.fetchFailed', {
          name: cardName,
          reason: outcome.reason,
        })
        emitError(
          'runtime_error',
          renderSyncMessage(failure),
          scriptingOptions,
          undefined,
          envelopeRef(failure),
        )
        hadFailure = true
        continue
      }

      if (outcome.kind === 'not-found') {
        const params: MessageParams<'cli.card.notFound'> = { name: cardName }
        emitError('not_found', t('cli.card.notFound', params), scriptingOptions, undefined, {
          key: 'cli.card.notFound',
          params,
        })
        // A person reading the miss gets the cheap next step; the envelope
        // stays exactly the key above.
        if (scriptingOptions.output === 'text' && !options.fuzzy) {
          writeStderr(`${t('cli.card.notFoundHint', { flag: FLAG.fuzzy })}\n`)
        }
        hadMissing = true
        continue
      }

      const card = outcome.card

      if (scriptingOptions.output === 'text') {
        // A batch separates its cards with a blank line.
        if (printedText) emitOutput('', scriptingOptions)
        emitOutput(renderCardDetail(card, currency), scriptingOptions)
        printedText = true
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
