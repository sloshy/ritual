import type { Condition, DeckData, Finish, ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'
import type { ChangelogPage } from '../changelog-parser'

export interface DeckSummary {
  slug: string
  name: string
  featuredCardImage: string
  commander: string | null
  cardCount: number
  totalPrice?: number
  lowestPrice?: number
  totalPriceEur?: number
  lowestPriceEur?: number
  totalPriceTix?: number
  lowestPriceTix?: number
  missingPriceCount?: number
  missingPriceCountEur?: number
  missingPriceCountTix?: number
}

export interface DeckDetail {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  lowestPriceCards?: Record<string, ScryfallCard | null>
  lowestPriceCardsEur?: Record<string, ScryfallCard | null>
  lowestPriceCardsTix?: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  exportPath: string
  useScryfallImgUrls: boolean
  defaultCurrency: PriceCurrency
  availableCurrencies: PriceCurrency[]
  missingCards?: Partial<Record<PriceCurrency, string[]>>
  pricesDate?: string
  changelog?: ChangelogPage[]
}

export interface CollectionCardEntry {
  name: string
  set: string
  collectorNumber: string
  finish: Finish
  condition: Condition
  price: number
  fileOrder: number
  note?: string
  cardId?: number
}

export interface CollectionSummary {
  slug: string
  name: string
  featuredCardImage: string
  cardCount: number
  totalPrice: number
  totalPriceEur: number
  totalPriceTix: number
  missingPriceCount?: number
  missingPriceCountEur?: number
  missingPriceCountTix?: number
}

export interface CollectionDetail {
  name: string
  entries: CollectionCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls: boolean
  totalPrice: number
  defaultCurrency: PriceCurrency
  exportMdPath?: string
  exportCsvPath?: string
  pricesDate?: string
  changelog?: ChangelogPage[]
}

export type WantedListEntryState = 'name-only' | 'printing' | 'fully-specified'

export interface WantedListCardEntry {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  price: number
  fileOrder: number
  note?: string
  state: WantedListEntryState
  cardId?: number
}

export interface WantedListSummary {
  slug: string
  name: string
  featuredCardImage: string
  cardCount: number
  totalPrice: number
  totalPriceEur: number
  totalPriceTix: number
  missingPriceCount?: number
  missingPriceCountEur?: number
  missingPriceCountTix?: number
}

export interface WantedListDetail {
  name: string
  entries: WantedListCardEntry[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls: boolean
  totalPrice: number
  defaultCurrency: PriceCurrency
  exportMdPath?: string
  pricesDate?: string
  changelog?: ChangelogPage[]
}

export interface SiteIndex {
  decks: DeckSummary[]
  collections: CollectionSummary[]
  wantedLists?: WantedListSummary[]
  useScryfallImgUrls: boolean
  defaultCurrency: PriceCurrency
  availableCurrencies: PriceCurrency[]
  pricesDate?: string
}
