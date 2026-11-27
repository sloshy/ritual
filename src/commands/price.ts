import { Command } from 'commander'
import type { PriceSource } from '../pricing/price-source'
import { t } from '../i18n/t'
import { emptyCacheAdvice, ensureFreshPriceData, tryPreload } from '../cache/freshness'
import type { PriceCurrency } from '../pricing/price-currency'
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
  type PriceWarning,
} from '../pricing/price-report'
import {
  loadAndBuildPriceReport,
  pricesRefreshedAt,
  type LoadedPriceReport,
} from '../pricing/price-runtime'
import { isResolveListError, resolveList, type ListLocation } from '../list/resolve-list'
import { listIdentityOf } from '../list/list-info'
import { entriesOfList, findByListIdentity, type ListIdentity } from '../list/list-identity'
import { listsOfEntries } from '../cli/list-row-name'
import { listDisplayName } from '../list/list-lifecycle'
import { getDefaultPriceSource } from '../config/ritual-config'
import { refreshCardCache } from '../cache/refresh-source'
import {
  addRefreshOption,
  resolveRefreshMode,
  addScriptingOptions,
  addListScopeFlags,
  resolveListTypeFlag,
  parseEnumFlag,
  priceSourceFlagParser,
} from '../cli/options'
import type { RefreshMode } from '../cache/refresh'
import { isNoInput } from '../util/no-input'
import { formatEntryChoiceTitle, formatPriceLegend, runPriceBrowser } from './price-browser'
import { formatTotalsSegment } from '../cli/price-format'
import {
  emitError,
  emitOutput,
  emitMessageWarnings,
  emitResolveListError,
  installScriptingLogger,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import { fail, failWithMessage, runCommandAction } from '../cli/action'
import { isSyncMessage, renderSyncMessage, type SyncMessage } from '../sync/message'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import { cliPricingResolver } from '../cli/price-pricing'
import { isListsSummaryRefusal, summarizeLists, type ListsSummary } from '../summary/lists'
import { ExitCode } from '../util/errors'
import { COMMAND, CONFIG_KEY, FLAG, commandLine, flagValue } from '../util/cli-tokens'

type PriceCommandOptions = Partial<ScriptingOptions> & {
  deck?: boolean
  collection?: boolean
  wanted?: boolean
  source?: PriceSource
  name?: string
  set?: string
  collector?: string
  sort?: PriceSortField
  descending?: boolean
  refresh: RefreshMode
}

function parseSortFlag(value: string): PriceSortField {
  return parseEnumFlag(value, PRICE_SORT_FIELDS, FLAG.sort)
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
 * report mode) that didn't ask for a non-interactive view (card-search
 * filters).
 */
