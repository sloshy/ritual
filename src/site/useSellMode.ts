/**
 * Sell mode's page-level wiring, shared by every list page.
 *
 * One hook owns the whole feature per page: whether it is offered at all, the
 * toolbar control, keeping quotes loaded for the page's cards, and the
 * selection's sell value. A page adds sell mode by calling this and forwarding
 * three values — the Toolbar's `sell` prop, `sellMode()`, and the summary.
 */

import { createEffect, createMemo, on, type Accessor } from 'solid-js'
import { quoteKey, type BuyerId, type BuylistQuoteRequest } from '../buylist'
import { buylistRequestFor, requestBuylistQuotes } from './buylist-quotes'
import type { CardData, SortBy, SortLayer } from './card-sorting'
import { SELL_GROUP_BY_OPTIONS, SELL_SORT_BYS } from './card-sorting'
import type { CardFilters } from './card-filters'
import type { CardFiltersControl } from './useCardFilters'
import type { ListViewDefaults } from './list-view-url'
import { summarizeSellValue, type SellValueSummary } from './sell-value'
import type { SellModeControl } from './sell-mode'
import type { SelectedCard } from './useCardSelection'
import type { UseToolbarStateResult } from './useToolbarState'

/** The toolbar slice this hook drives; kept narrow so pages can pass their whole toolbar. */
type SellToolbarState = Pick<
  UseToolbarStateResult<string>,
  'sellMode' | 'setSellMode' | 'buyer' | 'setBuyer' | 'sortLayers' | 'setSortLayers'
> & {
  groupBy: Accessor<string>
  setGroupBy: (value: () => string) => void
}

export type UseSellModeInput = {
  toolbar: SellToolbarState
  /**
   * Whether this page can offer sell mode: the site was built with it enabled
   * and a live API is answering. Reactive, since it resolves from `index.json`
   * after the page mounts.
   */
  supported: Accessor<boolean>
  /** The page's resolved cards — every one is quoted, not just the visible ones,
   * because filtering, grouping and sorting all read the quotes. */
  cards: Accessor<CardData[]>
  /** The page's own selection scope (never the cross-list one). */
  selected: Accessor<SelectedCard[]>
  /** The page's filter store, so leaving sell mode can clear the buylist chips. */
  filters: CardFiltersControl
  /** What grouping and sorting revert to when a buylist choice is abandoned. */
  defaults: ListViewDefaults
}

export type UseSellModeResult = {
  /** Whether sell mode is on. False whenever the page cannot offer it. */
  active: Accessor<boolean>
  /** The Toolbar's `sell` prop; undefined when the page cannot offer sell mode. */
  control: Accessor<SellModeControl | undefined>
  /** The selection's budget-capped sell value and shortfall counts. */
  summary: Accessor<SellValueSummary>
}

/** The quote requests for a page's cards, deduplicated by printing. */
function quoteRequests(cards: CardData[]): BuylistQuoteRequest[] {
  // Both helpers are the canonical ones: rolling the key format by hand here
  // would let the request side drift from the store's lookups.
  const requests = new Map<string, BuylistQuoteRequest>()
  for (const card of cards) {
    const request = buylistRequestFor(card.card, card.finish)
    if (!request) continue
    requests.set(quoteKey(request.set, request.collectorNumber, request.finish), request)
  }
  return [...requests.values()]
}

export function useSellMode(input: UseSellModeInput): UseSellModeResult {
  // Sell mode can be left on in the toolbar (or arrive via a shared URL) on a
  // page that turns out not to support it; gating the read here means no
  // consumer has to remember to check both.
  const active = createMemo(() => input.supported() && input.toolbar.sellMode())

  const control = createMemo((): SellModeControl | undefined =>
    input.supported()
      ? {
          active: input.toolbar.sellMode(),
          onToggle: () => input.toolbar.setSellMode(!input.toolbar.sellMode()),
          buyer: input.toolbar.buyer(),
          onBuyerChange: (buyer: BuyerId) => input.toolbar.setBuyer(buyer),
        }
      : undefined,
  )

  // Quotes load when sell mode turns on and whenever the card set or buyer
  // changes. `requestBuylistQuotes` skips printings it has already answered
  // for, so re-runs cost nothing once the page is warm.
  createEffect(() => {
    // Read the buyer first: after an early return it would be an untracked
    // dependency, so switching buyers on a page with nothing to quote would
    // neither reset the store nor re-run this.
    const buyer = input.toolbar.buyer()
    if (!active()) return
    const requests = quoteRequests(input.cards())
    if (requests.length === 0) return
    void requestBuylistQuotes(requests, buyer)
  })

  const summary = createMemo(() => summarizeSellValue(input.selected()))

  // Leaving sell mode must not strand the state its controls set. The buylist
  // chips, the buylist groupings and the buylist sort all disappear with the
  // toggle, so anything still selecting them would keep narrowing or reordering
  // the list with no visible control to undo it.
  createEffect(
    on(active, (isActive, wasActive) => {
      if (isActive || wasActive !== true) return
      // Guarded per field, not written unconditionally: handing the store a
      // fresh `[]` would count as a change and re-run every filter memo, the
      // badge, and the URL sync on an exit that changed nothing.
      const cleared: Partial<CardFilters> = {}
      if (input.filters.filters.onBuylist.length > 0) cleared.onBuylist = []
      if (input.filters.filters.buylistPrice !== null) cleared.buylistPrice = null
      if (Object.keys(cleared).length > 0) input.filters.update(cleared)
      if (isSellGroupBy(input.toolbar.groupBy())) {
        input.toolbar.setGroupBy(() => input.defaults.groupBy)
      }
      const current = input.toolbar.sortLayers()
      const layers = current.filter((layer) => !isSellSortBy(layer.sortBy))
      if (layers.length !== current.length) {
        input.toolbar.setSortLayers(
          layers.length > 0 ? layers : [{ sortBy: input.defaults.sortBy, reverse: false }],
        )
      }
    }),
  )

  return { active, control, summary }
}

/** Whether a grouping is one sell mode contributes (and therefore hides on exit). */
function isSellGroupBy(groupBy: string): boolean {
  return SELL_GROUP_BY_OPTIONS.some((option) => option.value === groupBy)
}

/** Whether a sort field is one sell mode contributes. */
function isSellSortBy(sortBy: SortLayer['sortBy']): boolean {
  return (SELL_SORT_BYS as readonly SortBy[]).includes(sortBy)
}
