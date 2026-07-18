import { Command, InvalidArgumentError } from 'commander'
import { fetchSearchPage } from '../scryfall'
import { isNoInput } from '../no-input'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  parseFields,
  projectFields,
} from './scripting'
import { getErrorMessage } from '../errors'
import { ask } from './prompts-helpers'

type ScryCommandOptions = {
  csv: boolean
  pages?: number
  output?: 'text' | 'json' | 'ndjson'
  quiet?: boolean
  fields?: string[]
}

/** The inputs that decide whether scry offers the page-by-page confirm prompt. */
export type ScryPagingInput = {
  stdoutIsTTY: boolean
  stdinIsTTY: boolean
  noInput: boolean
  /** The explicit `--pages` value, or undefined when the flag was not given. */
  pagesFlag: number | undefined
}

/**
 * Interactive "fetch next page?" paging needs a full terminal (stdout AND
 * stdin), prompting must be allowed, and no explicit `--pages` cap may be
 * given — an explicit cap means "fetch exactly this many, no questions".
 * `--quiet` deliberately has no say here: it suppresses non-essential chatter,
 * not interaction.
 */
export function shouldPageInteractively(input: ScryPagingInput): boolean {
  return input.stdoutIsTTY && input.stdinIsTTY && !input.noInput && input.pagesFlag === undefined
}

export function registerScryCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('scry')
      .description('Run a raw Scryfall card search')
      .argument('<query>', 'Scryfall search query')
      .option('--csv', 'Output as CSV', false)
      .option(
        '--pages <number>',
        'Fetch up to this many pages without prompting (default 1 when prompts are unavailable)',
        parsePages,
      )
      .option('--fields <list>', 'Comma-separated fields for json/ndjson output', parseFields),
    'json',
  ).action(async (query: string, options: ScryCommandOptions) => {
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

    const interactivePaging = shouldPageInteractively({
      stdoutIsTTY: process.stdout.isTTY === true,
      stdinIsTTY: process.stdin.isTTY === true,
      noInput: isNoInput(),
      pagesFlag: options.pages,
    })
    // Interactive paging keeps fetching until the user declines; otherwise the
    // explicit `--pages` cap applies, defaulting to a single page.
    const maxPages = options.pages ?? (interactivePaging ? Number.MAX_SAFE_INTEGER : 1)

    while (true) {
      if (page > maxPages) break

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

        // The gate guarantees a prompt-capable terminal here, so the guarded
        // ask() never throws; cancelling (Esc / Ctrl-C) stops paging.
        if (interactivePaging) {
          const fetchNext = await ask<boolean>({
            type: 'confirm',
            message: `Page ${page} displayed. Fetch next page?`,
            initial: true,
          })
          if (fetchNext !== true) break
        }

        page++
      } catch (e: unknown) {
        const message = getErrorMessage(e)
        emitError('runtime_error', `Error fetching page ${page}: ${message}`, scriptingOptions)
        process.exitCode = ExitCode.RuntimeError
        break
      }
    }
  })
}

/** Commander argParser for --pages: reject non-numeric and non-positive values at parse time. */
function parsePages(value: string): number {
  const pages = Number.parseInt(value, 10)
  if (!Number.isInteger(pages) || pages <= 0) {
    throw new InvalidArgumentError('Pages must be a positive integer.')
  }
  return pages
}
