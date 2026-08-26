/**
 * Sell mode's page-level wiring, shared by every list page.
 *
 * One hook owns the whole feature per page: whether it is offered at all, the
 * toolbar control, keeping the quote store loaded, and the selection's sell
 * value. A page adds sell mode by calling this and forwarding three values —
 * the Toolbar's `sell` prop, `sellMode()`, and the summary.
 *
 * Where the quotes come from is the page's choice, declared as
 * {@link UseSellModeInput.quotes}: the public site hands over the quotes baked
 * into its list detail, the admin editors let the store fetch them.
 */

import { createEffect, createMemo, on, type Accessor } from 'solid-js'
import { quoteKey, type BuyerId, type BuylistQuoteRequest } from '../buylist'
import {
  buylistRequestFor,
  reportBuylistUnavailable,
  requestBuylistQuotes,
  seedBuylistQuotes,
} from '../list-view/buylist-quotes'
import type { BakedBuylist } from '../list/site-data'
import {
  activeUsdSource,
  maybeDefaultSellSource,
  maybeRestoreDefaultSource,
} from '../list-view/price-view'
import { useT } from '../ui/i18n'
import { isPricelessCard } from '../list-view/priceless'
import type { CardData, SortBy, SortLayer } from '../list-view/card-sorting'
import { SELL_GROUP_BY_OPTIONS, SELL_SORT_BYS } from '../list-view/card-sorting'
import type { CardFilters } from './card-filters'
import type { CardFiltersControl } from './useCardFilters'
import { summarizeSellValue, type SellableCard, type SellValueSummary } from './sell-value'
import type { SellModeControl } from '../list-view/sell-mode'
import type { SelectedCard } from '../list-view/useCardSelection'
import type { UseToolbarStateResult } from './useToolbarState'

/**
 * The toolbar slice this hook drives; kept narrow so pages can pass their whole
 * toolbar. Generic over the page's own grouping union rather than widened to
 * `string`, so the grouping this hook restores on exit is one the page's
 * dropdown can actually show.
 */
type SellToolbarState<G extends string> = Pick<
  UseToolbarStateResult<G>,
  | 'sellMode'
  | 'setSellMode'
  | 'sellModeEngaging'
  | 'engageSellMode'
  | 'buyer'
  | 'setBuyer'
  | 'sortLayers'
  | 'setSortLayers'
  | 'groupBy'
  | 'setGroupBy'
>

/** What grouping and sorting revert to when a buylist choice is abandoned. */
type SellModeDefaults<G extends string> = {
  groupBy: G
  sortBy: SortBy
}

/**
 * The quotes baked into a page's list detail — the public site's source.
 *
 * The quote API is never called on this path, and an accessor that resolves to
 * `undefined` (a list built or served without a buyer feed) reports through
 * `buylistError` rather than falling back to a request.
 *
 * A card *added* during a public edit session is a known consequence of that:
 * the build never quoted its printing, so it has no baked key and reads as
 * "not on the buylist" — indistinguishable from a printing the buyer genuinely
 * declines. There is no fallback request by design; the public site must work
 * with no backend at all.
 */
export type BakedQuoteSource = {
  kind: 'baked'
  quotes: Accessor<BakedBuylist | undefined>
}

/** Quote on demand against the server's API — the admin editors' path. */
export type LiveQuoteSource = {
  kind: 'live'
}

/**
 * Where a page's quotes come from. A declared choice rather than one inferred
 * from whether an optional prop happened to be passed: the two paths behave
 * completely differently, and a call site that meant one and got the other
 * fails silently.
 */
export type QuoteSource = BakedQuoteSource | LiveQuoteSource

