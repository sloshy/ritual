import { createMemo } from 'solid-js'
import type { Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { type CardFilters, countActiveFilters, createDefaultCardFilters } from './card-filters'

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
  return {
    filters,
    update: (patch) => setFilters(patch),
    reset: () => setFilters(createDefaultCardFilters()),
    activeCount,
  }
}
