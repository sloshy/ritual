/**
 * The interactive browser behind the unified `price` command. The main screen
 * shows every list with its totals (plus per-type and grand totals and the
 * price-cache age); from there the user can drill into a single list, search
 * every list at once, refresh prices, or switch currency.
 *
 * Following the card-session convention, the prompt loops are thin shells over
 * exported pure functions (header/choice/detail formatters and the suggest
 * filter) so the menu logic is unit-testable without driving a terminal.
 */

import type { Choice } from 'prompts'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import { LIST_TYPE_DISPLAY, LIST_TYPES, listTypeTitle, type ListType } from '../list/list-type'
import { printingFinishes } from '../card/finish-condition'
import {
  formatPrice,
  formatPriceOrNA,
  getCardPriceForFinish,
  VALID_CURRENCIES,
  type PriceCurrency,
} from '../pricing/price-currency'
import {
  comparePricedEntries,
  filterPricedEntries,
  isByRuleUnpricedReason,
  isPriceSortField,
  PRICE_SORT_FIELDS,
  sumPricedEntries,
  UNRANKED_EDHREC,
  type BuiltPriceReport,
  type ListPriceSummary,
  type PriceEntryFilters,
  type PriceReport,
  type PricedEntry,
  type PriceSortField,
  type ByRuleUnpricedReason,
  type PriceTotals,
  type UnpricedReason,
} from '../pricing/price-report'
import type { ListLocation } from '../list/resolve-list'
import { comparePrintings } from '../scryfall'
import { formatDuration } from '../util/duration'
import type { ScryfallCard } from '../scryfall/types'
import { ask, promptTextFilter, suggestByTitleTerms } from '../cli/prompts'
import { dateTimeFormat } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { printingLabel } from '../card/card-line-tail'

/**
 * Message keys for the price browser's sort fields — keys rather than rendered
 * rows because this table is evaluated once at module load. Resolve with
 * {@link sortFieldLabel}.
 */
export const SORT_FIELD_LABELS = {
  name: 'domain.priceSort.name',
  price: 'domain.priceSort.price',
  lowest: 'domain.priceSort.lowest',
  set: 'domain.priceSort.set',
  cmc: 'domain.priceSort.cmc',
  edhrec: 'domain.priceSort.edhrec',
  quantity: 'domain.priceSort.quantity',
} as const satisfies Record<PriceSortField, MessageKey>

/** A price-browser sort field's name in the active UI locale. */
export function sortFieldLabel(field: PriceSortField): string {
  return t(SORT_FIELD_LABELS[field])
}

/** The active sort direction, worded for the browser's control rows. */
function directionLabel(descending: boolean): string {
  return descending ? t('cli.price.directionDescending') : t('cli.price.directionAscending')
}

/**
 * Why an entry has no price. Message keys, not rendered strings: this table is
 * built once at module load, so holding text would freeze every reason in
 * whatever locale happened to be active then.
 */
const UNPRICED_REASON = {
  'no-printings': 'cli.price.unpricedNoPrintings',
  'printing-not-found': 'cli.price.unpricedPrintingNotFound',
  'currency-unavailable': 'cli.price.unpricedCurrencyUnavailable',
  'finish-unpriced-in-currency': 'cli.price.unpricedFinishUnpriced',
  'no-price-data': 'cli.price.unpricedNoPriceData',
  proxy: 'cli.price.unpricedProxy',
  'custom-art': 'cli.price.unpricedCustomArt',
} as const satisfies Record<UnpricedReason, MessageKey>

/**
 * What stands in the price column for a card that has no price by rule. Message
 * keys for the same reason as {@link UNPRICED_REASON}; the wording is the short
 * uppercase marker the sites show, so a card reads the same in the browser as
 * on the page.
 */
const BY_RULE_MARKER = {
  proxy: 'cli.price.markerProxy',
  'custom-art': 'cli.price.markerCustomArt',
} as const satisfies Record<ByRuleUnpricedReason, MessageKey>

/**
 * An entry's price cell. A proxy or a custom-art card is marked rather than
 * shown as "N/A": the absence of a price is the answer there, not a gap in the
 * data. Custom art wins over the proxy label when both apply — the engine has
 * already decided that, so the cell just renders the reason it was given.
 */
function formatEntryPrice(entry: PricedEntry, amount: number, currency: PriceCurrency): string {
  if (isByRuleUnpricedReason(entry.unpricedReason)) return t(BY_RULE_MARKER[entry.unpricedReason])
  return formatPriceOrNA(amount, currency)
}