export type UseSellModeInput<G extends string> = {
  toolbar: SellToolbarState<G>
  /**
   * Whether this page can offer sell mode: the site was built with it enabled.
   * Reactive, since it resolves from `index.json` after the page mounts.
   */
  supported: Accessor<boolean>
  /** Baked (public site) or live (admin) quotes; see {@link QuoteSource}. */
  quotes: QuoteSource
  /** The page's resolved cards — every one is quoted, not just the visible ones,
   * because filtering, grouping and sorting all read the quotes. The baked path
   * arrives pre-quoted and only reads the count, to tell an unpriced page from
   * an empty one. */
  cards: Accessor<CardData[]>
  /** The page's own selection scope (never the cross-list one). */
  selected: Accessor<SelectedCard[]>
  /** The page's filter store, so leaving sell mode can clear the buylist chips. */
  filters: CardFiltersControl
  /** What grouping and sorting revert to when a buylist choice is abandoned. */
  defaults: SellModeDefaults<G>
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
  // would let the request side drift from the store's lookups. The entry's own
  // language token goes through too — a `[ja]` copy resolving to the English
  // card object must not be quoted at the English price.
  const requests = new Map<string, BuylistQuoteRequest>()
  for (const card of cards) {
    // A proxy and a custom-art copy are never quoted (see `buylistFieldsFor`),
    // so asking about the printing would spend a request on an answer nothing
    // can display.
    if (isPricelessCard(card)) continue
    const request = buylistRequestFor(card.card, card.finish, card.language)
    if (!request) continue
    requests.set(quoteKey(request.set, request.collectorNumber, request.finish), request)
  }
  return [...requests.values()]
}

export function useSellMode<G extends string>(input: UseSellModeInput<G>): UseSellModeResult {
  const t = useT()
  // Sell mode can be left on in the toolbar (or arrive via a shared URL) on a
  // page that turns out not to support it; gating the read here means no
  // consumer has to remember to check both.
  const active = createMemo(() => input.supported() && input.toolbar.sellMode())

  /**
   * Ensure the store holds this page's quotes.
   *
   * The buyer and the baked payload are passed in rather than read here, so the
   * caller decides whether those reads are tracked: the effect below takes them
   * before its early return (making them dependencies), while the click handler
   * takes them once, untracked. `cards` is read here instead, per branch: the
   * live path must re-request when the card set changes, while the baked path
   * looks at it only to tell an unpriced page from an empty one.
   */
  const loadQuotes = (buyer: BuyerId, baked: BakedBuylist | undefined): void => {
    if (input.quotes.kind === 'baked') {
      // `seedBuylistQuotes` reports whether the payload carried anything for
      // this buyer, so a detail quoted against a *different* buyer explains
      // itself instead of showing a silently priceless page.
      if (baked && seedBuylistQuotes(baked, buyer)) return
      // Nothing baked. Say so only once there is something to price: a combined
      // view whose details are still in flight has no cards yet, and announcing
      // missing prices for a page with nothing on it is noise, not an
      // explanation.
      if (input.cards().length > 0) reportBuylistUnavailable(t('site.sell.notBaked'))
      return
    }
    const requests = quoteRequests(input.cards())
    if (requests.length === 0) return
    void requestBuylistQuotes(requests, buyer)
  }

  /** This page's baked payload, or undefined on the live path. */
  const bakedQuotes = (): BakedBuylist | undefined =>
    input.quotes.kind === 'baked' ? input.quotes.quotes() : undefined

  // Turning sell mode on is the expensive direction, so the click does the two
  // things that must not wait on the rebuild: it starts the fetch, and it hands
  // the flip to `engageSellMode` so the button paints first.
  const toggle = (): void => {
    // Reads the engaging flag too, so a second click during the deferral turns
    // the mode back off — matching the pressed button the user is clicking,
    // rather than the mode that has not landed yet. `setSellMode` cancels the
    // pending flip.
    if (input.toolbar.sellMode() || input.toolbar.sellModeEngaging()) {
      input.toolbar.setSellMode(false)
      return
    }
    // Engage first so a throw from the card walk below cannot leave the mode
    // permanently unreachable; both run in this same task either way, so the
    // paint the deferral waits for is unaffected by the order.
    input.toolbar.engageSellMode()
    // Loaded before the flip rather than from the effect below, which only runs
    // once the whole page has rebuilt — that is the slowest possible moment to
    // start a network request the rebuilt page is waiting on. Requesting here
    // also raises `buylistLoading` in time for the toggle's first paint. On the
    // baked path this is free: `buylistFieldsFor` short-circuits while the mode
    // is off, so nothing on the page depends on the quote map yet and seeding
    // it now costs one rebuild instead of two.
    loadQuotes(input.toolbar.buyer(), bakedQuotes())
  }

  const control = createMemo((): SellModeControl | undefined =>
    input.supported()
      ? {
          active: input.toolbar.sellMode(),
          engaging: input.toolbar.sellModeEngaging,
          onToggle: toggle,
          buyer: input.toolbar.buyer(),
          onBuyerChange: (buyer: BuyerId) => input.toolbar.setBuyer(buyer),
        }
      : undefined,
  )

  // Quotes load when sell mode turns on and whenever the buyer, the card set,
  // or the baked payload changes. Both loaders skip what they have already
  // settled, so re-runs cost nothing once the page is warm — including the
  // re-run that follows the flip `toggle` already loaded for.
  //
  // The Card Kingdom price *view* needs the same quotes (retail prices ride on
  // them), whether or not sell mode is on — so the effect also fires while
  // that source is selected. Deliberately not gated on `supported`: a site can
  // enable the `cardkingdom` price source with sell mode off.
  createEffect(() => {
    // Read the buyer first: after an early return it would be an untracked
    // dependency, so switching buyers on a page with nothing to quote would
    // neither reset the store nor re-run this.
    const buyer = input.toolbar.buyer()
    // Likewise for the baked payload, so a detail that arrives (or is refetched
    // from a live backend) while sell mode is already on re-seeds the store.
    const baked = bakedQuotes()
    if (!active() && activeUsdSource() !== 'cardkingdom') return
    loadQuotes(buyer, baked)
  })

  // Entering sell mode defaults the USD price view to Card Kingdom retail
  // (when that source is enabled), so the offer sits beside what CK charges;
  // leaving restores the default. Both yield to an explicit source choice —
  // see `maybeDefaultSellSource` — so switching the view to TCGplayer to
  // compare against the market price sticks. Deliberately no currency-epoch
  // bump here: a shared `sell=1&price=…` link authored under the courtesy
  // default must restore its price filter, not have this very effect clear it.
  createEffect(
    on(active, (isActive, wasActive) => {
      if (isActive && wasActive !== true) maybeDefaultSellSource()
      else if (!isActive && wasActive === true) maybeRestoreDefaultSource()
    }),
  )

  const summary = createSellSummary(active, input.selected)

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
      const layers = replaceSellSortLayers(current)
      if (layers.length !== current.length || layers.some((l, i) => l !== current[i])) {
        input.toolbar.setSortLayers(
          layers.length > 0 ? layers : [{ sortBy: input.defaults.sortBy, reverse: false }],
        )
      }
    }),
  )

  return { active, control, summary }
}

