import { Command } from 'commander'
import { compareData } from '../i18n/collate'
import { listIdentityOf, loadListInfos } from '../list/list-info'
import type { ListInfo } from '../list/list-identity'
import { LIST_TYPES, listTypeNoun, listTypeTitle, type ListType } from '../list/list-type'
import {
  isListArgumentsFailure,
  resolveListArguments,
  type ListTypeFlags,
} from '../list/resolve-list'
import {
  addRefreshOption,
  addScriptingOptions,
  parseEnumFlag,
  parsedFlag,
  priceSourceFlagParser,
  resolveListTypeFlag,
  resolveRefreshMode,
} from '../cli/options'
import {
  emitMessageWarnings,
  emitOutput,
  emitResolveListError,
  normalizeScriptingOptions,
  type ScriptingOptions,
} from '../cli/output'
import {
  fail,
  failWithError,
  failWithMessage,
  listArgumentConflictError,
  runCommandAction,
} from '../cli/action'
import { cliRefreshPolicy } from '../cli/refresh-policy'
import { cliPricingResolver } from '../cli/price-pricing'
import { formatStoreLine, formatValueSegment } from '../cli/price-format'
import { ensureFreshPriceData } from '../cache/freshness'
import type { RefreshMode } from '../cache/refresh'
import { CARD_LABELS, type CardLabel } from '../card/card-labels'
import { DECK_FORMAT_KEYS, type DeckFormatKey } from '../list/deck-format'
import type { PriceSource } from '../pricing/price-source'
import type { PriceCurrency } from '../pricing/price-currency'
import type { ReportPricing } from '../pricing/price-report'
import { pricesRefreshedAt } from '../pricing/price-runtime'
import {
  checkListsSummaryOptions,
  isListsSummaryRefusal,
  LISTS_SUMMARY_SORTS,
  summarizeLists,
  summaryPricing,
  type ListsSummaryOptions,
  type ListsSummaryPayload,
  type ListsSummarySort,
  type ListsSummaryTotals,
} from '../summary/lists'
import { isSyncMessage, syncMessage, type SyncMessage } from '../sync/message'
import { parsePositiveInteger } from '../util/parse-number'
import { FLAG, type FlagToken } from '../util/cli-tokens'
import { displayWidth, padEndDisplay, padStartDisplay } from '../i18n/width'
import { formatNumber } from '../ui/format'
import { t } from '../i18n/t'

/**
 * The options that only shape a summary, by commander key. `empty` is the
 * `--no-empty` flag's key.
 */
type SummaryOnlyOptions = {
  name?: string
  label?: CardLabel
  empty: boolean
  format?: DeckFormatKey
  section: string[]
  source?: PriceSource
  sort?: ListsSummarySort
  ascending?: boolean
  descending?: boolean
  limit?: number
  refresh: RefreshMode
}

/** What `lists` reads off commander. */
type ListsOptions = ListTypeFlags &
  Partial<ScriptingOptions> & { summary?: boolean } & SummaryOnlyOptions

/**
 * Each summary-only option with the flag a usage error names. Each is
 * meaningless without `--summary`, so giving one alone is refused rather than
 * read as a request for a summary: `--summary` changes the output's shape, and
 * a script's output should never change shape because of a filter. A full
 * record, so an option added to {@link SummaryOnlyOptions} without its flag
 * here is a compile error.
 */
const SUMMARY_ONLY_FLAGS: Record<keyof SummaryOnlyOptions, FlagToken> = {
  name: FLAG.name,
  label: FLAG.label,
  empty: FLAG.noEmpty,
  format: FLAG.format,
  section: FLAG.section,
  source: FLAG.source,
  sort: FLAG.sort,
  ascending: FLAG.ascending,
  descending: FLAG.descending,
  limit: FLAG.limit,
  refresh: FLAG.refresh,
}

function parseLimitFlag(raw: string): number | SyncMessage {
  return (
    parsePositiveInteger(raw.trim()) ??
    syncMessage('domain.list.summary.limitInvalid', { limit: raw })
  )
}