/** What the user picked on the main screen. */
export type PriceMainSelection =
  | { kind: 'open'; type: ListType; name: string }
  | { kind: 'search' }
  | { kind: 'refresh' }
  | { kind: 'currency' }
  | { kind: 'exit' }

/** Sort + filter state of a card browser screen; mutated as the user adjusts it. */
export type CardBrowserState = {
  sort: PriceSortField
  descending: boolean
  filters: PriceEntryFilters
}

export function createDefaultBrowserState(): CardBrowserState {
  return { sort: 'name', descending: false, filters: {} }
}

/** "Total $12.34 · Lowest $10.00 · 2 unpriced" (lowest/unpriced only when they add information). */
export function formatTotalsSegment(totals: PriceTotals, currency: PriceCurrency): string {
  const parts: string[] = [
    t('cli.price.totalsTotal', { price: formatPrice(totals.total, currency) }),
  ]
  if (totals.lowestTotal !== totals.total) {
    parts.push(t('cli.price.totalsLowest', { price: formatPrice(totals.lowestTotal, currency) }))
  }
  if (totals.unpricedCount > 0) {
    parts.push(t('cli.price.totalsUnpriced', { count: totals.unpricedCount }))
  }
  return parts.join(' · ')
}

/**
 * Date and time down to the second, in the active UI locale.
 *
 * The fields are spelled out rather than left to `Date.prototype.toLocaleString`
 * for two reasons: that method takes no explicit tag, and Bun resolves none from
 * the environment, so it would silently render US English on a German machine.
 */
function formatTimestamp(epochMs: number): string {
  return dateTimeFormat(currentLocale(), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).format(new Date(epochMs))
}

/** The main screen's at-a-glance header: cache age, per-type totals, grand total. */
export function formatReportHeaderLines(
  report: PriceReport,
  lastRefreshedAt: number | null,
  now: number,
): string[] {
  const updated =
    lastRefreshedAt === null
      ? t('cli.price.updatedUnknown')
      : t('cli.price.updatedAt', {
          timestamp: formatTimestamp(lastRefreshedAt),
          age: formatDuration(now - lastRefreshedAt),
        })
  const lines: string[] = [
    t('cli.price.headerUpdated', {
      updated,
      currency:
        report.source === 'cardkingdom'
          ? t('cli.price.currencyCardKingdom')
          : report.currency.toUpperCase(),
    }),
    '',
  ]
  for (const typeTotal of report.typeTotals) {
    const display = LIST_TYPE_DISPLAY[typeTotal.type]
    lines.push(
      t('cli.price.headerTypeTotals', {
        icon: display.icon,
        title: listTypeTitle(typeTotal.type),
        count: typeTotal.listCount,
        totals: formatTotalsSegment(typeTotal, report.currency),
      }),
    )
  }
  if (report.typeTotals.length > 1) {
    lines.push(
      t('cli.price.headerGrandTotals', {
        count: report.totals.listCount,
        totals: formatTotalsSegment(report.totals, report.currency),
      }),
    )
  }
  return lines
}

/** One list's menu row: icon, name, totals, unpriced badge, card count. */
export function formatListChoiceTitle(summary: ListPriceSummary, currency: PriceCurrency): string {
  return t('cli.price.listRow', {
    icon: LIST_TYPE_DISPLAY[summary.type].icon,
    name: summary.name,
    totals: formatTotalsSegment(summary, currency),
    count: summary.cardCount,
  })
}

/** The main screen menu: every list (grouped by type), then the global actions. */
export function buildMainMenuChoices(report: PriceReport): Choice[] {
  const listChoices = LIST_TYPES.flatMap((type) =>
    report.lists
      .filter((summary) => summary.type === type)
      .map(
        (summary): Choice => ({
          title: formatListChoiceTitle(summary, report.currency),
          value: {
            kind: 'open',
            type: summary.type,
            name: summary.name,
          } satisfies PriceMainSelection,
        }),
      ),
  )
  return [
    ...listChoices,
    { title: t('cli.price.menuSearch'), value: { kind: 'search' } satisfies PriceMainSelection },
    { title: t('cli.price.menuRefresh'), value: { kind: 'refresh' } satisfies PriceMainSelection },
    {
      title: t('cli.price.menuCurrency'),
      value: { kind: 'currency' } satisfies PriceMainSelection,
    },
    { title: t('cli.price.menuExit'), value: { kind: 'exit' } satisfies PriceMainSelection },
  ]
}

