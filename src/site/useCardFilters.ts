import { batch, createEffect, createMemo, createSignal, on } from 'solid-js'
import type { Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import {
  type CardFilters,
  countActiveFilters,
  countNarrowingFilters,
  createDefaultCardFilters,
} from './card-filters'
import { currencyEpoch } from './currency-epoch'

export type CardFiltersControl = {
  /** Reactive filter values (SolidJS store proxy). */
  filters: CardFilters
  /** Merge a partial update into the filter state. */
  update: (patch: Partial<CardFilters>) => void
  /** Reset every filter to its default. */
  reset: () => void
  /**
   * Ticks on every {@link reset}. A debounced field observes it to drop a
   * commit still in flight, which a reset does not otherwise announce: clearing
   * a filter whose store value is already at its default changes nothing for
   * the field's own external-sync effect to see, and the pending value would
   * land a moment later and un-clear it. Fields inside the Filters panel are
   * reset directly by "Clear all"; this is how a field outside it hears.
   */
  resetEpoch: Accessor<number>
  /** Number of filters currently active; drives the toolbar badge. */
  activeCount: Accessor<number>
  /** Number of active filters that actually narrow `filterCards`'s result; drives the filtered-price stat. */
  narrowingCount: Accessor<number>
}

/** Shared toolbar filter state for the deck, collection, and wanted list pages. */
export function useCardFilters(): CardFiltersControl {
  const [filters, setFilters] = createStore<CardFilters>(createDefaultCardFilters())
  const [resetEpoch, setResetEpoch] = createSignal(0)
  const activeCount = createMemo(() => countActiveFilters(filters))
  const narrowingCount = createMemo(() => countNarrowingFilters(filters))

  // The price filter is a threshold in the active currency, so a switch to a
  // different currency makes it meaningless — clear it. `defer` skips the initial
  // run so a price filter restored from a shared URL survives page load.
  //
  // `buylistPrice` is deliberately NOT cleared here: a buyer's offer is always
  // USD whatever the page displays, so switching currency leaves that threshold
  // meaning exactly what it did before.
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
    reset: () =>
      batch(() => {
        setFilters(createDefaultCardFilters())
        setResetEpoch((n) => n + 1)
      }),
    resetEpoch,
    activeCount,
    narrowingCount,
  }
}
