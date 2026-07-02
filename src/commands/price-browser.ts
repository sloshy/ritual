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
import { LIST_TYPE_DISPLAY, LIST_TYPES, type ListType } from '../list-type'
import {
  formatPrice,
  formatPriceOrNA,
  getCardPriceForFinish,
  VALID_CURRENCIES,
  type PriceCurrency,
} from '../price-currency'
import {
  comparePricedEntries,
  filterPricedEntries,
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
  type PriceTotals,
  type UnpricedReason,
} from '../price-report'
import type { ListLocation } from '../resolve-list'
import { comparePrintings } from '../scryfall'
import { formatDuration } from '../utils'
import { matchesAllTerms } from '../term-match'
import type { ScryfallCard } from '../types'
import { ask } from './prompts-helpers'

export const SORT_FIELD_LABELS: Record<PriceSortField, string> = {
  name: 'Name',
  price: 'Price',
  lowest: 'Lowest price',
  set: 'Set code',
  cmc: 'Mana value',
  edhrec: 'EDHREC rank',
  quantity: 'Quantity',
}

const UNPRICED_REASON_TEXT: Record<UnpricedReason, string> = {
  'no-printings': 'card not found in the local card database',
  'printing-not-found': 'printing not found in the card database',
  'currency-unavailable': 'not available in this currency’s game',
  'no-price-data': 'no price data for this printing',
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
  const parts: string[] = [`Total ${formatPrice(totals.total, currency)}`]
  if (totals.lowestTotal !== totals.total) {
    parts.push(`Lowest ${formatPrice(totals.lowestTotal, currency)}`)
  }
  if (totals.unpricedCount > 0) {
    parts.push(`${totals.unpricedCount} unpriced`)
  }
  return parts.join(' · ')
}

/** The main screen's at-a-glance header: cache age, per-type totals, grand total. */
export function formatReportHeaderLines(
  report: PriceReport,
  lastRefreshedAt: number | null,
  now: number,
): string[] {
  const updated =
    lastRefreshedAt === null
      ? 'unknown'
      : `${new Date(lastRefreshedAt).toLocaleString()} (${formatDuration(now - lastRefreshedAt)} ago)`
  const lines: string[] = [
    `💰 Prices last updated: ${updated} · Currency: ${report.currency.toUpperCase()}`,
    '',
  ]
  for (const typeTotal of report.typeTotals) {
    const display = LIST_TYPE_DISPLAY[typeTotal.type]
    lines.push(
      `${display.icon} ${display.label} (${typeTotal.listCount}) — ${formatTotalsSegment(typeTotal, report.currency)}`,
    )
  }
  if (report.typeTotals.length > 1) {
    lines.push(
      `💵 All lists (${report.totals.listCount}) — ${formatTotalsSegment(report.totals, report.currency)}`,
    )
  }
  return lines
}

