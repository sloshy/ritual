import { createEffect } from 'solid-js'
import type { CardLabelSelection } from '../card/card-labels'
import type { GroupBy, SortBy } from '../list-view/card-sorting'
import { SELL_MODE_FILTER_KEYS, type CardFilters } from './card-filters'
import type { BuyerId } from '../buylist'
import type { PriceSource } from '../pricing/price-source'
import type { CardFiltersControl } from './useCardFilters'
import type { ListRefKey } from '../list-view/combined-list'
import { activeStore, pricesEnabled, selectStore, storeIsExplicit } from '../list-view/price-view'
import type { UseToolbarStateResult, UseToolbarStateSeed } from './useToolbarState'
import {
  type ListViewDefaults,
  type ListViewState,
  hasListViewParams,
  parseListViewParams,
  writeListViewParams,
} from './list-view-url'

/** What a page offers, against which a shared URL's state is validated. */
export type ListViewUrlSeedConfig<G extends GroupBy> = {
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
  /**
   * The label chips this page actually offers (`labelFiltersFor` / the combined
   * view's union). Incoming `labels=` values outside the set are dropped —
   * a collection link's `labels=sale` pasted onto a deck would otherwise filter
   * the whole list away through a chip the toolbar cannot show or clear — and a
   * param left with nothing this page offers is dropped entirely. Omitted means
   * "no labels here", which drops every `labels=` value.
   */
  availableLabels?: readonly CardLabelSelection[]
  /**
   * Whether this page offers sell mode. Off, every sell-mode param
   * (`sell=`, `buyer=`, `buylist=`, `buyPrice=`, `buyPriceOp=`) is dropped
   * rather than turning on a mode — and filters — the toolbar cannot show or
   * clear.
   */
  supportsSellMode?: boolean
  /**
   * This page's own ListRefKey (`type:slug`). A shared URL's share-filter
   * params naming the page itself are stripped — the page never offers itself
   * as an option, so the value would sit behind a chip the toolbar cannot show
   * or clear (the `availableLabels` precedent). Omitted on the combined view,
   * which offers every list.
   */
  currentShareList?: ListRefKey
}

/**
 * A shared URL's list-view state, validated against what the page offers. The
 * toolbar and filter parts seed the page's own signals as they are created;
 * the rest is session-wide state the page applies on mount.
 */
export type ListViewUrlSeed<G extends GroupBy> = {
  toolbar: UseToolbarStateSeed<G>
  filters?: Partial<CardFilters>
  sellMode?: boolean
  buyer?: BuyerId
  priceSource?: PriceSource
}

export type UseListViewUrlSyncConfig<G extends GroupBy> = {
  toolbar: UseToolbarStateResult<G>
  filters: CardFiltersControl
  /** The page's effective default group/sort, so default values stay out of the URL. */
  defaults: ListViewDefaults
  /** When false, the hook is inert — used to limit URL sync to the public read view. */
  enabled?: boolean
  /** Whether this page offers sell mode; only such a page writes `sell=` to its URL. */
  supportsSellMode?: boolean
  /** The URL's state as {@link readListViewUrlSeed} read it at setup, if any. */
  seed: ListViewUrlSeed<G> | null
}

/**
 * The members of a URL's `labels=` selection this page actually offers, or
 * `undefined` when none of them survive — the caller drops the filter entirely
 * rather than applying a selection that matches nothing.
 *
 * A shared link is pasted across pages: a collection's `labels=sale` landing on
 * a deck (which carries `proxy` alone) must not empty the list behind a chip
 * the deck's toolbar cannot show or clear. Narrowing rather than dropping keeps
 * the honorable half of a mixed selection — `labels=sale,proxy` on a deck
 * filters to proxies.
 */
export function offeredLabels(
  labels: readonly CardLabelSelection[],
  available: readonly CardLabelSelection[] | undefined,
): CardLabelSelection[] | undefined {
  const offered = new Set<CardLabelSelection>(available ?? [])
  const kept = labels.filter((label) => offered.has(label))
  return kept.length > 0 ? kept : undefined
}

/**
 * A copy of `filters` with `currentShareList` dropped from both share-filter
 * selections (the input is left untouched, like its sibling `offeredLabels`).
 * A single-list page never offers itself as a share option, so a pasted link
 * naming it (e.g. a link shared *from* another list where this one was
 * selected) must not seed a selection the panel cannot display. A selection
 * left empty is removed entirely, keeping "no override" distinct from "an
 * active filter with nothing selected".
 */
export function stripCurrentShareList(
  filters: Partial<CardFilters>,
  currentShareList: ListRefKey,
): Partial<CardFilters> {
  const next: Partial<CardFilters> = { ...filters }
  for (const key of ['sharedWith', 'notSharedWith'] as const) {
    const values = next[key]
    if (values === undefined) continue
    const kept = values.filter((token) => token !== currentShareList)
    if (kept.length > 0) next[key] = kept
    else delete next[key]
  }
  return next
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
 * Read the list-view state a shared URL carries, validated against what the
 * page offers, or `null` when the URL names none (or there is no window).
 *
 * The page reads this **once, at setup**, before creating its toolbar and
 * filter state, and seeds them with it — so a shared link's view applies on
 * the first render, with no write during setup. `groupByValues`,
 * `sortByValues`, `availableLabels` and `supportsSellMode` are plain values for
 * the same reason: each is derived from the page's *kind* (a deck page is
 * always a deck), never from data that arrives later. That is sound only
 * because one page is mounted at a time and every page re-reads this on mount:
 * `sellModeEnabled` in particular is runtime-mutable (the admin's Settings
 * checkbox flips it mid-session), and it stays correct because the Settings page
 * and a list page are never mounted together. A sell-mode control added anywhere
 * that *can* coexist with a list page — a header switch, a dashboard card — has
 * to turn these into accessors first, or the URL sync will keep validating
 * against the old sell-mode vocabulary.
 */
