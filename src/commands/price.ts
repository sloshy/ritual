import { Command } from 'commander'
import { cardCache } from '../cache'
import { detailBuylistContext, ensureCardKingdomFeed, loadEnsuredFeed } from '../cardkingdom'
import { VALID_PRICE_SOURCES, resolveSourceCurrency, type PriceSource } from '../price-source'
import { t } from '../i18n/t'
import { emptyCacheAdvice, ensureFreshPriceData } from '../cache/freshness'
import { parseCurrencyFlagOrError, type PriceCurrency } from '../price-currency'
import {
  filterPricedEntries,
  hasActiveFilters,
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
import { loadAndBuildPriceReport, type LoadedPriceReport } from '../price-runtime'
import type { CardKingdomPricing } from '../price-report'
import {
  isResolveListError,
  listTypeFromFlags,
  resolveList,
  type ListLocation,
} from '../resolve-list'
import { getDefaultCurrency } from '../ritual-config'
import { refreshCardCache } from '../cache/refresh-source'
import { addRefreshOption, resolveRefreshMode, type RefreshMode } from '../refresh'
import { isNoInput } from '../no-input'
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
  emitActionError,
  emitError,
  emitOutput,
  emitResolveListError,
  emitWarnings,
  ExitCode,
  installScriptingLogger,
  normalizeScriptingOptions,
  parseEnumFlag,
  type ScriptingOptions,
} from './scripting'

type PriceCommandOptions = Partial<ScriptingOptions> & {
  deck?: boolean
  collection?: boolean
  wanted?: boolean
  prices?: string
  source?: PriceSource
  name?: string
  set?: string
  collector?: string
  sort?: PriceSortField
  descending?: boolean
  summary?: boolean
  refresh: RefreshMode
}

function parseSortFlag(value: string): PriceSortField {
  return parseEnumFlag(value, PRICE_SORT_FIELDS, t('cli.price.fieldSort'))
}

function parseSourceFlag(value: string): PriceSource {
  return parseEnumFlag(value.toLowerCase(), VALID_PRICE_SOURCES, t('cli.price.fieldSource'))
}

/** The terminal facts the interactive-browser gate depends on. */
export type InteractiveTerminal = {
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  noInput: boolean
}

/**
 * The browser launches only for a plain-text run where interaction is
 * available (stdin and stdout are both terminals and `--no-input` isn't in
 * force — the browser prompts on stdin, so a piped stdin must fall back to
 * report mode) that didn't ask for a non-interactive view (summary or
 * card-search filters).
 */
export function shouldRunInteractive(
  options: PriceCommandOptions,
  scriptingOptions: ScriptingOptions,
  filters: PriceEntryFilters,
  terminal: InteractiveTerminal,
): boolean {
  if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY || terminal.noInput) return false
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
  warnings: string[],
  scriptingOptions: ScriptingOptions,
): void {
  const { report } = built
  if (scriptingOptions.output === 'json') {
    const payload: PriceSummaryPayload = {
      currency: report.currency,
      ...(report.source ? { source: report.source } : {}),
      lastRefreshedAt,
      lists: report.lists,
      typeTotals: report.typeTotals,
      totals: report.totals,
      warnings,
    }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(report.lists, scriptingOptions)
    return
  }

  for (const line of formatReportHeaderLines(report, lastRefreshedAt, Date.now())) {
    emitOutput(line, scriptingOptions)
  }
  emitOutput('', scriptingOptions)
  for (const summary of report.lists) {
    emitOutput(formatListChoiceTitle(summary, report.currency), scriptingOptions)
  }
  if (!scriptingOptions.quiet) {
    emitOutput('', scriptingOptions)
    emitOutput(t('cli.price.disclaimer'), scriptingOptions)
  }
}

