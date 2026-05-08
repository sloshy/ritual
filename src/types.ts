export type Finish = 'nonfoil' | 'foil' | 'etched'
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
export type ErrorCode = 'not_found' | 'usage_error' | 'runtime_error'

export interface Card {
  quantity: number
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  note?: string
  cardId?: number
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
  layout?: string
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
    eur: string | null
    eur_foil: string | null
    tix: string | null
  }
  finishes: string[]
  games: string[]
  set: string
  set_name: string
  collector_number: string
  rarity: string
  color_identity: string[]
  released_at?: string
}

export interface ScryfallList<T> {
  object: string
  has_more: boolean
  next_page?: string
  data: T[]
}
