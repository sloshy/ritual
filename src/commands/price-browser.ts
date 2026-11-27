/**
 * The interactive browser behind the unified `price` command. The main screen
 * shows every list with its totals (plus per-type and grand totals and the
 * price-cache age); from there the user can drill into a single list, search
 * every list at once, refresh prices, or switch store (and with it, currency).
 *
 * Following the card-session convention, the prompt loops are thin shells over
 * exported pure functions (header/choice/detail formatters and the suggest
 * filter) so the menu logic is unit-testable without driving a terminal.
 */

import type { Choice } from 'prompts'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import { quantityRow } from '../cli/rows'
import { sectionDisplayName } from '../list/deck-format'
import { LIST_TYPE_DISPLAY, LIST_TYPES, listTypeTitle, type ListType } from '../list/list-type'
import { printingFinishes } from '../card/finish-condition'
import {
  formatPrice,
  formatFinishTaggedPrice,
  formatPriceOrNA,
  getCardPriceForFinish,
  type PriceCurrency,
} from '../pricing/price-currency'
import { UNRANKED_EDHREC } from '../card/card-printing'
import {
  comparePricedEntries,
  filterPricedEntries,
  isByRuleUnpricedReason,
  isPriceSortField,
  PRICE_SORT_FIELDS,
  sumPricedEntries,
  type BuiltPriceReport,
  type PriceEntryFilters,
  type PricedEntry,
  type PriceSortField,
  type ByRuleUnpricedReason,
  type PriceTotals,
  type UnpricedReason,
} from '../pricing/price-report'
import { comparePrintings } from '../scryfall'
import { errorMessage, renderSyncMessage } from '../sync/message'
import { isExpectedListReadFailure } from '../list/list-content'
import {
  entriesOfList,
  findByListIdentity,
  listInfoOfEntry,
  type ListIdentity,
  type ListInfo,
} from '../list/list-identity'
import { listRowName, listsOfEntries } from '../cli/list-row-name'
import {
  groupRowsByType,
  type ListsSummary,
  type ListsSummaryRow,
  type ListsSummaryTypeTotals,
} from '../summary/lists'
import {
  formatStoreLine,
  formatTotalsSegment,
  formatValueSegment,
  isEstimatedTotal,
  showsLowestTotal,
} from '../cli/price-format'
import type { ScryfallCard } from '../scryfall/types'
import { ask, promptTextFilter, suggestByTitleTerms } from '../cli/prompts'
import { printingLabel } from '../card/card-line-tail'
import {
  PRICE_SOURCE_LABELS,
  VALID_PRICE_SOURCES,
  sourceCurrency,
  type PriceSource,
} from '../pricing/price-source'

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
  | { kind: 'open'; list: ListIdentity }
  | { kind: 'search' }
  | { kind: 'refresh' }
  | { kind: 'store' }
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

/**
 * The legend printed under a price listing: one line per marker the listing
 * actually shows — the `*` after an unpinned printing, the per-line totals and
 * their trailing "lowest", the `~` of an estimated total and the "Lowest
 * possible" total — and nothing when it shows none of them.
 */
export function formatPriceLegend(
  entries: readonly PricedEntry[],
  totals: PriceTotals | undefined,
): string[] {
  const lines: string[] = []
  if (entries.some((entry) => entry.quantity > 1 || hasLowerPrinting(entry))) {
    lines.push(t('cli.price.legendLineTotals'))
  }
  if (entries.some(showsUnpinnedMarker)) lines.push(t('cli.price.legendUnpinned'))
  if (totals !== undefined && isEstimatedTotal(totals)) lines.push(t('cli.price.legendEstimate'))
  if (totals !== undefined && showsLowestTotal(totals)) {
    lines.push(t('cli.price.legendLowestTotal'))
  }
  return lines
}

/** Whether a row carries the trailing "lowest" note ({@link formatEntryChoiceTitle}). */
function hasLowerPrinting(entry: PricedEntry): boolean {
  return entry.lowest > 0 && entry.lowest !== entry.price
}