export function readListViewUrlSeed<G extends GroupBy>(
  config: ListViewUrlSeedConfig<G>,
): ListViewUrlSeed<G> | null {
  if (typeof window === 'undefined') return null
  const initial = currentHashParams()
  if (!hasListViewParams(initial)) return null
  const o = parseListViewParams(initial)
  const toolbar: UseToolbarStateSeed<G> = {}
  if (o.viewMode) toolbar.viewMode = o.viewMode
  if (o.cardSize) toolbar.cardSize = o.cardSize
  if (o.groupBy && (config.groupByValues as readonly string[]).includes(o.groupBy)) {
    toolbar.groupBy = o.groupBy as G
  }
  if (o.sortLayers) {
    const offered = new Set<string>(config.sortByValues)
    const layers = o.sortLayers.filter((l) => offered.has(l.sortBy))
    if (layers.length > 0) toolbar.sortLayers = layers
  }
  if (o.reverseGroups) toolbar.reverseGroups = true
  if (o.priceGroupStrategy) toolbar.priceGroupStrategy = o.priceGroupStrategy
  const seed: ListViewUrlSeed<G> = { toolbar }
  if (config.supportsSellMode === true) {
    if (o.sellMode) seed.sellMode = true
    if (o.buyer) seed.buyer = o.buyer
  }
  // A URL's store is an explicit choice — the viewer sees the link's store,
  // and so its currency, over their default and sell mode's courtesy
  // default. `activeStore` settles a store this deployment does not offer
  // onto one it does, so applying it blind is safe.
  if (o.priceSource) seed.priceSource = o.priceSource
  if (o.filters) {
    let filters = o.filters
    if (filters.labels) {
      const kept = offeredLabels(filters.labels, config.availableLabels)
      if (kept === undefined) delete filters.labels
      else filters.labels = kept
    }
    if (config.supportsSellMode !== true) {
      for (const key of SELL_MODE_FILTER_KEYS) delete filters[key]
    }
    if (config.currentShareList !== undefined) {
      filters = stripCurrentShareList(filters, config.currentShareList)
    }
    seed.filters = filters
  }
  return seed
}

/**
 * Two-way sync between a list view's toolbar/filter state and the URL query string.
 * The page seeds its own state from {@link readListViewUrlSeed}; this applies
 * the seed's session-wide part (sell mode, buyer, price store) and thereafter
 * mirrors state changes back into the URL via `history.replaceState` (no new
 * history entries, no route change), so the current view is always shareable
 * by link.
 */
export function useListViewUrlSync<G extends GroupBy>(config: UseListViewUrlSyncConfig<G>): void {
  if (config.enabled === false || typeof window === 'undefined') return
  const { toolbar, filters, defaults, seed } = config

  // Session-wide state, not the page's own: applied as the page mounts, before
  // its first render (these signals take `ownedWrite` for exactly this).
  if (seed?.sellMode) toolbar.setSellMode(true)
  if (seed?.buyer) toolbar.setBuyer(seed.buyer)
  if (seed?.priceSource) selectStore(seed.priceSource)

  // `priceSources: []` resolves from index.json *after* the URL overrides
  // above applied, so a shared link's price state must be unwound once the
  // deployment turns out to display no prices — the price filter, the
  // hide-unpriced toggle, and the price grouping/sort would otherwise keep
  // acting behind controls the toolbar no longer shows (with every price 0,
  // the filter empties the whole list). Mirrors useSellMode's exit cleanup.
  createEffect(pricesEnabled, (enabled) => {
    if (enabled) return
    const cleared: Partial<CardFilters> = {}
    if (filters.filters.price !== null) cleared.price = null
    if (filters.filters.hideUnpriced) cleared.hideUnpriced = false
    if (Object.keys(cleared).length > 0) filters.update(cleared)
    if (toolbar.groupBy() === 'price') toolbar.setGroupBy(() => defaults.groupBy as G)
    const layers = toolbar.sortLayers().filter((l) => l.sortBy !== 'price')
    if (layers.length !== toolbar.sortLayers().length) {
      toolbar.setSortLayers(
        layers.length > 0 ? layers : [{ sortBy: defaults.sortBy, reverse: false }],
      )
    }
  })

  // Mirror subsequent state changes back into the URL.
  createEffect(
    (): ListViewState => ({
      // Spreading the store proxy reads every filter field, so the effect subscribes
      // to all of them and re-runs on any change — and new CardFilters fields are
      // picked up automatically without editing this list.
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
      // Only an explicit choice is shareable: sell mode's courtesy default is
      // reproduced on the recipient's side by `sell=1` itself, and writing it
      // here would promote it to an explicit pick when the link is opened.
      // The flag is a signal, so the first pick re-runs this effect even when
      // the source value itself did not change.
      ...(storeIsExplicit() ? { priceSource: activeStore() } : {}),
      filters: { ...filters.filters },
    }),
    (state) => {
      syncStateToUrl(state, defaults)
    },
  )
}
