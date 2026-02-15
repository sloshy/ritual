import { Command } from 'commander'
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

export function registerRandomCommand(program: Command) {
  addScriptingOptions(
    program
      .command('random')
      .description('Fetch a random card from Scryfall')
      .option('--filter <query>', 'Scryfall search query to filter random selection')
      .option('--fields <list>', 'Comma-separated fields for json/ndjson output', parseFields),
    'json',
  ).action(
    async (options: {
      filter?: string
      output?: 'text' | 'json' | 'ndjson'
      quiet?: boolean
      fields?: string[]
    }) => {
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
      const card = await scryfallClient.fetchRandomCard(options.filter)

      if (card) {
        if (scriptingOptions.output === 'text') {
          emitOutput(`${card.name} (${card.set.toUpperCase()})`, scriptingOptions)
          return
        }
        emitOutput(projectFields(card, options.fields), scriptingOptions)
      } else {
        emitError('not_found', 'No card found for the supplied random filter.', scriptingOptions)
        process.exitCode = ExitCode.NotFound
      }
    },
  )
}
