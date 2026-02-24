import type { DeckData, ScryfallCard } from '../types'

export interface DeckSummary {
  slug: string
  name: string
  featuredCardImage: string
  commander: string | null
  cardCount: number
}

export interface DeckIndex {
  decks: DeckSummary[]
  useScryfallImgUrls: boolean
}

export interface DeckDetail {
  deck: DeckData
  cards: Record<string, ScryfallCard | null>
  symbolMap: Record<string, string>
  exportPath: string
  useScryfallImgUrls: boolean
}