function emitListDetail(
  built: BuiltPriceReport,
  listName: string,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  warnings: string[],
  scriptingOptions: ScriptingOptions,
): void {
  const summary = built.report.lists.find((list) => list.name === listName)
  const entries = sortedEntries(
    built.report.entries.filter((entry) => entry.listName === listName),
    sort,
    descending,
  )

  if (scriptingOptions.output === 'json') {
    const payload: PriceListDetailPayload = {
      currency,
      ...(built.report.source ? { source: built.report.source } : {}),
      list: summary,
      cards: entries,
      warnings,
    }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(entries, scriptingOptions)
    return
  }

  emitOutput(`[${listName}]`, scriptingOptions)
  for (const entry of entries) {
    emitOutput(`  ${formatEntryChoiceTitle(entry, currency, false)}`, scriptingOptions)
  }
  if (summary) {
    emitOutput('', scriptingOptions)
    emitOutput(
      t('cli.price.listFooter', {
        count: summary.cardCount,
        totals: formatTotalsSegment(summary, currency),
      }),
      scriptingOptions,
    )
  }
  if (!scriptingOptions.quiet) {
    emitOutput('', scriptingOptions)
    emitOutput(t('cli.price.disclaimer'), scriptingOptions)
  }
}

function emitCardSearch(
  built: BuiltPriceReport,
  filters: PriceEntryFilters,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  warnings: string[],
  scriptingOptions: ScriptingOptions,
): void {
  const matches = sortedEntries(
    filterPricedEntries(built.report.entries, filters),
    sort,
    descending,
  )
  const totals = sumPricedEntries(matches)

  if (scriptingOptions.output === 'json') {
    const payload: PriceCardSearchPayload = {
      currency,
      ...(built.report.source ? { source: built.report.source } : {}),
      filters,
      cards: matches,
      totals,
      warnings,
    }
    emitOutput(payload, scriptingOptions)
    return
  }
  if (scriptingOptions.output === 'ndjson') {
    emitOutput(matches, scriptingOptions)
    return
  }

  for (const entry of matches) {
    emitOutput(formatEntryChoiceTitle(entry, currency, true), scriptingOptions)
  }
  emitOutput('', scriptingOptions)
  emitOutput(
    t('cli.price.searchFooter', {
      count: matches.length,
      totals: formatTotalsSegment(totals, currency),
    }),
    scriptingOptions,
  )
}