/** One card's browser row: qty, name, printing, finish, prices, source list. */
export function formatEntryChoiceTitle(
  entry: PricedEntry,
  currency: PriceCurrency,
  showSource: boolean,
): string {
  const qty = entry.quantity > 1 ? `${entry.quantity}x ` : ''
  const printing =
    entry.set && entry.collectorNumber
      ? ` (${printingLabel(entry.set, entry.collectorNumber)})${entry.pinned ? '' : '*'}`
      : ''
  const finish = entry.finish && entry.finish !== 'nonfoil' ? ` [${entry.finish}]` : ''
  const price = formatEntryPrice(entry, entry.price * entry.quantity, currency)
  const lowest =
    entry.lowest > 0 && entry.lowest !== entry.price
      ? ` · lowest ${formatPrice(entry.lowest * entry.quantity, currency)}`
      : ''
  const source = showSource ? ` · ${LIST_TYPE_DISPLAY[entry.listType].icon} ${entry.listName}` : ''
  return `${qty}${entry.name}${printing}${finish} — ${price}${lowest}${source}`
}

/** What the user picked in a card browser screen. */
export type CardBrowserSelection =
  | { kind: 'entry'; entry: PricedEntry }
  | { kind: 'sort' }
  | { kind: 'filter-set' }
  | { kind: 'filter-collector' }
  | { kind: 'filter-type' }
  | { kind: 'back' }

export type CardBrowserOptions = {
  /** Show each entry's source list (the global search view). */
  showSource: boolean
  /** Offer the list-type filter (the global search view). */
  withTypeFilter: boolean
}

/** Apply a browser state's filters and sort to the full entry set. */
export function visibleBrowserEntries(
  entries: PricedEntry[],
  state: CardBrowserState,
): PricedEntry[] {
  return filterPricedEntries(entries, state.filters).sort((a, b) =>
    comparePricedEntries(a, b, state.sort, state.descending),
  )
}

/** The card browser menu: sort/filter controls, Back, then the visible entries. */
export function buildCardBrowserChoices(
  visible: PricedEntry[],
  state: CardBrowserState,
  currency: PriceCurrency,
  options: CardBrowserOptions,
): Choice[] {
  const controls: Choice[] = [
    {
      title: t('cli.price.controlSort', {
        field: sortFieldLabel(state.sort),
        direction: directionLabel(state.descending),
      }),
      value: { kind: 'sort' } satisfies CardBrowserSelection,
    },
    {
      title: t('cli.price.controlSetFilter', {
        value: state.filters.set ? state.filters.set.toUpperCase() : t('cli.price.filterAll'),
      }),
      value: { kind: 'filter-set' } satisfies CardBrowserSelection,
    },
    {
      title: t('cli.price.controlCollectorFilter', {
        value: state.filters.collector ?? t('cli.price.filterAll'),
      }),
      value: { kind: 'filter-collector' } satisfies CardBrowserSelection,
    },
  ]
  if (options.withTypeFilter) {
    controls.push({
      title: t('cli.price.controlTypeFilter', {
        value: state.filters.type ? listTypeTitle(state.filters.type) : t('cli.price.filterAll'),
      }),
      value: { kind: 'filter-type' } satisfies CardBrowserSelection,
    })
  }
  controls.push({
    title: t('cli.price.menuBack'),
    value: { kind: 'back' } satisfies CardBrowserSelection,
  })
  return [
    ...controls,
    ...visible.map(
      (entry): Choice => ({
        title: formatEntryChoiceTitle(entry, currency, options.showSource),
        value: { kind: 'entry', entry } satisfies CardBrowserSelection,
      }),
    ),
  ]
}

/** The card detail block shown when an entry is selected. */
export function formatEntryDetailLines(entry: PricedEntry, currency: PriceCurrency): string[] {
  const printing =
    entry.set && entry.collectorNumber
      ? ` (${printingLabel(entry.set, entry.collectorNumber)})`
      : ''
  const finish = entry.finish ? ` [${entry.finish}]` : ''
  const display = LIST_TYPE_DISPLAY[entry.listType]
  const lines: string[] = [
    `${entry.name}${printing}${finish}`,
    t('cli.price.detailList', {
      icon: display.icon,
      name: entry.listName,
      section: entry.section,
    }),
  ]
  if (!entry.pinned && entry.set) {
    lines.push(t('cli.price.detailRepresentative'))
  }
  const unit = formatEntryPrice(entry, entry.price, currency)
  const lineTotal =
    entry.quantity > 1
      ? t('cli.price.detailLineTotal', {
          total: formatPrice(entry.price * entry.quantity, currency),
          count: entry.quantity,
        })
      : ''
  lines.push(t('cli.price.detailPrice', { price: unit, lineTotal }))
  if (entry.unpricedReason) {
    lines.push(t('cli.price.detailUnpriced', { reason: t(UNPRICED_REASON[entry.unpricedReason]) }))
  }
  if (entry.lowest > 0 && entry.lowest !== entry.price) {
    const lowestPrinting =
      entry.lowestSet && entry.lowestCollectorNumber
        ? ` (${printingLabel(entry.lowestSet, entry.lowestCollectorNumber)})${entry.lowestFinish ? ` [${entry.lowestFinish}]` : ''}`
        : ''
    lines.push(
      t('cli.price.detailLowest', {
        price: formatPrice(entry.lowest, currency),
        printing: lowestPrinting,
      }),
    )
  }
  if (entry.typeLine) {
    const rank =
      entry.edhrecRank < UNRANKED_EDHREC
        ? t('cli.price.detailEdhrec', { rank: entry.edhrecRank })
        : ''
    lines.push(t('cli.price.detailTypeLine', { typeLine: entry.typeLine, cmc: entry.cmc, rank }))
  }
  return lines
}

