import { createSignal } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type {
  ViewMode,
  CardSize,
  SortBy,
  SortLayer,
  PriceGroupStrategy,
} from '../list-view/card-sorting'
import { usePointerCoarse } from '../ui/useMediaQuery'
import type { BuyerId } from '../buylist'
import {
  engageSellMode,
  sellModeActive,
  sellModeBuyer,
  sellModeEngaging,
  setSellModeActive,
  setSellModeBuyer,
} from '../list-view/sell-mode'

export type UseToolbarStateDefaults<G extends string> = {
  groupBy?: G
  sortBy?: SortBy
}

/** Initial toolbar state that overrides the defaults (a shared URL's), each field only when given. */
export type UseToolbarStateSeed<G extends string> = {
  viewMode?: ViewMode
  cardSize?: CardSize
  groupBy?: G
  sortLayers?: SortLayer[]
  reverseGroups?: boolean
  priceGroupStrategy?: PriceGroupStrategy
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
  /**
   * Whether a click is still waiting to turn sell mode on, and the click itself.
   * Both go through the toolbar rather than being imported from the store, so
   * every read and write of the mode crosses the same seam.
   */
  sellModeEngaging: Accessor<boolean>
  engageSellMode: () => void
  /** Which buyer sell mode quotes against. */
  buyer: Accessor<BuyerId>
  setBuyer: (next: BuyerId) => void
}

/** Shared toolbar state for DeckPage and CollectionPage. */
export function useToolbarState<G extends string>(
  defaults?: UseToolbarStateDefaults<G>,
  seed?: UseToolbarStateSeed<G>,
): UseToolbarStateResult<G> {
  const [rawViewMode, setViewMode] = createSignal<ViewMode>(seed?.viewMode ?? 'binder')
  const coarse = usePointerCoarse()
  // Overlap/stack reveal cards on hover, so touch devices degrade them to
  // binder — reachable there only via a shared URL's view= parameter, since the
  // toolbar hides those two modes on coarse pointers.
  const viewMode: Accessor<ViewMode> = () => {
    const mode = rawViewMode()
    return coarse() && (mode === 'overlap' || mode === 'stack') ? 'binder' : mode
  }
  const [cardSize, setCardSize] = createSignal<CardSize>(seed?.cardSize ?? 'large')
  const [groupBy, setGroupBy] = createSignal<G>(
    (seed?.groupBy ?? defaults?.groupBy ?? 'type') as Exclude<G, Function>,
  )
  const [sortLayers, setSortLayers] = createSignal<SortLayer[]>(
    seed?.sortLayers ?? [{ sortBy: defaults?.sortBy ?? 'name', reverse: false }],
  )
  const [reverseGroups, setReverseGroups] = createSignal(seed?.reverseGroups ?? false)
  const [priceGroupStrategy, setPriceGroupStrategy] = createSignal<PriceGroupStrategy>(
    seed?.priceGroupStrategy ?? 'archidekt',
  )

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
    sellModeEngaging,
    engageSellMode,
    buyer: sellModeBuyer,
    setBuyer: setSellModeBuyer,
  }
}
