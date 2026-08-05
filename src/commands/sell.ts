import { Command, InvalidArgumentError } from 'commander'
import { ensureCardCachePresent, emptyCacheAdvice } from '../cache/freshness'
import { adoptCardKingdomFeed, ensureCardKingdomFeed } from '../cardkingdom'
import { formatPrintingAnnotation } from '../change-event'
import { formatPrice } from '../price-currency'
import { addRefreshOption, resolveRefreshMode, type RefreshMode } from '../refresh'
import { listTypeFromFlags, type ListLocation } from '../resolve-list'
import {
  applySellFilters,
  buildSellCartCsv,
  isBuyingEntry,
  parseMinPrice,
  type BuyingSellEntry,
  type SellEntryFilters,
  type SellListSummary,
  type SellReportEntry,
  type SellReportPayload,
  type SellReportTotals,
  type SellReportView,
} from '../sell-report'
import { loadAndBuildSellReport } from '../sell-runtime'
import { parseSetCodesInput } from '../set-codes'
import { formatDuration } from '../utils'
import { isListArgumentsFailure, resolveListArguments } from './list-arguments'
import {
  addOutputOption,
  addQuietOption,
  CSV_OUTPUT_FORMATS,
  csvScriptingOptions,
  emitActionError,
  emitError,
  emitResolveListError,
  emitToFileOrStdout,
  emitWarnings,
  ExitCode,
  installScriptingLogger,
  resolveOutPath,
  type CsvOutputFormat,
  type ScriptingOptions,
} from './scripting'

export const SELL_DISCLAIMER =
  '⚠️  Buy prices are Card Kingdom cash quotes for Near Mint copies: played conditions are graded down, quantities are capped at their listed limits, and quotes change daily. Store credit typically pays more.'

type SellCommandOptions = Partial<Omit<ScriptingOptions, 'output'>> & {
  output?: CsvOutputFormat
  deck?: boolean
  collection?: boolean
  wanted?: boolean
  sets?: string[]
  min?: number
  all?: boolean
  out?: string
  refresh: RefreshMode
}

function parseMinPriceFlag(value: string): number {
  const parsed = parseMinPrice(value)
  if (typeof parsed === 'string') throw new InvalidArgumentError(parsed)
  return parsed
}

/**
 * The CK product half of an entry's text line, e.g.
 * `Foundations Variants (0294 - Borderless)` — plus the quoted finish when the
 * entry's own line did not already say it (unpinned entries quoted at a foil).
 */
function ckProductSegment(entry: SellReportEntry): string {
  if (entry.status === 'no-match') return ''
  const variation = entry.ckVariation ? ` (${entry.ckVariation})` : ''
  const finish =
    entry.ckFinish !== 'nonfoil' && entry.finish !== entry.ckFinish ? ` [${entry.ckFinish}]` : ''
  return `${entry.ckEdition}${variation}${finish}`
}

/** One text line for an entry CK is buying, sorted into the list's block. */
export function formatBuyingEntryLine(entry: BuyingSellEntry): string {
  const price = formatPrice(entry.priceBuy, 'usd')
  const quantity =
    entry.sellableQuantity < entry.quantity
      ? `×${entry.sellableQuantity} of ${entry.quantity}`
      : `×${entry.sellableQuantity}`
  const value = entry.sellableQuantity > 1 ? ` = ${formatPrice(entry.value, 'usd')}` : ''
  return `${price} ${quantity}${value}  ${entry.name}${formatPrintingAnnotation(entry)} · ${ckProductSegment(entry)} · max ${entry.qtyBuying}`
}

/** One text line for an entry CK is not buying (or that failed to match). */
export function formatUnsoldEntryLine(entry: SellReportEntry): string {
  const label =
    entry.status === 'no-match'
      ? `no match (${entry.noMatchReason})`
      : `not buying (${ckProductSegment(entry)})`
  return `${entry.name}${formatPrintingAnnotation(entry)} ×${entry.quantity} — ${label}`
}

