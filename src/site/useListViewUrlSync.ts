import { createEffect } from 'solid-js'
import type { GroupBy, SortBy } from './card-sorting'
import { SELL_MODE_FILTER_KEYS } from './card-filters'
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
  /**
   * The sort-by fields this page actually offers. Layers from a URL whose field is
   * outside this set (e.g. a collection link's `sort=set-code` pasted onto a deck,
   * which has no set-code option) are dropped, keeping every layer's dropdown in
   * sync with what is selectable — the sort itself handles every field regardless.
   */
  sortByValues: readonly SortBy[]
  /** When false, the hook is inert — used to limit URL sync to the public read view. */
  enabled?: boolean
  /**
   * Whether this page offers the labels filter (collections and the combined
   * view). Off, an incoming `labels=` param is dropped rather than silently
   * narrowing the list through a filter the toolbar cannot show or clear.
   */
  supportsLabels?: boolean
  /**
   * Whether this page offers sell mode. Off, every sell-mode param
   * (`sell=`, `buyer=`, `buylist=`, `buyPrice=`, `buyPriceOp=`) is dropped
   * rather than turning on a mode — and filters — the toolbar cannot show or
   * clear.
   */
  supportsSellMode?: boolean
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
 *
 * `groupByValues`, `sortByValues` and `supportsSellMode` are read **once, at
 * setup** — the pages pass them as plain values, not accessors, so a vocabulary
 * that changes while the page is mounted is not picked up. That is sound only
 * because one page is mounted at a time and every page re-runs this on mount:
 * `sellModeEnabled` in particular is now runtime-mutable (the admin's Settings
 * checkbox flips it mid-session), and it stays correct because the Settings page
 * and a list page are never mounted together. A sell-mode control added anywhere
 * that *can* coexist with a list page — a header switch, a dashboard card — has
 * to turn these three into accessors first, or the URL sync will keep validating
 * against the old sell-mode vocabulary.
 */
export function useListViewUrlSync<G extends GroupBy>(config: UseListViewUrlSyncConfig<G>): void {
  if (config.enabled === false || typeof window === 'undefined') return
  const { toolbar, filters, defaults, groupByValues, sortByValues } = config

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
    if (o.sortLayers) {
      const offered = new Set<string>(sortByValues)
      const layers = o.sortLayers.filter((l) => offered.has(l.sortBy))
      if (layers.length > 0) toolbar.setSortLayers(layers)
    }
    if (o.reverseGroups) toolbar.setReverseGroups(true)
    if (o.priceGroupStrategy) toolbar.setPriceGroupStrategy(o.priceGroupStrategy)
    if (config.supportsSellMode === true) {
      if (o.sellMode) toolbar.setSellMode(true)
      if (o.buyer) toolbar.setBuyer(o.buyer)
    }
    if (o.filters) {
      if (config.supportsLabels !== true) delete o.filters.labels
      if (config.supportsSellMode !== true) {
        for (const key of SELL_MODE_FILTER_KEYS) delete o.filters[key]
      }
      filters.update(o.filters)
    }
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
      sortLayers: toolbar.sortLayers(),
      reverseGroups: toolbar.reverseGroups(),
      priceGroupStrategy: toolbar.priceGroupStrategy(),
      // Written only by pages that offer sell mode, so an ordinary list view's
      // URL never gains a `sell=` key it cannot honor.
      sellMode: config.supportsSellMode === true && toolbar.sellMode(),
      buyer: toolbar.buyer(),
      filters: { ...filters.filters },
    }
    syncStateToUrl(state, defaults)
  })
}