/**
 * What a set of cards is worth to the buyer, recomputed as they change: the
 * selection behind the header's "Sell value", or a page's filtered cards behind
 * its "Buylist total".
 *
 * Off the mode it summarizes nothing, and does not even read `cards`: memos stay
 * hot whether or not anything observes them, so without the guard a page showing
 * no buylist at all would re-walk and re-budget every tile on each filter
 * keystroke. Every consumer is gated on sell mode too, so the empty summary is
 * never rendered.
 *
 * The filtered variant is created by the page rather than inside
 * {@link useSellMode}, because the filtered set is derived from state declared
 * well below the hook call: this memo evaluates eagerly, and a URL-restored
 * `sell=1` makes `active()` true on that very first run, so even a deferred
 * arrow would reach the accessor before it exists.
 */
export function createSellSummary(
  active: Accessor<boolean>,
  cards: Accessor<readonly SellableCard[]>,
): Accessor<SellValueSummary> {
  return createMemo(() => summarizeSellValue(active() ? cards() : []))
}

/** Whether a grouping is one sell mode contributes (and therefore hides on exit). */
function isSellGroupBy(groupBy: string): boolean {
  return SELL_GROUP_BY_OPTIONS.some((option) => option.value === groupBy)
}

/** Whether a sort field is one sell mode contributes. */
function isSellSortBy(sortBy: SortLayer['sortBy']): boolean {
  return (SELL_SORT_BYS as readonly SortBy[]).includes(sortBy)
}

/**
 * Swap each buylist sort layer for its ordinary equivalent, keeping the layer's
 * direction. Both buylist fields order by money, so `price` is the sort that
 * survives the mode — dropping the layer outright would instead throw away the
 * ordering the user asked for. A layer whose replacement is already sorted on
 * is dropped rather than duplicated; every page offering sell mode offers
 * `price`, so the replacement is always a field its dropdown can show.
 */
function replaceSellSortLayers(layers: SortLayer[]): SortLayer[] {
  const kept: SortLayer[] = []
  const seen = new Set<SortBy>()
  for (const layer of layers) {
    const sortBy = isSellSortBy(layer.sortBy) ? 'price' : layer.sortBy
    if (seen.has(sortBy)) continue
    seen.add(sortBy)
    kept.push(sortBy === layer.sortBy ? layer : { ...layer, sortBy })
  }
  return kept
}
