import { createEffect, createMemo, on } from 'solid-js'
import type { Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { type CardFilters, countActiveFilters, createDefaultCardFilters } from './card-filters'
import { currencyEpoch } from './currency-epoch'

export type CardFiltersControl = {
  /** Reactive filter values (SolidJS store proxy). */
  filters: CardFilters
  /** Merge a partial update into the filter state. */
  update: (patch: Partial<CardFilters>) => void
  /** Reset every filter to its default. */
  reset: () => void
  /** Number of filters currently active; drives the toolbar badge. */
  activeCount: Accessor<number>
}

/** Shared toolbar filter state for the deck, collection, and wanted list pages. */
export function useCardFilters(): CardFiltersControl {
  const [filters, setFilters] = createStore<CardFilters>(createDefaultCardFilters())
  const activeCount = createMemo(() => countActiveFilters(filters))

  // The price filter is a threshold in the active currency, so a switch to a
  // different currency makes it meaningless — clear it. `defer` skips the initial
  // run so a price filter restored from a shared URL survives page load.
  createEffect(
    on(
      currencyEpoch,
      () => {
        if (filters.price !== null) setFilters({ price: null })
      },
      { defer: true },
    ),
  )

  return {
    filters,
    update: (patch) => setFilters(patch),
    reset: () => setFilters(createDefaultCardFilters()),
    activeCount,
  }
}
