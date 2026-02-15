import { Command } from 'commander'
import { fetchSearchPage } from '../scryfall'
import prompts from 'prompts'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseFields,
  projectFields,
} from './scripting'

export function registerScryCommand(program: Command) {
  addScriptingOptions(
    program
      .command('scry')
      .description('Run a raw Scryfall card search')
      .argument('<query>', 'Scryfall search query')
      .option('--csv', 'Output as CSV', false)
      .option('--pages <number>', 'Number of pages to output (default 1 for non-TTY)', parseInt)
      .option('--non-interactive', 'Disable pagination prompts')
      .option('-y, --yes', 'Automatically fetch additional pages in TTY mode')
      .option('--fields <list>', 'Comma-separated fields for json/ndjson output', parseFields),
    'json',
  ).action(
    async (
      query: string,
      options: {
        csv: boolean
        pages?: number
        output?: 'text' | 'json' | 'ndjson'
        quiet?: boolean
        nonInteractive?: boolean
        yes?: boolean
        fields?: string[]
      },
    ) => {
      const scriptingOptions = normalizeScriptingOptions(options, 'json')
      if (options.fields && options.fields.length > 0 && options.csv) {
        emitError('usage_error', '--fields cannot be used with --csv.', scriptingOptions)
        process.exitCode = ExitCode.UsageError
        return
      }
      if (options.fields && options.fields.length > 0 && scriptingOptions.output === 'text') {
        emitError(
          'usage_error',
          '--fields requires --output json or --output ndjson.',
          scriptingOptions,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      let page = 1
      const format = options.csv ? 'csv' : 'json'

      // Determine max pages
      // If TTY, infinity (until user quits). If not TTY, default to 1 unless specified.
      const isTTY = process.stdout.isTTY
      const interactivePaging =
        isTTY && !scriptingOptions.quiet && options.nonInteractive !== true && options.yes !== true
      let maxPages = options.pages

      if (maxPages === undefined) {
        if (options.yes && isTTY) {
          maxPages = Number.MAX_SAFE_INTEGER
        } else {
          maxPages = interactivePaging ? Number.MAX_SAFE_INTEGER : 1
        }
      }

      while (true) {
        if (page > maxPages!) break

        try {
          const { data, raw, hasMore } = await fetchSearchPage(query, page, format)

          if (!raw || raw.length === 0) {
            // Empty result or 404
            if (page === 1) {
              emitError('not_found', 'No results found.', scriptingOptions)
              process.exitCode = ExitCode.NotFound
            }
            break
          }

          // For CSV, strip header if not first page
          let output = raw
          if (format === 'csv' && page > 1) {
            const lines = raw.split('\n')
            if (lines.length > 1) {
              output = lines.slice(1).join('\n')
            }
          }

          if (format === 'json' && data) {
            if (scriptingOptions.output === 'ndjson') {
              emitOutput(projectFields(data.data, options.fields), scriptingOptions)
            } else if (options.fields && options.fields.length > 0) {
              emitOutput(projectFields(data.data, options.fields), scriptingOptions)
            } else {
              process.stdout.write(output)
              if (!output.endsWith('\n')) {
                process.stdout.write('\n')
              }
            }
          } else {
            process.stdout.write(output)
            if (!output.endsWith('\n')) {
              process.stdout.write('\n')
            }
          }

          if (!hasMore) break

          if (options.yes === true) {
            page++
            continue
          }

          if (interactivePaging && page < maxPages!) {
            const response = await prompts({
              type: 'confirm',
              name: 'continue',
              message: `Page ${page} displayed. Fetch next page?`,
              initial: true,
            })

            if (!response.continue) break
          }

          page++
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e)
          emitError('runtime_error', `Error fetching page ${page}: ${message}`, scriptingOptions)
          process.exitCode = ExitCode.RuntimeError
          break
        }
      }
    },
  )
}

function parseInt(value: string) {
  const parsed = Number.parseInt(value, 10)
  if (isNaN(parsed)) return undefined
  return parsed
}