/** Per-printing price rows for the detail view's "all printings" listing. */
export function formatPrintingPriceLines(
  printings: ScryfallCard[],
  currency: PriceCurrency,
): string[] {
  const sorted = [...printings].sort(comparePrintings)
  return sorted.map((printing) => {
    // printingFinishes, not raw `printing.finishes`: a finish Ritual doesn't model
    // would otherwise be listed at the nonfoil price under its own name.
    const finishes = printingFinishes(printing)
      .map(
        (finish) =>
          `${formatPriceOrNA(getCardPriceForFinish(printing, finish, currency), currency)} ${finish}`,
      )
      .join(' · ')
    return `  ${printingLabel(printing.set, printing.collector_number)} (${printing.set_name}) — ${finishes}`
  })
}

// ── Interactive loops ───────────────────────────────────────────────

/** A list identified by type and display name (a ListLocation minus its file path). */
export type PriceListRef = Omit<ListLocation, 'filePath'>

/** Everything the browser needs from the command that launches it. */
export type PriceBrowserDeps = {
  built: BuiltPriceReport
  currency: PriceCurrency
  lastRefreshedAt: number | null
  /** Rebuild the report (rereading lists) in the given currency. */
  rebuild: (currency: PriceCurrency) => Promise<BuiltPriceReport>
  /** Redownload the bulk card cache (which carries prices). */
  refreshPrices: () => Promise<void>
  getLastRefreshedAt: () => Promise<number | null>
  /** Open directly into this list before showing the main screen. */
  openList?: PriceListRef
}

async function promptMainSelection(report: PriceReport): Promise<PriceMainSelection | undefined> {
  return ask<PriceMainSelection>({
    type: 'autocomplete',
    message: t('cli.price.promptMainMenu'),
    choices: buildMainMenuChoices(report),
    limit: 14,
    suggest: suggestByTitleTerms,
  })
}

async function promptSortChange(state: CardBrowserState): Promise<void> {
  const selection = await ask<PriceSortField | 'direction'>({
    type: 'select',
    message: t('cli.price.promptSortBy'),
    choices: [
      ...PRICE_SORT_FIELDS.map((field): Choice => {
        const label = sortFieldLabel(field)
        return {
          title: field === state.sort ? t('cli.price.sortFieldCurrent', { field: label }) : label,
          value: field,
        }
      }),
      {
        title: t('cli.price.sortToggleDirection', {
          direction: directionLabel(state.descending),
        }),
        value: 'direction',
      },
    ],
  })
  if (!selection) return
  if (selection === 'direction') {
    state.descending = !state.descending
    return
  }
  if (isPriceSortField(selection)) {
    // Re-picking the current field flips direction; picking a new one resets it.
    state.descending = selection === state.sort ? !state.descending : false
    state.sort = selection
  }
}

async function promptTypeFilter(current: ListType | undefined): Promise<ListType | undefined> {
  const selection = await ask<ListType | 'all'>({
    type: 'select',
    message: t('cli.price.promptTypeFilter'),
    choices: [
      {
        title:
          current === undefined
            ? t('cli.price.typeFilterAllCurrent')
            : t('cli.price.typeFilterAll'),
        value: 'all',
      },
      ...LIST_TYPES.map((type): Choice => {
        const icon = LIST_TYPE_DISPLAY[type].icon
        const title = listTypeTitle(type)
        return {
          title:
            type === current
              ? t('cli.price.typeFilterRowCurrent', { icon, title })
              : `${icon} ${title}`,
          value: type,
        }
      }),
    ],
  })
  if (selection === undefined) return current
  return selection === 'all' ? undefined : selection
}

