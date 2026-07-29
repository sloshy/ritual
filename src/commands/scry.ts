import { Command, InvalidArgumentError } from 'commander'
import type { ScryfallCard } from '../types'
import { classifyFetchCard, fetchRandomCard, fetchSearchPage } from '../scryfall'
import { isNoInput } from '../no-input'
import {
  addFieldsOption,
  addScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  normalizeScriptingOptions,
  projectFields,
  rejectFieldsWithTextOutput,
  renderCardSummary,
  type ScriptingOptions,
} from './scripting'
import { getErrorMessage } from '../errors'
import { parsePositiveInteger } from '../parse-number'
import { ask } from './prompts-helpers'

type ScryCommandOptions = {
  csv: boolean
  random: boolean
  pages?: number
  count?: number
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

/** The flag/argument combination that decides the random-vs-search dispatch. */
export type ScryUsageInput = {
  query: string | undefined
  random: boolean
  /** The explicit `--count` value, or undefined when the flag was not given. */
  countFlag: number | undefined
  csv: boolean
  /** The explicit `--pages` value, or undefined when the flag was not given. */
  pagesFlag: number | undefined
}

/**
 * Validate the random-vs-search usage matrix: paging and CSV are meaningless
 * for random picks, `--count` is meaningless for searches, and a search needs
 * a query. Returns the usage-error message, or null when the combination is
 * valid.
 */
export function validateScryUsage(input: ScryUsageInput): string | null {
  if (input.random) {
    if (input.pagesFlag !== undefined) {
      return '--pages cannot be used with --random.'
    }
    if (input.csv) {
      return '--csv cannot be used with --random.'
    }
    return null
  }
  if (input.countFlag !== undefined) {
    return '--count requires --random.'
  }
  if (input.query === undefined) {
    return 'A search query is required unless --random is given.'
  }
  return null
}

export function registerScryCommand(program: Command): void {
  addScriptingOptions(
    addFieldsOption(
      program
        .command('scry')
        .description('Run a raw Scryfall card search or fetch random cards')
        .argument('[query]', 'Scryfall search query (with --random, filters the random pick)')
        .option('--csv', 'Output as CSV', false)
        .option(
          '--pages <number>',
          'Fetch up to this many pages without prompting (default 1 when prompts are unavailable)',
          parsePages,
        )
        .option('--random', 'Fetch random cards instead of searching', false)
        .option(
          '--count <number>',
          'Number of random cards to fetch with --random (default 1)',
          parseCount,
        ),
    ),
    'json',
  ).action(async (query: string | undefined, options: ScryCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'json')
    const usageError = validateScryUsage({
      query,
      random: options.random,
      countFlag: options.count,
      csv: options.csv,
      pagesFlag: options.pages,
    })
    if (usageError !== null) {
      emitError('usage_error', usageError, scriptingOptions)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (options.fields && options.fields.length > 0 && options.csv) {
      emitError('usage_error', '--fields cannot be used with --csv.', scriptingOptions)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (rejectFieldsWithTextOutput(options.fields, scriptingOptions)) {
      return
    }

    if (options.random) {
      await runRandom(query, options.count ?? 1, options.fields, scriptingOptions)
      return
    }
    if (query === undefined) {
      // Unreachable: validateScryUsage guarantees a query on the search path.
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

    /** Report a page that could not be fetched, and set the runtime exit code. */
    const failPage = (message: string): void => {
      emitError('runtime_error', `Error fetching page ${page}: ${message}`, scriptingOptions)
      process.exitCode = ExitCode.RuntimeError
    }

    while (true) {
      if (page > maxPages) break

      try {
        const result = await fetchSearchPage(query, page, format)
        if (result.kind === 'failed') {
          // Scryfall refused the request (a malformed query is a 4xx); its own
          // `details` text is the most useful thing to show.
          failPage(result.message)
          break
        }
        const { data, raw, hasMore } = result

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
        failPage(getErrorMessage(e))
        break
      }
    }
  })
}

/**
 * The `--random` path: fetch `count` random cards sequentially (the Scryfall
 * client rate-limits each request), then emit them — a bare card for a single
 * pick, an array otherwise. Any fetch failure or empty pick aborts without
 * emitting partial output.
 */
async function runRandom(
  filter: string | undefined,
  count: number,
  fields: string[] | undefined,
  scriptingOptions: ScriptingOptions,
): Promise<void> {
  const cards: ScryfallCard[] = []
  for (let i = 0; i < count; i++) {
    const outcome = classifyFetchCard(await fetchRandomCard(filter))

    if (outcome.kind === 'failed') {
      emitError(
        'runtime_error',
        `Failed to fetch random card: ${outcome.message}`,
        scriptingOptions,
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (outcome.kind === 'not-found') {
      emitError('not_found', 'No card found for the supplied random filter.', scriptingOptions)
      process.exitCode = ExitCode.NotFound
      return
    }

    cards.push(outcome.card)
  }

  if (scriptingOptions.output === 'text') {
    for (const card of cards) {
      emitOutput(renderCardSummary(card), scriptingOptions)
    }
    return
  }

  emitOutput(projectFields(count === 1 ? cards[0] : cards, fields), scriptingOptions)
}

/** Reject non-numeric and non-positive flag values at parse time. */
function parsePositiveInt(value: string, label: string): number {
  const parsed = parsePositiveInteger(value)
  if (parsed === undefined) {
    throw new InvalidArgumentError(`${label} must be a positive integer.`)
  }
  return parsed
}

/** Commander argParser for --pages. */
function parsePages(value: string): number {
  return parsePositiveInt(value, 'Pages')
}

/** Commander argParser for --count. */
function parseCount(value: string): number {
  return parsePositiveInt(value, 'Count')
}