/** Whether a row's printing carries the `*` unpinned marker ({@link formatEntryChoiceTitle}). */
function showsUnpinnedMarker(entry: PricedEntry): boolean {
  return Boolean(entry.set && entry.collectorNumber) && !entry.pinned
}

/**
 * The main screen's at-a-glance header: cache age and store, per-type totals,
 * and a grand total when the lists span more than one type.
 */
export function formatSummaryHeaderLines(
  summary: ListsSummary,
  source: PriceSource,
  lastRefreshedAt: number | null,
  now: number,
): string[] {
  const currency = sourceCurrency(source)
  const lines: string[] = [formatStoreLine(source, lastRefreshedAt, now), '']
  // With one type the summary reports no per-type totals: the overall ones are that type's.
  const onlyType = summary.lists[0]?.listType
  const perType: ListsSummaryTypeTotals[] =
    summary.typeTotals ??
    (onlyType === undefined ? [] : [{ listType: onlyType, ...summary.totals }])
  for (const typeTotal of perType) {
    lines.push(
      t('cli.price.headerTypeTotals', {
        icon: LIST_TYPE_DISPLAY[typeTotal.listType].icon,
        title: listTypeTitle(typeTotal.listType),
        count: typeTotal.listCount,
        totals: formatValueSegment(typeTotal.value, currency),
      }),
    )
  }
  if (summary.typeTotals !== undefined) {
    lines.push(
      t('cli.price.headerGrandTotals', {
        count: summary.totals.listCount,
        totals: formatValueSegment(summary.totals.value, currency),
      }),
    )
  }
  return lines
}

/** One list's menu row: icon, name, totals, unpriced badge, card count. */
export function formatListChoiceTitle(
  row: ListsSummaryRow,
  currency: PriceCurrency,
  name: string = row.name,
): string {
  return t('cli.price.listRow', {
    icon: LIST_TYPE_DISPLAY[row.listType].icon,
    name,
    totals: formatValueSegment(row.value, currency),
    count: row.counts.cardCount,
  })
}

/** The main screen menu: every list (grouped by type), then the global actions. */
export function buildMainMenuChoices(summary: ListsSummary, currency: PriceCurrency): Choice[] {
  const listChoices = groupRowsByType(summary.lists).flatMap((group) =>
    group.rows.map((row): Choice => ({
      title: formatListChoiceTitle(row, currency, listRowName(row, summary.lists)),
      value: {
        kind: 'open',
        list: { listType: row.listType, slug: row.slug },
      } satisfies PriceMainSelection,
    })),
  )
  return [
    ...listChoices,
    { title: t('cli.price.menuSearch'), value: { kind: 'search' } satisfies PriceMainSelection },
    { title: t('cli.price.menuRefresh'), value: { kind: 'refresh' } satisfies PriceMainSelection },
    {
      title: t('cli.price.menuStore'),
      value: { kind: 'store' } satisfies PriceMainSelection,
    },
    { title: t('cli.price.menuExit'), value: { kind: 'exit' } satisfies PriceMainSelection },
  ]
}

