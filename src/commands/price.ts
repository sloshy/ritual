import { Command, InvalidArgumentError } from 'commander'
import { cardCache } from '../cache'
import { ensureFreshPriceData } from '../cache/freshness'
import { getErrorMessage } from '../errors'
import { listTypeLabel } from '../list-type'
import { parseCurrencyFlagOrError, type PriceCurrency } from '../price-currency'
import {
  filterPricedEntries,
  hasActiveFilters,
  isPriceSortField,
  PRICE_SORT_FIELDS,
  sumPricedEntries,
  comparePricedEntries,
  type BuiltPriceReport,
  type PriceCardSearchPayload,
  type PriceEntryFilters,
  type PricedEntry,
  type PriceListDetailPayload,
  type PriceSortField,
  type PriceSummaryPayload,
} from '../price-report'
import { loadAndBuildPriceReport } from '../price-runtime'
import {
  isResolveListError,
  listTypeFromFlags,
  resolveList,
  type ListLocation,
} from '../resolve-list'
import { getDefaultCurrency } from '../ritual-config'
import { refreshCardCache } from '../cache/refresh-source'
import {
  formatEntryChoiceTitle,
  formatListChoiceTitle,
  formatReportHeaderLines,
  formatTotalsSegment,
  runPriceBrowser,
  type PriceListRef,
} from './price-browser'
import {
  addScriptingOptions,
  emitError,
  emitOutput,
  emitResolveListError,
  ExitCode,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from './scripting'

const PRICE_DISCLAIMER =
  '⚠️  Prices are from Scryfall and reflect NM (Near Mint) market values. Card condition can significantly decrease actual value.'

type PriceCommandOptions = Partial<ScriptingOptions> & {
  deck?: boolean
  collection?: boolean
  wanted?: boolean
  prices?: string
  name?: string
  set?: string
  collector?: string
  sort?: PriceSortField
  descending?: boolean
  summary?: boolean
  /** Commander stores `--no-interactive` as `interactive: false`. */
  interactive?: boolean
  /** Commander stores `--no-cache-prompt` as `cachePrompt: false`. */
  cachePrompt?: boolean
  refreshPrices?: boolean
}

function parseSortFlag(value: string): PriceSortField {
  const normalized = value.toLowerCase()
  if (isPriceSortField(normalized)) return normalized
  throw new InvalidArgumentError(
    `Invalid sort field '${value}'. Use one of: ${PRICE_SORT_FIELDS.join(', ')}.`,
  )
}

/**
 * The browser launches only for a plain-text TTY run that didn't opt out and
 * didn't ask for a non-interactive view (summary or card-search filters).
 */
export function shouldRunInteractive(
  options: PriceCommandOptions,
  scriptingOptions: ScriptingOptions,
  filters: PriceEntryFilters,
  isTTY: boolean,
): boolean {
  if (!isTTY) return false
  if (options.interactive === false) return false
  if (options.summary) return false
  if (scriptingOptions.output !== 'text') return false
  if (hasActiveFilters(filters)) return false
  return true
}

function sortedEntries(
  entries: PricedEntry[],
  sort: PriceSortField,
  descending: boolean,
): PricedEntry[] {
  return [...entries].sort((a, b) => comparePricedEntries(a, b, sort, descending))
}

function emitSummary(
  built: BuiltPriceReport,
  lastRefreshedAt: number | null,
  scriptingOptions: ScriptingOptions,
): void {
  const { report } = built
  if (scriptingOptions.output === 'json') {
    const payload: PriceSummaryPayload = {
      currency: report.currency,
      lastRefreshedAt,
      lists: report.lists,
      typeTotals: report.typeTotals,
      totals: report.totals,
    }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(report.lists, scriptingOptions)
    return
  }

  for (const line of formatReportHeaderLines(report, lastRefreshedAt, Date.now())) {
    console.log(line)
  }
  console.log('')
  for (const summary of report.lists) {
    console.log(formatListChoiceTitle(summary, report.currency))
  }
  if (!scriptingOptions.quiet) {
    console.log('')
    console.log(PRICE_DISCLAIMER)
  }
}

function emitListDetail(
  built: BuiltPriceReport,
  listName: string,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  scriptingOptions: ScriptingOptions,
): void {
  const summary = built.report.lists.find((list) => list.name === listName)
  const entries = sortedEntries(
    built.report.entries.filter((entry) => entry.listName === listName),
    sort,
    descending,
  )

  if (scriptingOptions.output === 'json') {
    const payload: PriceListDetailPayload = { currency, list: summary, cards: entries }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(entries, scriptingOptions)
    return
  }

  console.log(`[${listName}]`)
  for (const entry of entries) {
    console.log(`  ${formatEntryChoiceTitle(entry, currency, false)}`)
  }
  if (summary) {
    console.log('')
    console.log(`  ${summary.cardCount} cards · ${formatTotalsSegment(summary, currency)}`)
  }
  if (!scriptingOptions.quiet) {
    console.log('')
    console.log(PRICE_DISCLAIMER)
  }
}

function emitCardSearch(
  built: BuiltPriceReport,
  filters: PriceEntryFilters,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  scriptingOptions: ScriptingOptions,
): void {
  const matches = sortedEntries(
    filterPricedEntries(built.report.entries, filters),
    sort,
    descending,
  )
  const totals = sumPricedEntries(matches)

  if (scriptingOptions.output === 'json') {
    const payload: PriceCardSearchPayload = { currency, filters, cards: matches, totals }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(matches, scriptingOptions)
    return
  }

  for (const entry of matches) {
    console.log(formatEntryChoiceTitle(entry, currency, true))
  }
  console.log('')
  console.log(`${matches.length} matching entries · ${formatTotalsSegment(totals, currency)}`)
}

export function registerPriceCommand(program: Command): void {
  addScriptingOptions(
    program
      .command('price')
      .description('Browse prices of every deck, collection, and wanted list')
      .argument('[listName]', 'Open (or print) a single list instead of all lists')
      .option('--deck', 'Only decks (also disambiguates listName)')
      .option('--collection', 'Only collections (also disambiguates listName)')
      .option('--wanted', 'Only wanted lists (also disambiguates listName)')
      .option(
        '--prices <currency>',
        'Price currency: usd, eur, or tix (default: the configured defaultCurrency)',
      )
      .option('--name <terms>', 'Print cards whose name contains every term')
      .option('--set <code>', 'Print cards from this set code')
      .option('--collector <number>', 'Print cards with this collector number')
      .option('--sort <field>', `Sort cards by: ${PRICE_SORT_FIELDS.join(', ')}`, parseSortFlag)
      .option('--descending', 'Reverse the sort direction')
      .option('--summary', 'Print the price summary instead of opening the browser')
      .option('--no-interactive', 'Never open the interactive browser')
      .option('--no-cache-prompt', 'Do not prompt to update stale prices')
      .option('--refresh-prices', 'Refresh cached prices that are more than a day old'),
    'text',
  ).action(async (listName: string | undefined, options: PriceCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')

    const currency = parseCurrencyFlagOrError(
      options.prices,
      emitError,
      scriptingOptions,
      ExitCode.UsageError,
      getDefaultCurrency(),
    )
    if (!currency) return

    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      emitError(
        'usage_error',
        'Use only one of --deck, --collection, or --wanted.',
        scriptingOptions,
      )
      process.exitCode = ExitCode.UsageError
      return
    }

    // The --deck/--collection/--wanted flags scope which lists are loaded;
    // only the card-level flags act as search filters.
    const filters: PriceEntryFilters = {
      name: options.name,
      set: options.set,
      collector: options.collector,
    }
    const interactive = shouldRunInteractive(
      options,
      scriptingOptions,
      filters,
      process.stdout.isTTY === true,
    )

    let scope: ListLocation[] | undefined
    let openList: PriceListRef | undefined
    if (listName) {
      const resolved = await resolveList(listName, type)
      if (isResolveListError(resolved)) {
        emitResolveListError(resolved, scriptingOptions)
        return
      }
      openList = { type: resolved.type, name: resolved.name }
      // The browser needs every list for its main screen; a non-interactive
      // run only needs the one being printed.
      scope = interactive ? undefined : [resolved]
      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        console.log(
          `Pricing ${listTypeLabel(resolved.type)} "${resolved.name}"${interactive ? '' : '...'}`,
        )
      }
    }

    // Structured output must stay parseable, so never mix prompts into it.
    const freshness = await ensureFreshPriceData({
      cachePrompt: scriptingOptions.output === 'text' ? options.cachePrompt : false,
      refreshPrices: options.refreshPrices,
    })
    if (!freshness.ready) {
      emitError(
        'runtime_error',
        'The card cache is empty; prices are unavailable. Run `ritual cache preload-all` first.',
        scriptingOptions,
      )
      process.exitCode = ExitCode.RuntimeError
      return
    }

    try {
      const buildScoped = async (
        reportCurrency: PriceCurrency,
        locations?: ListLocation[],
      ): Promise<BuiltPriceReport> => {
        const { built, warnings } = await loadAndBuildPriceReport(type, locations, reportCurrency)
        if (scriptingOptions.output === 'text' && !scriptingOptions.quiet) {
          for (const warning of warnings) console.warn(`⚠️  ${warning}`)
        }
        return built
      }

      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        console.log('Calculating prices...')
      }
      const built = await buildScoped(currency, scope)

      if (interactive) {
        await runPriceBrowser({
          built,
          currency,
          lastRefreshedAt: freshness.lastRefreshedAt,
          rebuild: (nextCurrency) => buildScoped(nextCurrency),
          refreshPrices: refreshCardCache,
          getLastRefreshedAt: () => cardCache.getLastRefreshedAt(),
          openList,
        })
        return
      }

      const sort = options.sort ?? 'name'
      const descending = options.descending ?? false
      if (hasActiveFilters(filters)) {
        emitCardSearch(built, filters, currency, sort, descending, scriptingOptions)
        return
      }
      if (openList) {
        emitListDetail(built, openList.name, currency, sort, descending, scriptingOptions)
        return
      }
      emitSummary(built, freshness.lastRefreshedAt, scriptingOptions)
    } catch (e) {
      const message = getErrorMessage(e)
      emitError('runtime_error', message, scriptingOptions, e)
      process.exitCode = ExitCode.RuntimeError
    }
  })
}
