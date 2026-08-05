import { createSignal } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type { ViewMode, CardSize, SortBy, SortLayer, PriceGroupStrategy } from './card-sorting'
import { usePointerCoarse } from '../ui/useMediaQuery'
import type { BuyerId } from '../buylist'
import { sellModeActive, sellModeBuyer, setSellModeActive, setSellModeBuyer } from './sell-mode'

export type UseToolbarStateDefaults<G extends string> = {
  groupBy?: G
  sortBy?: SortBy
}

export type UseToolbarStateResult<G extends string> = {
  viewMode: Accessor<ViewMode>
  setViewMode: Setter<ViewMode>
  cardSize: Accessor<CardSize>
  setCardSize: Setter<CardSize>
  groupBy: Accessor<G>
  setGroupBy: Setter<G>
  /** Ordered multi-level sort. Always has at least one layer. */
  sortLayers: Accessor<SortLayer[]>
  setSortLayers: Setter<SortLayer[]>
  reverseGroups: Accessor<boolean>
  setReverseGroups: Setter<boolean>
  priceGroupStrategy: Accessor<PriceGroupStrategy>
  setPriceGroupStrategy: Setter<PriceGroupStrategy>
  /**
   * Whether the page is in sell mode: buylist prices on tiles, the on-buylist
   * filter, buylist grouping/sorting, and the sell-cart export. Always false on
   * pages that do not offer it (`showSellMode`), so reading it is safe anywhere.
   */
  sellMode: Accessor<boolean>
  setSellMode: (next: boolean) => void
  /** Which buyer sell mode quotes against. */
  buyer: Accessor<BuyerId>
  setBuyer: (next: BuyerId) => void
}

/** Shared toolbar state for DeckPage and CollectionPage. */
export function useToolbarState<G extends string>(
  defaults?: UseToolbarStateDefaults<G>,
): UseToolbarStateResult<G> {
  const [rawViewMode, setViewMode] = createSignal<ViewMode>('binder')
  const coarse = usePointerCoarse()
  // Overlap/stack reveal cards on hover, so touch devices degrade them to
  // binder — reachable there only via a shared URL's view= parameter, since the
  // toolbar hides those two modes on coarse pointers.
  const viewMode: Accessor<ViewMode> = () => {
    const mode = rawViewMode()
    return coarse() && (mode === 'overlap' || mode === 'stack') ? 'binder' : mode
  }
  const [cardSize, setCardSize] = createSignal<CardSize>('large')
  const [groupBy, setGroupBy] = createSignal<G>((defaults?.groupBy ?? 'type') as G)
  const [sortLayers, setSortLayers] = createSignal<SortLayer[]>([
    { sortBy: defaults?.sortBy ?? 'name', reverse: false },
  ])
  const [reverseGroups, setReverseGroups] = createSignal(false)
  const [priceGroupStrategy, setPriceGroupStrategy] = createSignal<PriceGroupStrategy>('archidekt')

  return {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortLayers,
    setSortLayers,
    reverseGroups,
    setReverseGroups,
    priceGroupStrategy,
    setPriceGroupStrategy,
    // Backed by the global store, so the mode survives navigation and the
    // cross-list selection dialog can read it without a page to ask.
    sellMode: sellModeActive,
    setSellMode: setSellModeActive,
    buyer: sellModeBuyer,
    setBuyer: setSellModeBuyer,
  }
}