/** One card's browser row: qty, name, printing, finish, prices, source list. */
export function formatEntryChoiceTitle(
  entry: PricedEntry,
  currency: PriceCurrency,
  sources?: readonly ListInfo[],
): string {
  const printing =
    entry.set && entry.collectorNumber
      ? ` (${printingLabel(entry.set, entry.collectorNumber)})${showsUnpinnedMarker(entry) ? '*' : ''}`
      : ''
  const finish = entry.finish && entry.finish !== 'nonfoil' ? ` [${entry.finish}]` : ''
  const price = formatEntryPrice(entry, entry.price * entry.quantity, currency)
  const lowest = hasLowerPrinting(entry)
    ? ` · ${t('cli.price.rowLowest', { price: formatPrice(entry.lowest * entry.quantity, currency) })}`
    : ''
  // `sources`: the lists the shown rows come from, so a title two of them
  // share gains its slug. Absent hides the column (a one-list view).
  const source = sources
    ? ` · ${LIST_TYPE_DISPLAY[entry.listType].icon} ${listRowName(listInfoOfEntry(entry), sources)}`
    : ''
  const item = `${entry.name}${printing}${finish} — ${price}${lowest}${source}`
  return quantityRow(entry.quantity, item)
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
        value: state.filters.listType
          ? listTypeTitle(state.filters.listType)
          : t('cli.price.filterAll'),
      }),
      value: { kind: 'filter-type' } satisfies CardBrowserSelection,
    })
  }
  controls.push({
    title: t('cli.price.menuBack'),
    value: { kind: 'back' } satisfies CardBrowserSelection,
  })
  const sources = options.showSource ? listsOfEntries(visible) : undefined
  return [
    ...controls,
    ...visible.map((entry): Choice => ({
      title: formatEntryChoiceTitle(entry, currency, sources),
      value: { kind: 'entry', entry } satisfies CardBrowserSelection,
    })),
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
      section: sectionDisplayName(entry.section),
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
  if (hasLowerPrinting(entry)) {
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
      .map((finish) =>
        formatFinishTaggedPrice(
          formatPriceOrNA(getCardPriceForFinish(printing, finish, currency), currency),
          finish,
        ),
      )
      .join(' · ')
    return `  ${printingLabel(printing.set, printing.collector_number)} (${printing.set_name}) — ${finishes}`
  })
}

// ── Interactive loops ───────────────────────────────────────────────

/**
 * Everything the browser needs from the command that launches it. The main
 * screen reads the cross-list summary; the card screens read the full price
 * report, built only when one is first opened (and again after the store or
 * the prices change), so a run that only looks at the totals prices each list
 * once.
 */
/** A price refresh that happened. */
export interface PricesRefreshed {
  refreshed: true
}

export type PriceBrowserDeps = {
  /** The summary the browser opens on, priced at `source`. */
  summary: ListsSummary
  source: PriceSource
  lastRefreshedAt: number | null
  /**
   * Re-summarize (rereading lists) at the given store, or the reason it cannot
   * be priced there (Card Kingdom with no feed to read).
   */
  loadSummary: (source: PriceSource) => Promise<ListsSummary | string>
  /** Build the full price report at the given store, or the reason it cannot be. */
  loadReport: (source: PriceSource) => Promise<BuiltPriceReport | string>
  /**
   * Refresh the prices `source` reads — the bulk card cache, and Card
   * Kingdom's feed when that is the store — or say why the refresh failed (a
   * download that did not happen), which keeps the screen as it was.
   */
  refreshPrices: (source: PriceSource) => Promise<PricesRefreshed | string>
  /** When the prices `source` reads were last refreshed (its feed's age for Card Kingdom). */
  getLastRefreshedAt: (source: PriceSource) => Promise<number | null>
  /** Open directly into this list before showing the main screen. */
  openList?: ListIdentity
}