export function registerListsCommand(program: Command): void {
  addRefreshOption(
    addScriptingOptions(
      program
        .command('lists')
        .description(t('help.lists.description'))
        .argument('[lists...]', t('help.lists.lists', { flag: FLAG.summary }))
        .option('--deck', t('help.lists.deck'))
        .option('--collection', t('help.lists.collection'))
        .option('--wanted', t('help.lists.wanted'))
        .option('--summary', t('help.lists.summary'))
        .option('--name <terms>', t('help.lists.name', { flag: FLAG.summary }))
        .option(
          '--label <label>',
          t('help.lists.label', { labels: CARD_LABELS.join(', '), flag: FLAG.summary }),
          (value) => parseEnumFlag(value, CARD_LABELS, FLAG.label),
        )
        .option('--no-empty', t('help.lists.noEmpty', { flag: FLAG.summary }))
        .option('--format <format>', t('help.lists.format', { flag: FLAG.summary }), (value) =>
          parseEnumFlag(value, DECK_FORMAT_KEYS, FLAG.format),
        )
        .option(
          '--section <name>',
          t('help.lists.section', { flag: FLAG.summary }),
          (value: string, previous: string[]) => [...previous, value],
          [] as string[],
        )
        .option(
          '--source <store>',
          t('help.lists.source', { flag: FLAG.summary }),
          priceSourceFlagParser(FLAG.source),
        )
        .option(
          '--sort <field>',
          t('help.lists.sort', { fields: LISTS_SUMMARY_SORTS.join(', '), flag: FLAG.summary }),
          (value) => parseEnumFlag(value, LISTS_SUMMARY_SORTS, FLAG.sort),
        )
        .option('--ascending', t('help.lists.ascending', { flag: FLAG.summary }))
        .option('--descending', t('help.lists.descending', { flag: FLAG.summary }))
        .option(
          '--limit <n>',
          t('help.lists.limit', { flag: FLAG.summary }),
          parsedFlag(parseLimitFlag),
        ),
      'text',
    ),
  ).action(async (listArgs: string[], options: ListsOptions, command: Command) => {
    const scripting = normalizeScriptingOptions(options, 'text')
    await runCommandAction(scripting, async () => {
      const type = resolveListTypeFlag(options, scripting)
      if (type === 'conflict') return

      if (options.summary === true) {
        await runSummary(listArgs, options, type, scripting)
        return
      }

      const given = Object.entries(SUMMARY_ONLY_FLAGS)
        .filter(([key]) => command.getOptionValueSource(key) === 'cli')
        .map(([, flag]) => flag)
      if (listArgs.length > 0 || given.length > 0) {
        fail(scripting, 'usage_error', 'cli.lists.needsSummary', {
          summary: FLAG.summary,
          // Each a flag token, or the lists named — never prose.
          given: [...given, ...listArgs].join(', '),
        })
        return
      }

      const rows = sortListInfos(
        (await loadListInfos()).filter((row) => type === undefined || row.listType === type),
      )

      if (scripting.output === 'text') {
        if (rows.length === 0) {
          if (!scripting.quiet) emitOutput(t('cli.lists.empty'), scripting)
          return
        }
        for (const line of formatListsTable(rows)) emitOutput(line, scripting)
        return
      }

      emitOutput(rows, scripting)
    })
  })
}

/**
 * `lists --summary`: counts — and, with `--source`, value — across the
 * selected lists. Pricing follows `price`: the card cache's freshness and Card
 * Kingdom's feed go through the run's `--refresh` policy. Prices that cannot
 * be had are a warning beside the counts (an empty cache, no Card Kingdom
 * feed); the engine refuses only a `--sort value` they cannot honor, which is
 * a runtime error here, as it is a 503 on the admin route.
 */
async function runSummary(
  listArgs: readonly string[],
  options: ListsOptions,
  type: ListType | undefined,
  scripting: ScriptingOptions,
): Promise<void> {
  if (options.ascending === true && options.descending === true) {
    fail(scripting, 'usage_error', 'cli.lists.directionConflict', {
      ascending: FLAG.ascending,
      descending: FLAG.descending,
    })
    return
  }
  const selection: ListsSummaryOptions = { listType: type, includeEmpty: options.empty }
  if (listArgs.length > 0) {
    const resolved = await resolveListArguments([...listArgs], type)
    if (isListArgumentsFailure(resolved)) {
      if (resolved.kind === 'conflict') {
        failWithError(scripting, listArgumentConflictError(resolved.conflict))
      } else {
        emitResolveListError(resolved.error, scripting, 'type-prefix')
      }
      return
    }
    selection.lists = resolved.map(listIdentityOf)
  }
  if (options.name !== undefined) selection.nameContains = options.name
  if (options.label !== undefined) selection.label = options.label
  if (options.format !== undefined) selection.format = options.format
  if (options.section.length > 0) selection.sections = options.section
  if (options.sort !== undefined) selection.sort = options.sort
  // Neither flag keeps the sort's own default direction.
  if (options.ascending === true) selection.descending = false
  if (options.descending === true) selection.descending = true
  if (options.limit !== undefined) selection.limit = options.limit

  // A bad option is refused before anything is downloaded for the prices.
  const refused = checkListsSummaryOptions(selection, options.source !== undefined)
  if (refused) {
    failWithMessage(scripting, 'usage_error', refused.reason)
    return
  }

  let pricing: ReportPricing | SyncMessage | undefined
  if (options.source !== undefined) {
    const refreshMode = resolveRefreshMode(options.refresh, scripting.output)
    const policy = cliRefreshPolicy(refreshMode)
    // A cache that is still empty after this is the engine's to report: the
    // counts do not need it.
    await ensureFreshPriceData(policy)
    pricing = await cliPricingResolver(policy).pricingFor(options.source)
    selection.priced = summaryPricing(pricing, refreshMode)
  }

  const summary = await summarizeLists(selection)
  if (isListsSummaryRefusal(summary)) {
    const code = summary.refused === 'prices' ? 'runtime_error' : 'usage_error'
    failWithMessage(scripting, code, summary.reason)
    return
  }
  const payload: ListsSummaryPayload = { ...summary }
  if (summary.source !== undefined && pricing !== undefined && !isSyncMessage(pricing)) {
    payload.lastRefreshedAt = await pricesRefreshedAt(pricing)
  }

  // A list left out or a total short of a card is data loss, so it always
  // reaches stderr — in every output mode and under --quiet.
  emitMessageWarnings(summary.warnings, scripting)
  if (scripting.output === 'json') {
    emitOutput(payload, scripting)
    return
  }
  if (scripting.output === 'ndjson') {
    emitOutput(summary.lists, scripting)
    return
  }
  for (const line of formatListsSummaryLines(payload, Date.now())) emitOutput(line, scripting)
}

