export interface ScryfallCard {
  id: string
  /** Stable Scryfall oracle identity; shared by every printing of a card. Join key for oracle tags. */
  oracle_id?: string
  /** Identifies this printing's artwork (top level for single-faced/split cards). Join key for art tags. */
  illustration_id?: string
  name: string
  /**
   * Scryfall language code of this card object (`ja`, `zhs`, ...). Absent
   * means `en` — populated from the bulk data, whose `default_cards` file is
   * English-only while `all_cards` carries every language.
   */
  lang?: string
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
    /**
     * Optional: Scryfall publishes it only for the few etched printings
     * Cardmarket quotes, and cards cached before the field existed lack it
     * entirely. Absent reads exactly like null (no price).
     */
    eur_etched?: string | null
    tix: string | null
  }
  finishes: string[]
  games: string[]
  set: string
  set_name: string
  collector_number: string
  rarity: string
  color_identity: string[]
  /** Mana colors of this printing (WUBRG letters). Distinct from `color_identity`. */
  colors?: string[]
  /** Scryfall's named keyword abilities (e.g. `Flying`, `Ward`). */
  keywords?: string[]
  /** Format→status map from Scryfall (`legal` / `not_legal` / `banned` / `restricted`). */
  legalities?: Record<string, string>
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
  /** Total matches across every page, as Scryfall reports them on a search list. */
  total_cards?: number
  data: T[]
}
