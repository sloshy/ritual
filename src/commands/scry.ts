import { Command, InvalidArgumentError } from 'commander'
import type { ScryfallCard } from '../types'
import { classifyFetchCard, fetchRandomCard, fetchSearchPage } from '../scryfall'
import { isNoInput } from '../no-input'
import {
  addFieldsOption,
  addOutputOption,
  CSV_OUTPUT_FORMATS,
  csvScriptingOptions,
  emitError,
  emitOutput,
  ExitCode,
  projectFields,
  projectFieldsArray,
  rejectFieldsWithTextOutput,
  renderCardSummary,
  writeStderr,
  writeStdout,
  type CsvOutputFormat,
  type ScriptingOptions,
} from './scripting'
import { getErrorMessage } from '../errors'
import { parsePositiveInteger } from '../parse-number'
import { ask } from './prompts-helpers'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'

/**
 * `scry` speaks the shared csv-widened vocabulary; its `csv` is rendered by
 * Scryfall itself, server-side.
 */
export const SCRY_OUTPUT_FORMATS = CSV_OUTPUT_FORMATS

export type ScryOutputFormat = CsvOutputFormat

type ScryCommandOptions = {
  random: boolean
  pages?: number
  count?: number
  output?: ScryOutputFormat
  fields?: string[]
}

/**
 * The scripting envelope `scry` reports errors and notices through — the
 * shared csv-borrows-text rule, with `quiet` pinned off (scry registers no
 * `--quiet`).
 */
export type ScryScriptingInput = {
  output?: ScryOutputFormat
}

export function scryScriptingOptions(options: ScryScriptingInput): ScriptingOptions {
  return csvScriptingOptions(options.output, false)
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
  /** The resolved `--output` value. */
  output: ScryOutputFormat
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
    if (input.pagesFlag !== undefined) return t('cli.scry.pagesWithRandom')
    if (input.output === 'csv') return t('cli.scry.csvWithRandom')
    return null
  }
  if (input.countFlag !== undefined) return t('cli.scry.countNeedsRandom')
  if (input.query === undefined) return t('cli.scry.queryRequired')
  return null
}

/**
 * The most result pages one `scry` run will fetch, interactive or not. Each page
 * is a separate paced Scryfall request, so this is a courtesy bound on their API
 * as much as a guard against a typo'd `--pages`.
 */
export const MAX_SCRY_PAGES = 20

/** The most random cards one `--random --count` run will fetch, for the same reason. */
export const MAX_SCRY_RANDOM_COUNT = 50

