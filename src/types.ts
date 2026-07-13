import type { DeckFormatKey } from './deck-format'

export type Finish = 'nonfoil' | 'foil' | 'etched'
export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG'
export type ErrorCode = 'not_found' | 'usage_error' | 'runtime_error'

/**
 * The canonical deck boards a section header normalizes to. Archidekt buckets every
 * card into one of these, and downloaded decks are written with these exact headers.
 * Section-name classification lives in `deck-format.ts` (`isCommanderSection`, etc.);
 * `normalizeBoard` in `deck-sync-helpers.ts` maps a header to one of these values.
 */
export const BOARDS = ['Commander', 'Main', 'Sideboard', 'Maybeboard'] as const
export type Board = (typeof BOARDS)[number]

/**
 * The implicit section name applied to card entries that have no explicit `## Section`
 * header. Cards parsed before the first header (or from a flat, section-less file) belong
 * to this section, and it is written out explicitly on the next save. Matches the deck
 * convention where ungrouped cards live in `Main`.
 */
export const DEFAULT_SECTION = 'Main'

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
  /** Canonical format key; set only from `parseDeckFormat`, never raw text. */
  format?: DeckFormatKey
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
  /** Stable Scryfall oracle identity; shared by every printing of a card. Join key for oracle tags. */
  oracle_id?: string
  /** Identifies this printing's artwork (top level for single-faced/split cards). Join key for art tags. */
  illustration_id?: string
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
    /** Per-face artwork identity (double-faced cards). Join key for art tags. */
    illustration_id?: string
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
  /**
   * Oracle (functional) tag slugs from Scryfall Tagger, shared by every printing of a card.
   * Sorted, deduped. Omitted when the card has no oracle tags.
   */
  oracleTags?: string[]
  /**
   * Art (illustration) tag slugs for this specific printing's artwork.
   * Sorted, deduped, unioned across all faces. Omitted when the printing has no art tags.
   */
  artTags?: string[]
}

export interface ScryfallList<T> {
  object: string
  has_more: boolean
  next_page?: string
  data: T[]
}