async function showEntryDetail(
  entry: PricedEntry,
  currency: PriceCurrency,
  printingsByName: Map<string, ScryfallCard[]>,
): Promise<void> {
  console.log('')
  for (const line of formatEntryDetailLines(entry, currency)) console.log(line)
  console.log('')

  const printings = printingsByName.get(entry.name) ?? []
  const choices: Choice[] = []
  if (printings.length > 0) {
    choices.push({
      title: t('cli.price.allPrintings', { count: printings.length }),
      value: 'printings',
    })
  }
  choices.push({ title: t('cli.price.menuBack'), value: 'back' })
  const action = await ask<'back' | 'printings'>({ type: 'select', message: entry.name, choices })
  if (action === 'printings') {
    console.log('')
    for (const line of formatPrintingPriceLines(printings, currency)) console.log(line)
    console.log('')
  }
}

async function runCardBrowser(
  heading: string,
  entries: PricedEntry[],
  currency: PriceCurrency,
  printingsByName: Map<string, ScryfallCard[]>,
  options: CardBrowserOptions,
): Promise<void> {
  const state = createDefaultBrowserState()
  while (true) {
    const visible = visibleBrowserEntries(entries, state)
    console.log('')
    console.log(
      t('cli.price.browserHeading', {
        heading,
        totals: formatTotalsSegment(sumPricedEntries(visible), currency),
      }),
    )
    const selection = await ask<CardBrowserSelection>({
      type: 'autocomplete',
      message: t('cli.price.promptBrowser'),
      choices: buildCardBrowserChoices(visible, state, currency, options),
      limit: 15,
      suggest: suggestByTitleTerms,
    })
    if (!selection || selection.kind === 'back') return
    switch (selection.kind) {
      case 'entry':
        await showEntryDetail(selection.entry, currency, printingsByName)
        break
      case 'sort':
        await promptSortChange(state)
        break
      case 'filter-set':
        state.filters.set = await promptTextFilter(
          t('cli.price.promptSetFilter'),
          state.filters.set,
        )
        break
      case 'filter-collector':
        state.filters.collector = await promptTextFilter(
          t('cli.price.promptCollectorFilter'),
          state.filters.collector,
        )
        break
      case 'filter-type':
        state.filters.type = await promptTypeFilter(state.filters.type)
        break
    }
  }
}

async function promptCurrencyChange(current: PriceCurrency): Promise<PriceCurrency | undefined> {
  return ask<PriceCurrency>({
    type: 'select',
    message: t('cli.price.promptCurrency'),
    choices: VALID_CURRENCIES.map((currency): Choice => {
      const code = currency.toUpperCase()
      return {
        title: currency === current ? t('cli.price.currencyRowCurrent', { currency: code }) : code,
        value: currency,
      }
    }),
  })
}

/** Run the interactive price browser until the user exits. */
export async function runPriceBrowser(deps: PriceBrowserDeps): Promise<void> {
  let built = deps.built
  let currency = deps.currency
  let lastRefreshedAt = deps.lastRefreshedAt

  const openList = async (type: ListType, name: string): Promise<void> => {
    const listEntries = built.report.entries.filter(
      (entry) => entry.listType === type && entry.listName === name,
    )
    const icon = LIST_TYPE_DISPLAY[type].icon
    await runCardBrowser(`${icon} ${name}`, listEntries, currency, built.printingsByName, {
      showSource: false,
      withTypeFilter: false,
    })
  }

  if (deps.openList) {
    await openList(deps.openList.type, deps.openList.name)
  }

  while (true) {
    console.log('')
    for (const line of formatReportHeaderLines(built.report, lastRefreshedAt, Date.now())) {
      console.log(line)
    }
    console.log('')

    const selection = await promptMainSelection(built.report)
    if (!selection || selection.kind === 'exit') return

    switch (selection.kind) {
      case 'open':
        await openList(selection.type, selection.name)
        break
      case 'search':
        await runCardBrowser(
          t('cli.price.allCardsHeading'),
          built.report.entries,
          currency,
          built.printingsByName,
          {
            showSource: true,
            withTypeFilter: true,
          },
        )
        break
      case 'refresh':
        console.log(t('cli.price.refreshing'))
        await deps.refreshPrices()
        lastRefreshedAt = await deps.getLastRefreshedAt()
        built = await deps.rebuild(currency)
        break
      case 'currency': {
        const next = await promptCurrencyChange(currency)
        if (next && next !== currency) {
          currency = next
          built = await deps.rebuild(currency)
        }
        break
      }
    }
  }
}