export function registerScryCommand(program: Command): void {
  // `--output` only: results and the truncation notice are all payload or
  // content-loss warnings, neither of which `--quiet` may hide.
  addOutputOption(
    addFieldsOption(
      program
        .command('scry')
        .description(t('help.scry.description'))
        .argument('[query]', t('help.scry.query'))
        .option('--pages <number>', t('help.scry.pages', { max: MAX_SCRY_PAGES }), parseScryPages)
        .option('--random', t('help.scry.random'), false)
        .option(
          '--count <number>',
          t('help.scry.count', { max: MAX_SCRY_RANDOM_COUNT }),
          parseScryCount,
        ),
    ),
    SCRY_OUTPUT_FORMATS,
    'json',
  ).action(async (query: string | undefined, options: ScryCommandOptions) => {
    const format: ScryOutputFormat = options.output ?? 'json'
    const scriptingOptions = scryScriptingOptions(options)
    const usageError = validateScryUsage({
      query,
      random: options.random,
      countFlag: options.count,
      output: format,
      pagesFlag: options.pages,
    })
    if (usageError !== null) {
      emitError('usage_error', usageError, scriptingOptions)
      process.exitCode = ExitCode.UsageError
      return
    }
    if (options.fields && options.fields.length > 0 && format === 'csv') {
      emitError(
        'usage_error',
        t('cli.scry.fieldsWithCsv'),
        scriptingOptions,
        undefined,
        'cli.scry.fieldsWithCsv',
      )
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
    // Scryfall renders CSV itself; every other output value is projected from
    // the JSON envelope, so that is what the wire request asks for.
    const wireFormat: 'csv' | 'json' = format === 'csv' ? 'csv' : 'json'

    const interactivePaging = shouldPageInteractively({
      stdoutIsTTY: process.stdout.isTTY === true,
      stdinIsTTY: process.stdin.isTTY === true,
      noInput: isNoInput(),
      pagesFlag: options.pages,
    })
    // Interactive paging keeps fetching until the user declines; otherwise the
    // explicit `--pages` cap applies, defaulting to a single page. Even the
    // interactive path is bounded — a held-down Enter must not walk a result set
    // forever at one paced request per page.
    const maxPages = options.pages ?? (interactivePaging ? MAX_SCRY_PAGES : 1)

    /**
     * Cards collected for a single `--output json` document.
     *
     * `json` must emit ONE document, and always the same one: a scripted run
     * writes exactly one array of cards whether it fetched one page or five, so
     * a caller can `JSON.parse` stdout without knowing how many pages there
     * were. `ndjson` streams per page — that is its contract — and `csv`
     * concatenates rows, so only this mode buffers.
     *
     * Interactive paging is the one exception: the whole point of the prompt is
     * seeing each page before asking for the next, so those runs keep printing
     * per page.
     */
    const jsonCards: unknown[] = []
    const bufferJson = format === 'json' && !interactivePaging

    /** Report a page that could not be fetched, and set the runtime exit code. */
    const failPage = (message: string): void => {
      emitError(
        'runtime_error',
        t('cli.scry.pageFetchFailed', { page, reason: message }),
        scriptingOptions,
        undefined,
        'cli.scry.pageFetchFailed',
      )
      process.exitCode = ExitCode.RuntimeError
    }

    /** Cards emitted so far and the run's total, for the truncation notice. */
    let emittedCards = 0
    let totalCards: number | undefined

    while (true) {
      if (page > maxPages) break

      try {
        const result = await fetchSearchPage(query, page, wireFormat)
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
            emitError(
              'not_found',
              t('cli.scry.noResults'),
              scriptingOptions,
              undefined,
              'cli.scry.noResults',
            )
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

        /** Write a raw Scryfall payload (CSV rows, or the JSON list envelope). */
        const writeRaw = (): void => {
          writeStdout(output)
          if (!output.endsWith('\n')) writeStdout('\n')
        }

        if (format !== 'csv' && data) {
          emittedCards += data.data.length
          totalCards = data.total_cards ?? totalCards
          if (format === 'text') {
            // The documented text rendering: one `Name (SET)` line per card,
            // the same summary the --random path prints.
            for (const card of data.data) {
              emitOutput(renderCardSummary(card), scriptingOptions)
            }
          } else if (bufferJson) {
            jsonCards.push(...projectFieldsArray(data.data, options.fields))
          } else if (format === 'ndjson' || (options.fields && options.fields.length > 0)) {
            emitOutput(projectFields(data.data, options.fields), scriptingOptions)
          } else {
            writeRaw()
          }
        } else {
          writeRaw()
        }

        if (!hasMore) break

        // A non-interactive run that stopped with results left says so, once,
        // on stderr — otherwise a capped run looks like a complete one.
        if (page >= maxPages && !interactivePaging) {
          emitTruncationNotice(emittedCards, totalCards, page)
        }

        // The gate guarantees a prompt-capable terminal here, so the guarded
        // ask() never throws; cancelling (Esc / Ctrl-C) stops paging.
        if (interactivePaging) {
          const fetchNext = await ask<boolean>({
            type: 'confirm',
            message: t('cli.scry.promptNextPage', { page }),
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

    // One document for the whole run, however many pages it took — including the
    // empty array for a run that found nothing or failed on its first page, so
    // stdout parses as the same shape no matter how the run went (the failure
    // itself is on stderr and in the exit code).
    if (bufferJson) {
      emitOutput(jsonCards, scriptingOptions)
    }
  })
}

/**
 * Build the one-line notice a capped run prints when Scryfall still has results.
 * `fetched` is `undefined` for CSV output, where rows are not counted — the
 * notice then just says results remain. Exported so its wording is pinned
 * without a network round-trip.
 */
export function formatTruncationNotice(
  fetched: number | undefined,
  total: number | undefined,
  pages: number,
): string {
  const pageLabel = t('cli.scry.pageRange', { count: pages })
  if (fetched === undefined || total === undefined) {
    return t('cli.scry.truncatedUnknown', { pages: pageLabel })
  }
  return t('cli.scry.truncated', { fetched, total, pages: pageLabel })
}

/**
 * Print {@link formatTruncationNotice} to stderr. A capped run silently looks
 * like a complete one, so this is a content-loss notice: it always prints, in
 * every output mode, and stays off stdout so the payload keeps parsing.
 */
function emitTruncationNotice(fetched: number, total: number | undefined, pages: number): void {
  writeStderr(`${formatTruncationNotice(fetched > 0 ? fetched : undefined, total, pages)}\n`)
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
        t('cli.scry.randomFailed', { reason: outcome.message }),
        scriptingOptions,
        undefined,
        'cli.scry.randomFailed',
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    if (outcome.kind === 'not-found') {
      emitError(
        'not_found',
        t('cli.scry.randomNotFound'),
        scriptingOptions,
        undefined,
        'cli.scry.randomNotFound',
      )
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

/**
 * Reject non-numeric, non-positive, and unbounded flag values at parse time.
 *
 * Every page is a paced Scryfall request, so an accidental `--pages 100000`
 * would spend the rate limit for an hour before anyone noticed. The cap is named
 * in the message so a caller who really wants more knows what the ceiling is.
 */
function parseBoundedInt(value: string, bound: BoundedFlagMessages, max: number): number {
  const parsed = parsePositiveInteger(value)
  if (parsed === undefined) throw new InvalidArgumentError(t(bound.positive))
  if (parsed > max) throw new InvalidArgumentError(t(bound.tooLarge, { max }))
  return parsed
}

/**
 * The two refusals a bounded numeric flag needs. A whole message per flag
 * rather than one frame with the flag's name spliced in: the name is the
 * sentence's subject, and a subject cannot be substituted across languages
 * without agreement errors.
 */
type BoundedFlagMessages = {
  positive: Extract<MessageKey, `cli.scry.${string}Positive`>
  tooLarge: Extract<MessageKey, `cli.scry.${string}TooLarge`>
}

/** Commander argParser for `--pages`; exported so its bound is pinned directly. */
export function parseScryPages(value: string): number {
  return parseBoundedInt(
    value,
    { positive: 'cli.scry.pagesPositive', tooLarge: 'cli.scry.pagesTooLarge' },
    MAX_SCRY_PAGES,
  )
}

/** Commander argParser for `--count`; exported so its bound is pinned directly. */
export function parseScryCount(value: string): number {
  return parseBoundedInt(
    value,
    { positive: 'cli.scry.countPositive', tooLarge: 'cli.scry.countTooLarge' },
    MAX_SCRY_RANDOM_COUNT,
  )
}
