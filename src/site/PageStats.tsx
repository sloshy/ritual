import type { Component, JSX } from 'solid-js'
import { Show } from 'solid-js'
import type { PriceCurrency } from '../pricing/price-currency'
import { formatPrice } from '../pricing/price-currency'
import { BUYLIST_CURRENCY } from '../buylist'
import { buylistError } from '../list-view/buylist-quotes'
import { activeUsdSource, pricesEnabled } from '../list-view/price-view'
import { isEmptySellSummary, sellShortfallNote, type SellValueSummary } from './sell-value'
import type { CardFiltersControl } from './useCardFilters'
import { useT } from '../ui/i18n'

type PageStatProps = {
  /** Whether this stat contributes to the line at all. */
  when: boolean
  label: string
  children: JSX.Element
}

/**
 * One ` · Label: value` stat in a list page's `.page-stats` line. Every stat
 * after the always-present total goes through this, so the separator and
 * markup can never drift between the four list pages.
 */
const PageStat: Component<PageStatProps> = (props) => (
  <Show when={props.when}>
    <span class="page-stats-label">
      {' · '}
      {props.label}: {props.children}
    </span>
  </Show>
)

type FilteredPriceStatProps = {
  /** Owns the visibility gate — `narrowingCount`, not `activeCount` (`hideExtras` is
   * active but never narrows `filterCards`'s result, so it must not show this stat). */
  filters: CardFiltersControl
  amount: number
  currency: PriceCurrency
}

/** The "· Filtered: $X" stat shown next to a list's Total, while a filter narrows it. */
const FilteredPriceStat: Component<FilteredPriceStatProps> = (props) => {
  const t = useT()
  return (
    <PageStat
      when={pricesEnabled() && props.filters.narrowingCount() > 0}
      label={t('site.stats.filtered')}
    >
      {formatPrice(props.amount, props.currency)}
    </PageStat>
  )
}

type SelectedPriceStatProps = {
  /** Selected copies on this page; the stat hides itself when nothing is selected. */
  count: number
  amount: number
  currency: PriceCurrency
}

/**
 * The "· Selected: $X" stat. Independent of sell mode — knowing what a handful
 * of picked cards is worth is useful whether or not you are selling them.
 */
const SelectedPriceStat: Component<SelectedPriceStatProps> = (props) => {
  const t = useT()
  return (
    <PageStat when={pricesEnabled() && props.count > 0} label={t('site.stats.selected')}>
      {formatPrice(props.amount, props.currency)}
    </PageStat>
  )
}

type SellSummaryStatProps = {
  /** Whether sell mode is on; the stat is hidden entirely otherwise. */
  sellMode: boolean
  /** Which of the two buylist stats this is. */
  label: 'site.stats.buylistTotal' | 'site.stats.sellValue'
  summary: SellValueSummary
}

/**
 * A `Label: $X (2 cards not on buylist)` money stat read off a
 * {@link SellValueSummary} — the page's "Buylist total" or the selection's
 * "Sell value", which differ only in their label and in the cards summarized.
 *
 * Always the buyer's own currency (USD cash), never the page's display
 * currency, so it is formatted with {@link BUYLIST_CURRENCY} rather than the
 * currency beside it. It hides itself on a summary covering nothing, rather
 * than taking a card count beside the summary it would have to agree with.
 */
export const SellSummaryStat: Component<SellSummaryStatProps> = (props) => {
  const t = useT()
  return (
    <PageStat when={props.sellMode && !isEmptySellSummary(props.summary)} label={t(props.label)}>
      {formatPrice(props.summary.value, BUYLIST_CURRENCY)}
      <Show when={sellShortfallNote(props.summary)}>
        {(note) => <span class="page-stats-note"> {note()}</span>}
      </Show>
    </PageStat>
  )
}

type ListPageStatsProps = {
  /** Owns the "Filtered" stat's visibility gate. */
  filters: CardFiltersControl
  /** The page's display currency; the buylist stats do not use it. */
  currency: PriceCurrency
  filteredAmount: number
  selectedCount: number
  selectedAmount: number
  /** Whether sell mode is on; both buylist stats are hidden otherwise. */
  sellMode: boolean
  /** What the buyer would pay for the cards the page is showing. */
  buylistSummary: SellValueSummary
  /** What the buyer would pay for the selection — a set that is *not* nested in
   * the page's, since a selection survives the filter that hides it. */
  selectionSummary: SellValueSummary
}

/**
 * Every stat a list page's header carries after its own always-present total,
 * in one place: their order is an invariant of the line, and four pages each
 * holding a copy of it is where the next stat drifts.
 */
export const ListPageStats: Component<ListPageStatsProps> = (props) => (
  <>
    <FilteredPriceStat
      filters={props.filters}
      amount={props.filteredAmount}
      currency={props.currency}
    />
    <SellSummaryStat
      sellMode={props.sellMode}
      label="site.stats.buylistTotal"
      summary={props.buylistSummary}
    />
    <SelectedPriceStat
      count={props.selectedCount}
      amount={props.selectedAmount}
      currency={props.currency}
    />
    <SellSummaryStat
      sellMode={props.sellMode}
      label="site.stats.sellValue"
      summary={props.selectionSummary}
    />
  </>
)

type PageCountAndTotalProps = {
  /** Card entries the page holds (the always-present lead stat). */
  count: number
  /** The page's total in its display currency. */
  total: number
  currency: PriceCurrency
}

/**
 * The always-present lead of a list page's `.page-stats` line: "N cards ·
 * Total: $X", degrading to the bare count when the site displays no prices.
 * One component rather than three page-local ternaries, so the fourth list
 * page cannot forget the prices-off branch.
 */
export const PageCountAndTotal: Component<PageCountAndTotalProps> = (props) => {
  const t = useT()
  return (
    <>
      {pricesEnabled()
        ? t('site.stats.cardsAndTotal', {
            count: props.count,
            amount: formatPrice(props.total, props.currency),
          })
        : t('domain.count.cards', { count: props.count })}
    </>
  )
}

type SellModeNoticeProps = {
  /** Whether sell mode is on; the notice is hidden entirely otherwise. */
  sellMode: boolean
}

/**
 * Why sell mode is showing no prices. Without this a site whose buylist has
 * never been downloaded gives the user a toggle that appears to do nothing —
 * the single most likely first-run state, and the one with a clear remedy.
 * The Card Kingdom price view reads the same quotes, so it surfaces the same
 * explanation even with sell mode off — an all-N/A page needs a reason too.
 */
export const SellModeNotice: Component<SellModeNoticeProps> = (props) => {
  const t = useT()
  return (
    <Show when={props.sellMode || activeUsdSource() === 'cardkingdom' ? buylistError() : null}>
      {(reason) => (
        <p class="page-stats-warning" role="status">
          {t('site.stats.buylistUnavailable', { reason: reason() })}
        </p>
      )}
    </Show>
  )
}
