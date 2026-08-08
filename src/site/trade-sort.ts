import type { TradeCardEntry } from './data-types'
import { compareDisplay } from '../i18n/collate'

export type TradeSortBy = 'name' | 'price'

export interface TradeSortState {
  by: TradeSortBy
  reverse: boolean
}

export function sortTradeCards(cards: TradeCardEntry[], sort: TradeSortState): TradeCardEntry[] {
  const sorted = [...cards].sort((a, b) => {
    if (sort.by === 'name') return compareDisplay(a.name, b.name)
    return (a.price ?? 0) - (b.price ?? 0)
  })
  return sort.reverse ? sorted.reverse() : sorted
}