/** The one-line summary of a list's totals, shared by the block header and tests. */
export function formatSellListTitle(summary: SellListSummary): string {
  const skipped = summary.notBuyingCount + summary.noMatchCount
  const tail = skipped > 0 ? ` (${skipped} not bought)` : ''
  return `[${summary.type}] ${summary.name} — CK buys ${summary.sellableCount} of ${summary.cardCount} cards · ${formatPrice(summary.totalValue, 'usd')}${tail}`
}

/** The report's header lines: feed provenance and age. */
export function formatSellHeaderLines(
  feed: Pick<SellReportPayload, 'feedCreatedAt' | 'feedRetrievedAt'>,
  now: number,
): string[] {
  const age = formatDuration(now - feed.feedRetrievedAt)
  const generated = feed.feedCreatedAt === '' ? '' : ` · generated ${feed.feedCreatedAt}`
  return [`Card Kingdom buylist${generated} · retrieved ${age} ago`]
}

/** The grand-totals footer line. */
export function formatSellTotalsLine(totals: SellReportTotals): string {
  return `Total: ${formatPrice(totals.totalValue, 'usd')} for ${totals.sellableCount} of ${totals.cardCount} cards across ${totals.listCount} list${totals.listCount === 1 ? '' : 's'}`
}

/** How {@link renderSellReportText} decorates the report. */
export type SellTextOptions = {
  header: string[]
  /** Itemize not-buying and unmatched entries instead of only counting them. */
  all: boolean
  /** Drop the disclaimer footer. */
  quiet: boolean
}

/**
 * Render the full text report. Buying entries sort by value (best offers
 * first) within their list.
 */
export function renderSellReportText(view: SellReportView, options: SellTextOptions): string {
  const lines: string[] = [...options.header]
  for (const summary of view.lists) {
    const listEntries = view.entries.filter(
      (entry) => entry.listType === summary.type && entry.listName === summary.name,
    )
    const buying = listEntries
      .filter(isBuyingEntry)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    const unsold = listEntries.filter((entry) => entry.status !== 'buying')

    lines.push('', formatSellListTitle(summary))
    for (const entry of buying) lines.push(`  ${formatBuyingEntryLine(entry)}`)
    if (options.all) {
      for (const entry of unsold) lines.push(`  ${formatUnsoldEntryLine(entry)}`)
    } else if (unsold.length > 0) {
      lines.push(
        `  (${summary.notBuyingCount} not buying, ${summary.noMatchCount} unmatched — rerun with --all to list them)`,
      )
    }
  }
  lines.push('', formatSellTotalsLine(view.totals))
  if (!options.quiet) lines.push('', SELL_DISCLAIMER)
  return `${lines.join('\n')}\n`
}

