import { createEffect } from 'solid-js'
import type { GroupBy } from './card-sorting'
import type { CardFiltersControl } from './useCardFilters'
import type { UseToolbarStateResult } from './useToolbarState'
import {
  type ListViewDefaults,
  type ListViewState,
  hasListViewParams,
  parseListViewParams,
  writeListViewParams,
} from './list-view-url'

export type UseListViewUrlSyncConfig<G extends GroupBy> = {
  toolbar: UseToolbarStateResult<G>
  filters: CardFiltersControl
  /** The page's effective default group/sort, so default values stay out of the URL. */
  defaults: ListViewDefaults
  /**
   * The group-by values this page actually offers. A URL group-by outside this set
   * (e.g. a deck link's `group=printing` pasted onto a collection) is ignored rather
   * than forced into a toolbar that has no such option.
   */
  groupByValues: readonly G[]
  /** When false, the hook is inert — used to limit URL sync to the public read view. */
  enabled?: boolean
}

function currentHashParams(): URLSearchParams {
  const hash = window.location.hash
  const qIdx = hash.indexOf('?')
  return new URLSearchParams(qIdx < 0 ? '' : hash.slice(qIdx + 1))
}

/** Replace the query portion of the current hash, preserving the path and foreign keys. */
function syncStateToUrl(state: ListViewState, defaults: ListViewDefaults): void {
  const hash = window.location.hash
  const qIdx = hash.indexOf('?')
  const base = qIdx < 0 ? hash : hash.slice(0, qIdx)
  const params = qIdx < 0 ? new URLSearchParams() : new URLSearchParams(hash.slice(qIdx + 1))
  writeListViewParams(params, state, defaults)
  const qs = params.toString()
  const nextHash = qs.length > 0 ? `${base}?${qs}` : base
  if (nextHash === hash) return
  const url = `${window.location.pathname}${window.location.search}${nextHash}`
  window.history.replaceState(window.history.state, '', url)
}

/**
 * Two-way sync between a list view's toolbar/filter state and the URL query string.
 * On construction it applies any parameters present in the URL; thereafter it mirrors
 * state changes back into the URL via `history.replaceState` (no new history entries,
 * no route change), so the current view is always shareable by link.
 */
export function useListViewUrlSync<G extends GroupBy>(config: UseListViewUrlSyncConfig<G>): void {
  if (config.enabled === false || typeof window === 'undefined') return
  const { toolbar, filters, defaults, groupByValues } = config

  // Apply URL overrides once, at construction, before the first render.
  const initial = currentHashParams()
  if (hasListViewParams(initial)) {
    const o = parseListViewParams(initial)
    if (o.viewMode) toolbar.setViewMode(o.viewMode)
    if (o.cardSize) toolbar.setCardSize(o.cardSize)
    if (o.groupBy && (groupByValues as readonly string[]).includes(o.groupBy)) {
      const groupBy = o.groupBy as G
      toolbar.setGroupBy(() => groupBy)
    }
    if (o.sortBy) toolbar.setSortBy(o.sortBy)
    if (o.reverse) toolbar.setReverse(true)
    if (o.reverseGroups) toolbar.setReverseGroups(true)
    if (o.priceGroupStrategy) toolbar.setPriceGroupStrategy(o.priceGroupStrategy)
    if (o.filters) filters.update(o.filters)
  }

  // Mirror subsequent state changes back into the URL.
  createEffect(() => {
    // Spreading the store proxy reads every filter field, so the effect subscribes
    // to all of them and re-runs on any change — and new CardFilters fields are
    // picked up automatically without editing this list.
    const state: ListViewState = {
      viewMode: toolbar.viewMode(),
      cardSize: toolbar.cardSize(),
      groupBy: toolbar.groupBy(),
      sortBy: toolbar.sortBy(),
      reverse: toolbar.reverse(),
      reverseGroups: toolbar.reverseGroups(),
      priceGroupStrategy: toolbar.priceGroupStrategy(),
      filters: { ...filters.filters },
    }
    syncStateToUrl(state, defaults)
  })
}