export function shouldRunInteractive(
  scriptingOptions: ScriptingOptions,
  filters: PriceEntryFilters,
  terminal: InteractiveTerminal,
): boolean {
  if (!terminal.stdinIsTTY || !terminal.stdoutIsTTY || terminal.noInput) return false
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

function emitListDetail(
  built: BuiltPriceReport,
  list: ListIdentity,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  warnings: PriceWarning[],
  scriptingOptions: ScriptingOptions,
): void {
  // Keyed by type + slug, never by name: a deck and a collection may share a
  // name, and the slug is what identifies the file.
  const summary = findByListIdentity(built.report.lists, list)
  // The run priced exactly this list, so its row is there unless the file
  // vanished mid-run — a failure, as the admin route's 404 is, never an
  // empty report.
  if (!summary) {
    fail(scriptingOptions, 'runtime_error', 'cli.price.listMissing', {
      type: list.listType,
      slug: list.slug,
    })
    return
  }
  const entries = sortedEntries(entriesOfList(built.report.entries, list), sort, descending)

  if (scriptingOptions.output === 'json') {
    const payload: PriceListDetailPayload = {
      source: built.report.source,
      currency,
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

  emitOutput(`[${summary.name}]`, scriptingOptions)
  for (const entry of entries) {
    emitOutput(`  ${formatEntryChoiceTitle(entry, currency)}`, scriptingOptions)
  }
  emitOutput('', scriptingOptions)
  emitOutput(
    t('cli.price.listFooter', {
      count: summary.cardCount,
      totals: formatTotalsSegment(summary, currency),
    }),
    scriptingOptions,
  )
  emitLegendAndDisclaimer(formatPriceLegend(entries, summary), scriptingOptions)
}

/**
 * The closing block of a text price view: the legend for the markers it showed,
 * then the condition disclaimer. Both explain rather than report, so `--quiet`
 * drops them.
 */
function emitLegendAndDisclaimer(
  legend: readonly string[],
  scriptingOptions: ScriptingOptions,
): void {
  if (scriptingOptions.quiet) return
  emitOutput('', scriptingOptions)
  for (const line of legend) emitOutput(line, scriptingOptions)
  emitOutput(t('cli.price.disclaimer'), scriptingOptions)
}

function emitCardSearch(
  built: BuiltPriceReport,
  filters: PriceEntryFilters,
  currency: PriceCurrency,
  sort: PriceSortField,
  descending: boolean,
  warnings: PriceWarning[],
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
      source: built.report.source,
      currency,
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

  const sources = listsOfEntries(matches)
  for (const entry of matches) {
    emitOutput(formatEntryChoiceTitle(entry, currency, sources), scriptingOptions)
  }
  emitOutput('', scriptingOptions)
  emitOutput(
    t('cli.price.searchFooter', {
      count: matches.length,
      totals: formatTotalsSegment(totals, currency),
    }),
    scriptingOptions,
  )
  emitLegendAndDisclaimer(formatPriceLegend(matches, totals), scriptingOptions)
}

export function registerPriceCommand(program: Command): void {
  addRefreshOption(
    addScriptingOptions(
      addListScopeFlags(
        program
          .command('price')
          .description(t('help.price.description'))
          .argument('[listName]', t('help.price.listArg')),
      )
        .option(
          '--source <store>',
          t('help.price.source', { configKey: CONFIG_KEY.defaultPriceSource }),
          priceSourceFlagParser(FLAG.source),
        )
        .option('--name <terms>', t('help.price.name'))
        .option('--set <code>', t('help.price.set'))
        .option('--collector <number>', t('help.price.collector'))
        .option(
          '--sort <field>',
          t('help.price.sort', { fields: PRICE_SORT_FIELDS.join(', ') }),
          parseSortFlag,
        )
        .option('--descending', t('help.price.descending')),
      'text',
    ),
  ).action(async (listName: string | undefined, options: PriceCommandOptions) => {
    const scriptingOptions = normalizeScriptingOptions(options, 'text')
    // Pricing walks the card cache, which logs through getLogger() (cold-cache
    // fetches, blocklist additions). Those are info lines: keep them off stdout
    // so `--output json` stays parseable, and drop them under `--quiet`.
    installScriptingLogger(scriptingOptions)
    await runCommandAction(scriptingOptions, async () => {
      // A store names its own currency, so the store is the one choice: the
      // flag's, else the configured defaultPriceSource.
      const source = options.source ?? getDefaultPriceSource()

      const type = resolveListTypeFlag(options, scriptingOptions)
      if (type === 'conflict') return

      // The --deck/--collection/--wanted flags scope which lists are loaded;
      // only the card-level flags act as search filters.
      const filters: PriceEntryFilters = {
        name: options.name,
        set: options.set,
        collector: options.collector,
      }
      const interactive = shouldRunInteractive(scriptingOptions, filters, {
        stdinIsTTY: process.stdin.isTTY === true,
        stdoutIsTTY: process.stdout.isTTY === true,
        noInput: isNoInput(),
      })
      // With nothing to price and no browser to pick from, there is no report
      // to print: every list's totals are the cross-list summary's job.
      if (!listName && !interactive && !hasActiveFilters(filters)) {
        fail(scriptingOptions, 'usage_error', 'cli.price.needsTarget', {
          name: FLAG.name,
          set: FLAG.set,
          collector: FLAG.collector,
          command: commandLine(COMMAND.lists, FLAG.summary, flagValue(FLAG.source, '<store>')),
        })
        return
      }

      let scope: ListLocation[] | undefined
      let openList: ListIdentity | undefined
      if (listName) {
        const resolved = await resolveList(listName, type)
        if (isResolveListError(resolved)) {
          emitResolveListError(resolved, scriptingOptions, 'type-flags')
          return
        }
        openList = listIdentityOf(resolved)
        scope = [resolved]
        if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
          emitOutput(
            t('cli.price.pricingList', {
              type: resolved.type,
              // The display name, as the list heading below prints it.
              name: await listDisplayName(resolved.type, resolved.filePath),
              suffix: interactive ? '' : '...',
            }),
            scriptingOptions,
          )
        }
      }

      const refreshMode = resolveRefreshMode(options.refresh, scriptingOptions.output)
      const refreshPolicy = cliRefreshPolicy(refreshMode)
      const freshness = await ensureFreshPriceData(refreshPolicy)
      if (!freshness.ready) {
        emitError('runtime_error', emptyCacheAdvice(t('cli.price.emptyCache')), scriptingOptions)
        process.exitCode = ExitCode.RuntimeError
        return
      }

      const { pricingFor, refreshCardKingdom } = cliPricingResolver(refreshPolicy)

      const buildScoped = async (
        store: PriceSource,
        locations?: ListLocation[],
      ): Promise<LoadedPriceReport | SyncMessage> => {
        const pricing = await pricingFor(store)
        if (isSyncMessage(pricing)) return pricing
        return loadAndBuildPriceReport(type, locations, pricing, { refresh: refreshMode })
      }

      if (interactive) {
        // The main screen's rows are the cross-list summary's; the card screens
        // build the full report when first opened. The summary reports every
        // problem reading the lists, so the report's copies of them stay quiet.
        const summarize = async (store: PriceSource): Promise<ListsSummary | SyncMessage> => {
          const pricing = await pricingFor(store)
          if (isSyncMessage(pricing)) return pricing
          const summary = await summarizeLists({
            listType: type,
            priced: { pricing, refresh: refreshMode },
          })
          // Unreachable with these options; said as the refusal it is.
          if (isListsSummaryRefusal(summary)) return summary.reason
          emitMessageWarnings(summary.warnings, scriptingOptions)
          return summary
        }
        if (!scriptingOptions.quiet) emitOutput(t('cli.price.calculating'), scriptingOptions)
        const summary = await summarize(source)
        if (isSyncMessage(summary)) {
          failWithMessage(scriptingOptions, 'runtime_error', summary)
          return
        }
        // Resolved by the summary just now (and memoized): a refusal cannot recur.
        const initialPricing = await pricingFor(source)
        if (isSyncMessage(initialPricing)) {
          failWithMessage(scriptingOptions, 'runtime_error', initialPricing)
          return
        }
        await runPriceBrowser({
          summary,
          source,
          lastRefreshedAt: await pricesRefreshedAt(initialPricing),
          // The browser shows a refusal as a line of text, in the CLI's language.
          loadSummary: async (store) => {
            const result = await summarize(store)
            return isSyncMessage(result) ? renderSyncMessage(result) : result
          },
          loadReport: async (store) => {
            const result = await buildScoped(store)
            return isSyncMessage(result) ? renderSyncMessage(result) : result.built
          },
          refreshPrices: async (store) => {
            const failed = await tryPreload(refreshCardCache)
            if (failed) return renderSyncMessage(failed)
            // Card Kingdom's prices are its feed's, not the card cache's.
            if (store === 'cardkingdom') {
              const feedFailed = await refreshCardKingdom()
              if (feedFailed) return renderSyncMessage(feedFailed)
            }
            return { refreshed: true }
          },
          getLastRefreshedAt: async (store) => {
            const pricing = await pricingFor(store)
            return isSyncMessage(pricing) ? null : pricesRefreshedAt(pricing)
          },
          openList,
        })
        return
      }

      if (!scriptingOptions.quiet && scriptingOptions.output === 'text') {
        emitOutput(t('cli.price.calculating'), scriptingOptions)
      }
      const loadedReport = await buildScoped(source, scope)
      if (isSyncMessage(loadedReport)) {
        failWithMessage(scriptingOptions, 'runtime_error', loadedReport)
        return
      }
      const { built, warnings } = loadedReport
      // A skipped card line means the totals exclude cards: data loss, so it
      // always reaches stderr, while the structured payloads carry it too.
      emitMessageWarnings(warnings, scriptingOptions)
      const currency = built.report.currency

      const sort = options.sort ?? 'name'
      const descending = options.descending ?? false
      if (hasActiveFilters(filters)) {
        emitCardSearch(built, filters, currency, sort, descending, warnings, scriptingOptions)
        return
      }
      if (openList) {
        emitListDetail(built, openList, currency, sort, descending, warnings, scriptingOptions)
      }
    })
  })
}