export function registerPriceCommand(program: Command): void {
  addRefreshOption(
    addScriptingOptions(
      program
        .command('price')
        .description(t('help.price.description'))
        .argument('[listName]', t('help.price.listArg'))
        .option('--deck', t('help.price.deck'))
        .option('--collection', t('help.price.collection'))
        .option('--wanted', t('help.price.wanted'))
        .option('--prices <currency>', t('help.price.prices'))
        .option('--source <store>', t('help.price.source'), parseSourceFlag)
        .option('--name <terms>', t('help.price.name'))
        .option('--set <code>', t('help.price.set'))
        .option('--collector <number>', t('help.price.collector'))
        .option(
          '--sort <field>',
          t('help.price.sort', { fields: PRICE_SORT_FIELDS.join(', ') }),
          parseSortFlag,
        )
        .option('--descending', t('help.price.descending'))
        .option('--summary', t('help.price.summary')),
      'text',
    ),
  ).action(async (listName: string | undefined, options: PriceCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')
    // Pricing walks the card cache, which logs through getLogger() (cold-cache
    // fetches, blocklist additions). Those are info lines: keep them off stdout
    // so `--output json` stays parseable, and drop them under `--quiet`.
    installScriptingLogger(scriptingOptions)

    let currency = parseCurrencyFlagOrError(
      options.prices,
      emitError,
      scriptingOptions,
      ExitCode.UsageError,
      getDefaultCurrency(),
    )
    if (!currency) return

    // A source names its own currency (tcgplayer/cardkingdom → usd, cardmarket
    // → eur). An explicit --prices that disagrees is a usage error rather than
    // a silent override; an omitted one simply follows the source.
    const source = options.source
    if (source) {
      const resolved = resolveSourceCurrency(
        source,
        options.prices !== undefined ? currency : undefined,
      )
      if (!resolved.ok) {
        emitError(
          'usage_error',
          t('cli.price.sourceCurrencyConflict', {
            source,
            currency: resolved.implied.toUpperCase(),
          }),
          scriptingOptions,
        )
        process.exitCode = ExitCode.UsageError
        return
      }
      currency = resolved.currency
    }

    const type = listTypeFromFlags(options)
    if (type === 'conflict') {
      emitError(
        'usage_error',
        t('cli.listScope.oneTypeFlag'),
        scriptingOptions,
        undefined,
        'cli.listScope.oneTypeFlag',
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
    const interactive = shouldRunInteractive(options, scriptingOptions, filters, {
      stdinIsTTY: process.stdin.isTTY === true,
      stdoutIsTTY: process.stdout.isTTY === true,
      noInput: isNoInput(),
    })

    let scope: ListLocation[] | undefined
    let openList: PriceListRef | undefined
    if (listName) {
      const resolved = await resolveList(listName, type)
      if (isResolveListError(resolved)) {
        emitResolveListError(resolved, scriptingOptions, 'type-flags')
        return
      }
      openList = { type: resolved.type, name: resolved.name }
      // The browser needs every list for its main screen; a non-interactive
      // run only needs the one being printed.
      scope = interactive ? undefined : [resolved]
      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        emitOutput(
          t('cli.price.pricingList', {
            type: resolved.type,
            name: resolved.name,
            suffix: interactive ? '' : '...',
          }),
          scriptingOptions,
        )
      }
    }

    const refreshMode = resolveRefreshMode(options.refresh, scriptingOptions.output)
    const freshness = await ensureFreshPriceData(refreshMode)
    if (!freshness.ready) {
      emitError('runtime_error', emptyCacheAdvice(t('cli.price.emptyCache')), scriptingOptions)
      process.exitCode = ExitCode.RuntimeError
      return
    }

    // Card Kingdom retail prices come from the buylist pricelist feed, under
    // this run's --refresh policy exactly like the card cache above. No feed,
    // no report: falling back to Scryfall would silently answer with a
    // different store's prices.
    let cardKingdom: CardKingdomPricing | undefined
    if (source === 'cardkingdom') {
      const feed = await ensureCardKingdomFeed(refreshMode)
      if (typeof feed === 'string') {
        emitError('runtime_error', feed, scriptingOptions)
        process.exitCode = ExitCode.RuntimeError
        return
      }
      const loaded = await loadEnsuredFeed(feed)
      cardKingdom = { quote: detailBuylistContext(loaded).quote }
    }

    try {
      const buildScoped = async (
        reportCurrency: PriceCurrency,
        locations?: ListLocation[],
      ): Promise<LoadedPriceReport> => {
        const result = await loadAndBuildPriceReport(type, locations, reportCurrency, {
          refresh: refreshMode,
          // The interactive browser's currency switcher passes other
          // currencies through here; the CK feed only quotes USD, so any other
          // currency reads Scryfall and switching back to USD reads CK again.
          ...(cardKingdom && reportCurrency === 'usd' ? { cardKingdom } : {}),
        })
        // A skipped card line means the totals exclude cards. That is data
        // loss, so it always reaches stderr — in every output mode and under
        // --quiet — while the structured payloads also carry `warnings`.
        emitWarnings(
          result.warnings.map((warning) => `⚠️  ${warning}`),
          scriptingOptions,
          { essential: true },
        )
        return result
      }

      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        emitOutput(t('cli.price.calculating'), scriptingOptions)
      }
      const { built, warnings } = await buildScoped(currency, scope)

      if (interactive) {
        await runPriceBrowser({
          built,
          currency,
          lastRefreshedAt: freshness.lastRefreshedAt,
          rebuild: (nextCurrency) => buildScoped(nextCurrency).then((result) => result.built),
          refreshPrices: refreshCardCache,
          getLastRefreshedAt: () => cardCache.getLastRefreshedAt(),
          openList,
        })
        return
      }

      const sort = options.sort ?? 'name'
      const descending = options.descending ?? false
      if (hasActiveFilters(filters)) {
        emitCardSearch(built, filters, currency, sort, descending, warnings, scriptingOptions)
        return
      }
      if (openList) {
        emitListDetail(built, openList.name, currency, sort, descending, warnings, scriptingOptions)
        return
      }
      emitSummary(built, freshness.lastRefreshedAt, warnings, scriptingOptions)
    } catch (e) {
      // A `… | head` broken pipe is a normal end of output, not a runtime
      // failure — emitActionError keeps those apart.
      emitActionError(e, scriptingOptions)
    }
  })
}
