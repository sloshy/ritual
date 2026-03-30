import { createSignal } from 'solid-js'
import type { Accessor, Setter } from 'solid-js'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'

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
  sortBy: Accessor<SortBy>
  setSortBy: Setter<SortBy>
  reverse: Accessor<boolean>
  setReverse: Setter<boolean>
  hideLands: Accessor<boolean>
  setHideLands: Setter<boolean>
  priceGroupStrategy: Accessor<PriceGroupStrategy>
  setPriceGroupStrategy: Setter<PriceGroupStrategy>
}

/** Shared toolbar state for DeckPage and CollectionPage. */
export function useToolbarState<G extends string>(
  defaults?: UseToolbarStateDefaults<G>,
): UseToolbarStateResult<G> {
  const [viewMode, setViewMode] = createSignal<ViewMode>('binder')
  const [cardSize, setCardSize] = createSignal<CardSize>('large')
  const [groupBy, setGroupBy] = createSignal<G>((defaults?.groupBy ?? 'type') as G)
  const [sortBy, setSortBy] = createSignal<SortBy>(defaults?.sortBy ?? 'name')
  const [reverse, setReverse] = createSignal(false)
  const [hideLands, setHideLands] = createSignal(false)
  const [priceGroupStrategy, setPriceGroupStrategy] = createSignal<PriceGroupStrategy>('archidekt')

  return {
    viewMode,
    setViewMode,
    cardSize,
    setCardSize,
    groupBy,
    setGroupBy,
    sortBy,
    setSortBy,
    reverse,
    setReverse,
    hideLands,
    setHideLands,
    priceGroupStrategy,
    setPriceGroupStrategy,
  }
}