/**
 * Pad a table into lines, in terminal columns rather than code units (a list
 * name, or a translated heading, need not be ASCII). The columns in
 * `rightAligned` (the counts) pad on the left; the last column is never padded.
 */
function padTable(table: readonly string[][], rightAligned: ReadonlySet<number>): string[] {
  const widths = table[0]!.map((_, column) =>
    Math.max(...table.map((cells) => displayWidth(cells[column] ?? ''))),
  )
  return table.map((cells) =>
    cells
      .map((cell, column) => {
        const width = widths[column] ?? 0
        if (rightAligned.has(column)) return padStartDisplay(cell, width)
        return column === cells.length - 1 ? cell : padEndDisplay(cell, width)
      })
      .join('  '),
  )
}

/**
 * The text table: a heading row, then one row per list — type, display name,
 * and the file name only when some list's file name differs from its name
 * (otherwise the column would repeat the name). The type reads in the UI
 * language; JSON keeps the `deck` / `collection` / `wanted` token.
 */
export function formatListsTable(rows: readonly ListInfo[]): string[] {
  const showFile = rows.some((row) => row.slug !== row.name)
  return padTable(
    [
      [
        t('cli.lists.columnType'),
        t('cli.lists.columnName'),
        ...(showFile ? [t('cli.lists.columnFile')] : []),
      ],
      ...rows.map((row) => [listTypeNoun(row.listType), row.name, ...(showFile ? [row.slug] : [])]),
    ],
    new Set(),
  )
}

/**
 * The summary as text: when priced, the store line (store, currency, cache
 * age); then one row per list (type, name, the file name where it differs,
 * entries, cards, and value when priced); then the per-type totals and the
 * grand total — each a line of counts, its value after it when priced.
 */
export function formatListsSummaryLines(summary: ListsSummaryPayload, now: number): string[] {
  const { currency } = summary
  const lines: string[] = []
  if (summary.source !== undefined) {
    lines.push(formatStoreLine(summary.source, summary.lastRefreshedAt ?? null, now), '')
  }
  if (summary.lists.length === 0) {
    lines.push(t('cli.lists.empty'))
  } else {
    const showFile = summary.lists.some((row) => row.slug !== row.name)
    const heading = [
      t('cli.lists.columnType'),
      t('cli.lists.columnName'),
      ...(showFile ? [t('cli.lists.columnFile')] : []),
      t('cli.lists.columnEntries'),
      t('cli.lists.columnCards'),
      ...(currency === undefined ? [] : [t('cli.lists.columnValue')]),
    ]
    const firstCount = showFile ? 3 : 2
    const table = [
      heading,
      ...summary.lists.map((row) => [
        listTypeNoun(row.listType),
        row.name,
        ...(showFile ? [row.slug] : []),
        formatNumber(row.counts.entryCount),
        formatNumber(row.counts.cardCount),
        ...(currency === undefined ? [] : [formatValueSegment(row.value, currency)]),
      ]),
    ]
    lines.push(...padTable(table, new Set([firstCount, firstCount + 1])))
  }
  lines.push('')
  for (const typeTotal of summary.typeTotals ?? []) {
    lines.push(totalsLine(listTypeTitle(typeTotal.listType), typeTotal, currency))
  }
  lines.push(totalsLine(t('cli.lists.allLists'), summary.totals, currency))
  return lines
}

/** "Decks: 3 lists · 240 entries · 300 cards · 180 distinct cards · Total $12.00". */
function totalsLine(
  label: string,
  totals: ListsSummaryTotals,
  currency: PriceCurrency | undefined,
): string {
  const parts = [
    t('cli.lists.totalsLists', { count: totals.listCount }),
    t('cli.lists.totalsEntries', { count: totals.entryCount }),
    t('cli.lists.totalsCards', { count: totals.cardCount }),
    t('cli.lists.totalsDistinct', { count: totals.distinctCardCount }),
  ]
  if (currency !== undefined) parts.push(formatValueSegment(totals.value, currency))
  return t('cli.lists.totalsLine', { label, totals: parts.join(' · ') })
}

/** Deterministic display order: deck, collection, wanted — then slug within each type. */
function sortListInfos(rows: ListInfo[]): ListInfo[] {
  return rows.toSorted(
    (a, b) =>
      LIST_TYPES.indexOf(a.listType) - LIST_TYPES.indexOf(b.listType) ||
      compareData(a.slug, b.slug),
  )
}
