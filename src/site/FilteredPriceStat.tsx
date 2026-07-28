import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import type { PriceCurrency } from '../price-currency'
import { formatPrice } from '../price-currency'
import type { CardFiltersControl } from './useCardFilters'

type FilteredPriceStatProps = {
  /** Owns the visibility gate — `narrowingCount`, not `activeCount` (`hideExtras` is
   * active but never narrows `filterCards`'s result, so it must not show this stat). */
  filters: CardFiltersControl
  amount: number
  currency: PriceCurrency
}

/** The "· Filtered: $X" stat shown next to a list's Total, while a filter narrows it. */
export const FilteredPriceStat: Component<FilteredPriceStatProps> = (props) => (
  <Show when={props.filters.narrowingCount() > 0}>
    <span class="page-stats-label"> · Filtered: {formatPrice(props.amount, props.currency)}</span>
  </Show>
)
