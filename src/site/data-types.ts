import type { Condition, DeckData, Finish, ScryfallCard } from '../types'
import type { CardLabel } from '../card-labels'
import type { PriceCurrency } from '../price-currency'
import type { ChangelogPage } from '../changelog-parser'
import type { DeckFormatKey } from '../deck-format'

export interface DeckSummary {
  slug: string
  name: string
  featuredCardImage: string
  commander: string | null
  /** Detected deck format (frontmatter or section heuristic). Null when unknown. */
  format: DeckFormatKey | null
  /**
   * Total quantity of cards in the main deck (commander/oathbreaker +
   * mainboard, excluding sideboard, maybeboard, and tokens).
   */
  cardCount: number
  /**
   * ISO timestamp of the most recent change to the deck. Prefers the latest
   * changelog page timestamp, falling back to the deck file's mtime.
   */
  lastUpdatedAt?: string
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
  /**
   * This card's label override, as written on its line. Effective labels are
   * this when present, else the list's `CollectionDetail.labels` default.
   */
  labels?: CardLabel[]
  price: number
  fileOrder: number
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
  note?: string
  cardId?: number
}

export interface CollectionSummary {
  slug: string
  name: string
  featuredCardImage: string
  /** Number of card entries in the collection (one entry per physical card line). */
  cardCount: number
  /**
   * ISO timestamp of the most recent change to the collection. Prefers the
   * latest changelog page timestamp, falling back to the source file's mtime.
   */
  lastUpdatedAt?: string
  totalPrice: number
  totalPriceEur: number
  totalPriceTix: number
  missingPriceCount?: number
  missingPriceCountEur?: number
  missingPriceCountTix?: number
  /** The collection's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
}

export interface CollectionDetail {
  name: string
  entries: CollectionCardEntry[]
  /** Section names in file order, including empty sections. Used to order/render section groups. */
  sectionOrder?: string[]
  /** The collection's default card labels from its front matter, when declared. */
  labels?: CardLabel[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls: boolean
  totalPrice: number
  defaultCurrency: PriceCurrency
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
  /** Section this entry belongs to. Defaults to `DEFAULT_SECTION` ("Main") when unsectioned. */
  section: string
  note?: string
  state: WantedListEntryState
  cardId?: number
}

export interface WantedListSummary {
  slug: string
  name: string
  featuredCardImage: string
  /** Number of card entries in the wanted list (one entry per requested card line). */
  cardCount: number
  /**
   * ISO timestamp of the most recent change to the wanted list. Prefers the
   * latest changelog page timestamp, falling back to the source file's mtime.
   */
  lastUpdatedAt?: string
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
  /** Section names in file order, including empty sections. Used to order/render section groups. */
  sectionOrder?: string[]
  cards: Record<string, ScryfallCard | null>
  printings: Record<string, ScryfallCard[]>
  symbolMap: Record<string, string>
  useScryfallImgUrls: boolean
  totalPrice: number
  defaultCurrency: PriceCurrency
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
  /** The configured add-card search debounce (ms), baked in at build time. */
  searchDebounceMs: number
  /**
   * Base URL of a live read-only API backing this site. `''` = same origin
   * (injected by `ritual serve --api`, which serves index.json dynamically and
   * shadows any baked value); an absolute URL = split deployment (baked by
   * build-site from `site.apiBaseUrl`). Absent = fully static site.
   */
  apiBaseUrl?: string
  /**
   * Whether this site offers sell mode (buylist quotes, filters, and the
   * sell-cart export), baked from `site.sellMode`. Sell mode also needs a live
   * API to quote against, so the toggle appears only when this is true *and*
   * {@link SiteIndex.apiBaseUrl} is present. Absent on sites built before the
   * feature existed, which reads as off.
   */
  sellMode?: boolean
}

export type TradeCardSource = 'collection' | 'deck' | 'wanted' | 'scryfall'

export interface TradeCardEntry {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** Effective card labels of the source entry — collection rows only. */
  labels?: CardLabel[]
  note?: string
  price?: number
  scryfallCard: ScryfallCard | null
  source: TradeCardSource
  sourceName: string
  qty: number
  /** Maximum quantity available from the source (collection/deck/wanted). Undefined for Scryfall. */
  maxQty?: number
  /** True if this row was added through the printing picker and can be re-edited via it. */
  editable?: boolean
  /**
   * Pool of card IDs from the source list. Used for URL encoding: first `qty` elements are active.
   * Absent for Scryfall-only cards which have no source list.
   */
  sourceCardIds?: number[]
}