/** One list's menu row: icon, name, totals, unpriced badge, card count. */
export function formatListChoiceTitle(summary: ListPriceSummary, currency: PriceCurrency): string {
  const icon = LIST_TYPE_DISPLAY[summary.type].icon
  return `${icon} ${summary.name} — ${formatTotalsSegment(summary, currency)} · ${summary.cardCount} cards`
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
    { title: '🔎 Search all cards', value: { kind: 'search' } satisfies PriceMainSelection },
    { title: '🔄 Refresh prices', value: { kind: 'refresh' } satisfies PriceMainSelection },
    { title: '💱 Change currency', value: { kind: 'currency' } satisfies PriceMainSelection },
    { title: '🚪 Exit', value: { kind: 'exit' } satisfies PriceMainSelection },
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
      ? ` (${entry.set.toUpperCase()}:${entry.collectorNumber})${entry.pinned ? '' : '*'}`
      : ''
  const finish = entry.finish && entry.finish !== 'nonfoil' ? ` [${entry.finish}]` : ''
  const price = formatPriceOrNA(entry.price * entry.quantity, currency)
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
  const direction = state.descending ? 'descending' : 'ascending'
  const controls: Choice[] = [
    {
      title: `↕️ Sort: ${SORT_FIELD_LABELS[state.sort]} (${direction})`,
      value: { kind: 'sort' } satisfies CardBrowserSelection,
    },
    {
      title: `🔤 Set code filter: ${state.filters.set ? state.filters.set.toUpperCase() : 'all'}`,
      value: { kind: 'filter-set' } satisfies CardBrowserSelection,
    },
    {
      title: `#️⃣ Collector number filter: ${state.filters.collector ?? 'all'}`,
      value: { kind: 'filter-collector' } satisfies CardBrowserSelection,
    },
  ]
  if (options.withTypeFilter) {
    controls.push({
      title: `🗂️ List type filter: ${state.filters.type ? LIST_TYPE_DISPLAY[state.filters.type].label : 'all'}`,
      value: { kind: 'filter-type' } satisfies CardBrowserSelection,
    })
  }
  controls.push({ title: '← Back', value: { kind: 'back' } satisfies CardBrowserSelection })
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

/**
 * The autocomplete filter for browser menus: every space-separated term must
 * appear in the row (so typing a name, set code, or collector number narrows
 * the view). An empty input shows everything.
 */
export function suggestBrowserChoices(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices
  return choices.filter((choice) => matchesAllTerms(choice.title, input))
}

/** The card detail block shown when an entry is selected. */
export function formatEntryDetailLines(entry: PricedEntry, currency: PriceCurrency): string[] {
  const printing =
    entry.set && entry.collectorNumber
      ? ` (${entry.set.toUpperCase()}:${entry.collectorNumber})`
      : ''
  const finish = entry.finish ? ` [${entry.finish}]` : ''
  const display = LIST_TYPE_DISPLAY[entry.listType]
  const lines: string[] = [
    `${entry.name}${printing}${finish}`,
    `  List: ${display.icon} ${entry.listName} (${entry.section})`,
  ]
  if (!entry.pinned && entry.set) {
    lines.push('  Printing shown is representative — the entry does not pin one.')
  }
  const unit = formatPriceOrNA(entry.price, currency)
  const lineTotal =
    entry.quantity > 1
      ? ` · ${formatPrice(entry.price * entry.quantity, currency)} for ${entry.quantity}`
      : ''
  lines.push(`  Price: ${unit}${lineTotal}`)
  if (entry.unpricedReason) {
    lines.push(`  Unpriced: ${UNPRICED_REASON_TEXT[entry.unpricedReason]}`)
  }
  if (entry.lowest > 0 && entry.lowest !== entry.price) {
    const lowestPrinting =
      entry.lowestSet && entry.lowestCollectorNumber
        ? ` (${entry.lowestSet.toUpperCase()}:${entry.lowestCollectorNumber})${entry.lowestFinish ? ` [${entry.lowestFinish}]` : ''}`
        : ''
    lines.push(`  Lowest: ${formatPrice(entry.lowest, currency)}${lowestPrinting}`)
  }
  if (entry.typeLine) {
    const rank = entry.edhrecRank < UNRANKED_EDHREC ? ` · EDHREC #${entry.edhrecRank}` : ''
    lines.push(`  ${entry.typeLine} · Mana value ${entry.cmc}${rank}`)
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
    const finishes = printing.finishes
      .map(
        (finish) =>
          `${formatPriceOrNA(getCardPriceForFinish(printing, finish, currency), currency)} ${finish}`,
      )
      .join(' · ')
    return `  ${printing.set.toUpperCase()}:${printing.collector_number} (${printing.set_name}) — ${finishes}`
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
    message: 'Select a list to browse',
    choices: buildMainMenuChoices(report),
    limit: 14,
    suggest: async (rawInput: string, choices: Choice[]) =>
      suggestBrowserChoices(String(rawInput), choices),
  })
}

async function promptSortChange(state: CardBrowserState): Promise<void> {
  const selection = await ask<PriceSortField | 'direction'>({
    type: 'select',
    message: 'Sort by',
    choices: [
      ...PRICE_SORT_FIELDS.map((field) => ({
        title: `${SORT_FIELD_LABELS[field]}${field === state.sort ? ' (current)' : ''}`,
        value: field,
      })),
      {
        title: `Toggle direction (currently ${state.descending ? 'descending' : 'ascending'})`,
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

async function promptTextFilter(
  message: string,
  current: string | undefined,
): Promise<string | undefined> {
  const value = await ask<string>({ type: 'text', message, initial: current ?? '' })
  if (value === undefined) return current
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function promptTypeFilter(current: ListType | undefined): Promise<ListType | undefined> {
  const selection = await ask<ListType | 'all'>({
    type: 'select',
    message: 'Show cards from',
    choices: [
      { title: `All list types${current === undefined ? ' (current)' : ''}`, value: 'all' },
      ...LIST_TYPES.map((type) => ({
        title: `${LIST_TYPE_DISPLAY[type].icon} ${LIST_TYPE_DISPLAY[type].label}${type === current ? ' (current)' : ''}`,
        value: type,
      })),
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
  const choices: Choice[] = [{ title: '← Back', value: 'back' }]
  if (printings.length > 0) {
    choices.push({ title: `📜 All printings & prices (${printings.length})`, value: 'printings' })
  }
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
    console.log(`${heading} — ${formatTotalsSegment(sumPricedEntries(visible), currency)}`)
    const selection = await ask<CardBrowserSelection>({
      type: 'autocomplete',
      message: 'Type to filter by name, set, or collector number',
      choices: buildCardBrowserChoices(visible, state, currency, options),
      limit: 15,
      suggest: async (rawInput: string, choices: Choice[]) =>
        suggestBrowserChoices(String(rawInput), choices),
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
        state.filters.set = await promptTextFilter('Set code (empty for all)', state.filters.set)
        break
      case 'filter-collector':
        state.filters.collector = await promptTextFilter(
          'Collector number (empty for all)',
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
    message: 'Price currency',
    choices: VALID_CURRENCIES.map((currency) => ({
      title: `${currency.toUpperCase()}${currency === current ? ' (current)' : ''}`,
      value: currency,
    })),
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
          '🔎 All cards',
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
        console.log('Refreshing prices from Scryfall...')
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
