export interface Card {
  quantity: number
  name: string
}

export interface DeckSection {
  name: string
  cards: Card[]
}

export interface DeckData {
  name: string
  sourceId?: string
  sourceUrl?: string
  description?: string
  primer?: string
  sections: DeckSection[]
}

export interface PriceData {
  latest: number
  min: number
  max: number
}

export interface ScryfallCard {
  id: string
  name: string
  cmc: number
  edhrec_rank?: number
  mana_cost?: string
  type_line: string
  oracle_text?: string
  image_uris?: {
    small: string
    normal: string
    large: string
    png: string
    art_crop: string
    border_crop: string
  }
  card_faces?: {
    name: string
    mana_cost: string
    type_line: string
    oracle_text: string
    image_uris?: {
      normal: string
    }
  }[]
  prices: {
    usd: string | null
    usd_foil: string | null
    usd_etched: string | null
  }
  finishes: string[]
  set: string
  set_name: string
  collector_number: string
  rarity: string
}

export interface ScryfallList<T> {
  object: string
  has_more: boolean
  next_page?: string
  data: T[]
}