export function registerSellCommand(program: Command): void {
  addRefreshOption(
    addQuietOption(
      addOutputOption(
        program
          .command('sell')
          .description("Check what Card Kingdom's buylist pays for cards in your lists")
          .argument(
            '[list...]',
            'Lists to check (any type; deck:/collection:/wanted: prefixes work). Default: every collection',
          )
          .option('--deck', 'Scope to decks (also disambiguates list names)')
          .option('--collection', 'Scope to collections (also disambiguates list names)')
          .option('--wanted', 'Scope to wanted lists (also disambiguates list names)')
          .option('--sets <codes>', 'Only cards from these set codes (comma-separated)', (value) =>
            parseSetCodesInput(value),
          )
          .option('--min <price>', 'Only offers of at least this much per copy', parseMinPriceFlag)
          .option('--all', 'Also list entries CK is not buying (text output)')
          .option('--out <file>', "Write the output to a file instead of stdout ('-' for stdout)"),
        CSV_OUTPUT_FORMATS,
        'text',
      ),
    ),
    'Buylist + card cache refresh policy: ask (a day-old buylist redownloads without asking; the first download prompts, skipped when unanswerable), auto, no-bulk, never',
  ).action(async (listArgs: string[], options: SellCommandOptions) => {
    const format: CsvOutputFormat = options.output ?? 'text'
    const scripting = csvScriptingOptions(format, options.quiet ?? false)
    // The engine logs through getLogger() (cache chatter, feed downloads);
    // keep it off stdout whenever stdout carries a payload — csv included —
    // and drop it under --quiet.
    installScriptingLogger({
      output: format === 'text' ? 'text' : 'ndjson',
      quiet: scripting.quiet,
    })

    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      emitError('usage_error', 'Use only one of --deck, --collection, or --wanted.', scripting)
      process.exitCode = ExitCode.UsageError
      return
    }

    const refreshMode = resolveRefreshMode(options.refresh, format)

    // Resolve the scope: explicit lists (any type), or every list of the
    // scoped type, defaulting to collections — the lists that hold cards
    // physically owned and therefore sellable.
    let locations: ListLocation[] | undefined
    const scopeType = type ?? 'collection'
    if (listArgs.length > 0) {
      const resolved = await resolveListArguments(listArgs, type)
      if (isListArgumentsFailure(resolved)) {
        if (resolved.kind === 'conflict') {
          emitError('usage_error', resolved.message, scripting)
          process.exitCode = ExitCode.UsageError
        } else {
          emitResolveListError(resolved.error, scripting, 'type-prefix')
        }
        return
      }
      locations = resolved
    }

    try {
      const cacheReady = await ensureCardCachePresent(
        refreshMode,
        'Buylist matching requires the Scryfall card database.',
      )
      if (!cacheReady) {
        emitError(
          'runtime_error',
          emptyCacheAdvice('The card cache is empty; buylist matching requires it.'),
          scripting,
        )
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const feed = await ensureCardKingdomFeed(refreshMode)
      if (typeof feed === 'string') {
        emitError('runtime_error', feed, scripting)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const { report, warnings } = await loadAndBuildSellReport(
        locations ? undefined : scopeType,
        locations,
        await adoptCardKingdomFeed(feed),
        { refresh: refreshMode },
      )
      // A skipped card line means the report excludes cards: essential, so it
      // survives --quiet and structured output.
      emitWarnings(
        warnings.map((warning) => `⚠️  ${warning}`),
        scripting,
        { essential: true },
      )

      const filters: SellEntryFilters = { sets: options.sets, minPrice: options.min }
      const view = applySellFilters(report, filters)

      const outPath = resolveOutPath(options.out)
      let content: string
      switch (format) {
        case 'json': {
          const payload: SellReportPayload = {
            feedCreatedAt: report.feedCreatedAt,
            feedRetrievedAt: report.feedRetrievedAt,
            filters,
            lists: view.lists,
            entries: view.entries,
            totals: view.totals,
            warnings,
          }
          content = `${JSON.stringify(payload, null, 2)}\n`
          break
        }
        case 'ndjson':
          content =
            view.entries.length === 0
              ? ''
              : `${view.entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
          break
        case 'csv': {
          const cart = buildSellCartCsv(view.entries)
          emitWarnings(
            cart.warnings.map((warning) => `⚠️  ${warning}`),
            scripting,
            { essential: true },
          )
          content = cart.csv
          break
        }
        case 'text':
          content = renderSellReportText(view, {
            header: formatSellHeaderLines(report, Date.now()),
            all: options.all ?? false,
            quiet: scripting.quiet,
          })
          break
        default:
          format satisfies never
          return
      }

      await emitToFileOrStdout(content, {
        outPath,
        quiet: scripting.quiet,
        confirm: outPath === undefined ? undefined : { file: (target) => `Wrote ${target}` },
      })
    } catch (e) {
      emitActionError(e, scripting)
    }
  })
}
