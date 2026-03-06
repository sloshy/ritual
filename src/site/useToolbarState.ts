import { useState } from 'preact/hooks'
import type { ViewMode, CardSize, SortBy, PriceGroupStrategy } from './card-sorting'

type Setter<T> = (value: T | ((prev: T) => T)) => void

export type UseToolbarStateDefaults<G extends string> = {
  groupBy?: G
  sortBy?: SortBy
}

export type UseToolbarStateResult<G extends string> = {
  viewMode: ViewMode
  setViewMode: Setter<ViewMode>
  cardSize: CardSize
  setCardSize: Setter<CardSize>
  groupBy: G
  setGroupBy: Setter<G>
  sortBy: SortBy
  setSortBy: Setter<SortBy>
  reverse: boolean
  setReverse: Setter<boolean>
  hideLands: boolean
  setHideLands: Setter<boolean>
  priceGroupStrategy: PriceGroupStrategy
  setPriceGroupStrategy: Setter<PriceGroupStrategy>
}

/** Shared toolbar state for DeckPage and CollectionPage. */
export function useToolbarState<G extends string>(
  defaults?: UseToolbarStateDefaults<G>,
): UseToolbarStateResult<G> {
  const [viewMode, setViewMode] = useState<ViewMode>('binder')
  const [cardSize, setCardSize] = useState<CardSize>('large')
  const [groupBy, setGroupBy] = useState<G>((defaults?.groupBy ?? 'type') as G)
  const [sortBy, setSortBy] = useState<SortBy>(defaults?.sortBy ?? 'name')
  const [reverse, setReverse] = useState(false)
  const [hideLands, setHideLands] = useState(false)
  const [priceGroupStrategy, setPriceGroupStrategy] = useState<PriceGroupStrategy>('archidekt')

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
