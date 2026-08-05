import type { Component, JSX } from 'solid-js'
import { Show } from 'solid-js'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import { buylistError } from './buylist-quotes'
import { BUYLIST_CURRENCY } from './card-sorting'
import { sellShortfallNote, type SellValueSummary } from './sell-value'
import type { CardFiltersControl } from './useCardFilters'

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
export const FilteredPriceStat: Component<FilteredPriceStatProps> = (props) => (
  <PageStat when={props.filters.narrowingCount() > 0} label="Filtered">
    {formatPrice(props.amount, props.currency)}
  </PageStat>
)

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
export const SelectedPriceStat: Component<SelectedPriceStatProps> = (props) => (
  <PageStat when={props.count > 0} label="Selected">
    {formatPrice(props.amount, props.currency)}
  </PageStat>
)

type SellValueStatProps = {
  /** Whether sell mode is on; the stat is hidden entirely otherwise. */
  sellMode: boolean
  /** Selected copies on this page; the stat hides itself when nothing is selected. */
  count: number
  summary: SellValueSummary
}

/**
 * The "· Sell value: $X (2 cards not on buylist)" stat: what the selected cards
 * are worth to the chosen buyer, capped at what they will actually take.
 * Always the buyer's own currency (USD cash), never the page's display
 * currency, so it is formatted with {@link BUYLIST_CURRENCY} rather than the
 * currency beside it.
 */
export const SellValueStat: Component<SellValueStatProps> = (props) => (
  <PageStat when={props.sellMode && props.count > 0} label="Sell value">
    {formatPrice(props.summary.value, BUYLIST_CURRENCY)}
    <Show when={sellShortfallNote(props.summary)}>
      {(note) => <span class="page-stats-note"> {note()}</span>}
    </Show>
  </PageStat>
)

type SellModeNoticeProps = {
  /** Whether sell mode is on; the notice is hidden entirely otherwise. */
  sellMode: boolean
}

/**
 * Why sell mode is showing no prices. Without this a site whose buylist has
 * never been downloaded gives the user a toggle that appears to do nothing —
 * the single most likely first-run state, and the one with a clear remedy.
 */
export const SellModeNotice: Component<SellModeNoticeProps> = (props) => (
  <Show when={props.sellMode ? buylistError() : null}>
    {(reason) => (
      <p class="page-stats-warning" role="status">
        Buylist prices are unavailable: {reason()}
      </p>
    )}
  </Show>
)
