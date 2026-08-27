import { Command, InvalidArgumentError } from 'commander'
import { ensureCardCachePresent, emptyCacheAdvice } from '../cache/freshness'
import { adoptCardKingdomFeed, ensureCardKingdomFeed } from '../cardkingdom'
import { formatPrintingAnnotation } from '../changes/change-event'
import { compareData } from '../i18n/collate'
import { formatPrice } from '../pricing/price-currency'
import {
  addRefreshOption,
  resolveRefreshMode,
  addOutputOption,
  addQuietOption,
} from '../cli/options'
import type { RefreshMode } from '../cache/refresh'
import {
  isListArgumentsFailure,
  listTypeFromFlags,
  resolveListArguments,
  type ListLocation,
} from '../list/resolve-list'
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
} from '../pricing/sell-report'
import { loadAndBuildSellReport } from '../pricing/sell-runtime'
import { parseSetCodesInput } from '../card/set-codes'
import { formatDuration } from '../util/duration'
import {
  CSV_OUTPUT_FORMATS,
  csvScriptingOptions,
  emitActionError,
  emitError,
  emitResolveListError,
  emitToFileOrStdout,
  emitWarnings,
  installScriptingLogger,
  resolveOutPath,
  type CsvOutputFormat,
  type ScriptingOptions,
} from '../cli/output'
import { fail, failWithError, listArgumentConflictError } from '../cli/action'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import { ExitCode } from '../util/errors'
import { t } from '../i18n/t'

/** The footer every text report ends with, unless `--quiet` drops it. */
export function sellDisclaimer(): string {
  return t('cli.sell.disclaimer')
}

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
      ? t('cli.sell.quantityCapped', {
          sellable: entry.sellableQuantity,
          quantity: entry.quantity,
        })
      : t('cli.sell.quantity', { quantity: entry.sellableQuantity })
  const value =
    entry.sellableQuantity > 1
      ? t('cli.sell.lineValue', { value: formatPrice(entry.value, 'usd') })
      : ''
  return t('cli.sell.buyingLine', {
    price,
    quantity,
    value,
    name: entry.name,
    annotation: formatPrintingAnnotation(entry),
    product: ckProductSegment(entry),
    max: entry.qtyBuying,
  })
}

/** One text line for an entry CK is not buying (or that failed to match). */
export function formatUnsoldEntryLine(entry: SellReportEntry): string {
  const label =
    entry.status === 'no-match'
      ? t('cli.sell.noMatch', { reason: entry.noMatchReason })
      : t('cli.sell.notBuying', { product: ckProductSegment(entry) })
  return t('cli.sell.unsoldLine', {
    name: entry.name,
    annotation: formatPrintingAnnotation(entry),
    quantity: entry.quantity,
    label,
  })
}

/** The one-line summary of a list's totals, shared by the block header and tests. */
export function formatSellListTitle(summary: SellListSummary): string {
  const skipped = summary.notBuyingCount + summary.noMatchCount
  const tail = skipped > 0 ? t('cli.sell.listTitleSkipped', { count: skipped }) : ''
  return t('cli.sell.listTitle', {
    type: summary.type,
    name: summary.name,
    sellable: summary.sellableCount,
    total: summary.cardCount,
    value: formatPrice(summary.totalValue, 'usd'),
    tail,
  })
}

/** The report's header lines: feed provenance and age. */
export function formatSellHeaderLines(
  feed: Pick<SellReportPayload, 'feedCreatedAt' | 'feedRetrievedAt'>,
  now: number,
): string[] {
  const age = formatDuration(now - feed.feedRetrievedAt)
  const generated =
    feed.feedCreatedAt === '' ? '' : t('cli.sell.headerGenerated', { date: feed.feedCreatedAt })
  return [t('cli.sell.header', { generated, age })]
}

/** The grand-totals footer line. */
export function formatSellTotalsLine(totals: SellReportTotals): string {
  return t('cli.sell.totals', {
    value: formatPrice(totals.totalValue, 'usd'),
    sellable: totals.sellableCount,
    total: totals.cardCount,
    counted: t('domain.count.lists', { count: totals.listCount }),
  })
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
      .sort((a, b) => b.value - a.value || compareData(a.name, b.name))
    const unsold = listEntries.filter((entry) => entry.status !== 'buying')

    lines.push('', formatSellListTitle(summary))
    for (const entry of buying) lines.push(`  ${formatBuyingEntryLine(entry)}`)
    if (options.all) {
      for (const entry of unsold) lines.push(`  ${formatUnsoldEntryLine(entry)}`)
    } else if (unsold.length > 0) {
      lines.push(
        t('cli.sell.unsoldSummary', {
          notBuying: summary.notBuyingCount,
          noMatch: summary.noMatchCount,
        }),
      )
    }
  }
  lines.push('', formatSellTotalsLine(view.totals))
  if (!options.quiet) lines.push('', sellDisclaimer())
  return `${lines.join('\n')}\n`
}

/**
 * Register `ritual sell`.
 *
 * Deliberately **not** gated on sell mode: `site.sellMode` (and the
 * `--sell-mode` override) decide whether the *sites* offer buylist prices, and
 * running this command is itself the explicit request for them. It refreshes
 * and quotes from the Card Kingdom feed under its own `--refresh` policy
 * whatever the config says.
 */
export function registerSellCommand(program: Command): void {
  addRefreshOption(
    addQuietOption(
      addOutputOption(
        program
          .command('sell')
          .description(t('help.sell.description'))
          .argument('[list...]', t('help.sell.listArg'))
          .option('--deck', t('help.sell.deck'))
          .option('--collection', t('help.sell.collection'))
          .option('--wanted', t('help.sell.wanted'))
          .option('--sets <codes>', t('help.sell.sets'), (value) => parseSetCodesInput(value))
          .option('--min <price>', t('help.sell.min'), parseMinPriceFlag)
          .option('--all', t('help.sell.all'))
          .option('--out <file>', t('help.sell.out')),
        CSV_OUTPUT_FORMATS,
        'text',
      ),
    ),
    t('help.sell.refresh'),
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
      fail(scripting, 'usage_error', 'cli.listScope.oneTypeFlag')
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
          failWithError(scripting, listArgumentConflictError(resolved.conflict))
        } else {
          emitResolveListError(resolved.error, scripting, 'type-prefix')
        }
        return
      }
      locations = resolved
    }

    try {
      const refreshPolicy = cliRefreshPolicy(refreshMode)
      const cacheReady = await ensureCardCachePresent(refreshPolicy, t('cli.sell.cacheRequirement'))
      if (!cacheReady) {
        emitError('runtime_error', emptyCacheAdvice(t('cli.sell.emptyCache')), scripting)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const feed = await ensureCardKingdomFeed(refreshPolicy)
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
        confirm:
          outPath === undefined
            ? undefined
            : { file: (target) => t('cli.sell.wroteFile', { file: target }) },
      })
    } catch (e) {
      emitActionError(e, scripting)
    }
  })
}