async function promptMainSelection(
  summary: ListsSummary,
  currency: PriceCurrency,
): Promise<PriceMainSelection | undefined> {
  return ask<PriceMainSelection>({
    type: 'autocomplete',
    message: t('cli.price.promptMainMenu'),
    choices: buildMainMenuChoices(summary, currency),
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
    const totals = sumPricedEntries(visible)
    console.log('')
    console.log(
      t('cli.price.browserHeading', { heading, totals: formatTotalsSegment(totals, currency) }),
    )
    // The same legend the printed listing closes with, here above the rows it explains.
    for (const line of formatPriceLegend(visible, totals)) console.log(line)
    const selection = await ask<CardBrowserSelection>({
      type: 'autocomplete',
      message: t('cli.price.promptBrowser'),
      choices: buildCardBrowserChoices(visible, state, currency, options),
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
        state.filters.listType = await promptTypeFilter(state.filters.listType)
        break
    }
  }
}

/** The store switcher's rows: every store, its currency beside it, the current one marked. */
export function storeChoices(current: PriceSource): Choice[] {
  return VALID_PRICE_SOURCES.map((source): Choice => {
    const name = t(PRICE_SOURCE_LABELS[source])
    return {
      title: source === current ? t('cli.price.storeRowCurrent', { store: name }) : name,
      description: sourceCurrency(source).toUpperCase(),
      value: source,
    }
  })
}

async function promptStoreChange(current: PriceSource): Promise<PriceSource | undefined> {
  return ask<PriceSource>({
    type: 'select',
    message: t('cli.price.promptStore'),
    choices: storeChoices(current),
    initial: Math.max(0, VALID_PRICE_SOURCES.indexOf(current)),
  })
}

/**
 * What a browser step loaded, or `undefined` once the reason it could not be
 * had is said: a refusal the command worded (a store with no prices, a
 * download that failed), or a failure reading the lists (a file gone or broken
 * since the summary read it) that the summary would have tolerated — so the
 * main screen stays, rather than the session ending on a screen the menu
 * offered. Any other failure is a bug, and is rethrown.
 */
async function settle<T extends object>(loading: Promise<T | string>): Promise<T | undefined> {
  let loaded: T | string
  try {
    loaded = await loading
  } catch (error) {
    // Only a list the summary would have tolerated; anything else is a bug.
    if (!isExpectedListReadFailure(error)) throw error
    loaded = renderSyncMessage(errorMessage(error))
  }
  if (typeof loaded !== 'string') return loaded
  console.error(loaded)
  return undefined
}

/** Run the interactive price browser until the user exits. */
export async function runPriceBrowser(deps: PriceBrowserDeps): Promise<void> {
  let summary = deps.summary
  let source = deps.source
  let lastRefreshedAt = deps.lastRefreshedAt
  // The full report behind the card screens, at `source`; dropped whenever the
  // store or the prices change, and rebuilt on the next card screen.
  let report: BuiltPriceReport | undefined

  const fullReport = async (): Promise<BuiltPriceReport | undefined> => {
    if (report) return report
    const built = await settle(deps.loadReport(source))
    if (built === undefined) return undefined
    report = built
    return report
  }

  const openList = async (list: ListIdentity): Promise<void> => {
    const built = await fullReport()
    if (!built) return
    const row = findByListIdentity(summary.lists, list)
    const icon = LIST_TYPE_DISPLAY[list.listType].icon
    await runCardBrowser(
      `${icon} ${row ? listRowName(row, summary.lists) : list.slug}`,
      entriesOfList(built.report.entries, list),
      built.report.currency,
      built.printingsByName,
      {
        showSource: false,
        withTypeFilter: false,
      },
    )
  }

  /**
   * Re-summarize at `store`, and whether it worked: a store that cannot be
   * priced keeps the current screen.
   */
  const resummarize = async (store: PriceSource): Promise<void> => {
    const next = await settle(deps.loadSummary(store))
    if (next === undefined) return
    summary = next
    source = store
    report = undefined
    // The header's age moves only with the totals it describes.
    lastRefreshedAt = await deps.getLastRefreshedAt(store)
  }

  if (deps.openList) {
    await openList(deps.openList)
  }

  while (true) {
    console.log('')
    for (const line of formatSummaryHeaderLines(summary, source, lastRefreshedAt, Date.now())) {
      console.log(line)
    }
    console.log('')

    const selection = await promptMainSelection(summary, sourceCurrency(source))
    if (!selection || selection.kind === 'exit') return

    switch (selection.kind) {
      case 'open':
        await openList(selection.list)
        break
      case 'search': {
        const built = await fullReport()
        if (!built) break
        await runCardBrowser(
          t('cli.price.allCardsHeading'),
          built.report.entries,
          built.report.currency,
          built.printingsByName,
          {
            showSource: true,
            withTypeFilter: true,
          },
        )
        break
      }
      case 'refresh': {
        console.log(t('cli.price.refreshing'))
        // A download that failed leaves the prices — and the screen — as they were.
        if ((await settle(deps.refreshPrices(source))) === undefined) break
        // The prices changed under the report either way.
        report = undefined
        await resummarize(source)
        break
      }
      case 'store': {
        const next = await promptStoreChange(source)
        if (next && next !== source) await resummarize(next)
        break
      }
    }
  }
}
