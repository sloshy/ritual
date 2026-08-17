import type { Card, Condition, DeckData, Finish, ScryfallCard } from '../types'
import type { BuyerId, BuylistFeedProvenance, BuylistQuote } from '../buylist'
import type { CardLabel } from '../card-labels'
import type { CardLanguage } from '../card-language'
import type { PriceCurrency } from '../price-currency'
import type { PriceSource } from '../price-source'
import type { ChangelogPage } from '../changelog-parser'
import type { DeckFormatKey } from '../deck-format'
import type { LocaleTag } from '../i18n/types'

/**
 * One buyer's offers for the printings a list displays, baked at build time (or
 * per request by the live server) so sell mode needs no quote round trip.
 */
export type BakedBuylistQuotes = BuylistFeedProvenance & {
  /**
   * Sparse, keyed by `quoteKey(set, collectorNumber, finish)`: only printings
   * the buyer has a product for appear. An empty map means the list was quoted
   * and the buyer's catalog carries none of it — distinct from an absent
   * {@link BakedBuylist}, which means nothing was quoted at all.
   *
   * Presence here is *catalog membership*, deliberately not the same question as
   * `CardData.onBuylist`, which asks whether the buyer will take a copy today
   * (`buying`, i.e. at least one slot at a nonzero price). Paused entries are
   * baked on purpose: roughly half of Card Kingdom's feed is paused at any time,
   * and dropping those keys would throw away the only record that the buyer
   * stocks the printing at all — the difference between "they don't deal in
   * this card" and "they're full on it right now". It also keeps the map's
   * meaning identical to the live `/api/buylist/quotes` response, so the baked
   * and quoted paths cannot answer the same key differently.
   */
  quotes: Record<string, BuylistQuote>
}

/**
 * Per-buyer baked buylist offers for the cards of one list. Absent from a detail
 * entirely when the build (or the live server) had no feed to quote against, or
 * when nothing wants one (neither sell mode nor the `cardkingdom` price source).
 */
export type BakedBuylist = Partial<Record<BuyerId, BakedBuylistQuotes>>

/**
 * A deck line as it is baked into a detail: the parsed card plus the display
 * data only the site carries. Deliberately a site-side widening of {@link Card}
 * rather than a field on the engine type — `customArt` is never written to a
 * deck file, and the serializers must not learn about it.
 */
export interface BakedDeckCard extends Card {
  /**
   * Custom art replacing this card's Scryfall image: `art/<relpath>` for a
   * local file (served from the built site or by `serve --api`'s art route), or
   * the verbatim URL the list's `.art.json` sidecar named. Absent for cards with
   * no custom art, and for file references the build could not deploy.
   */
  customArt?: string
  /**
   * Whether the list's art sidecar gives this card custom art at all — the
   * "no price, no quote, no sale" fact, which {@link BakedDeckCard.customArt}
   * cannot answer on its own: a reference whose file the build could not deploy
   * bakes no display URL and still prices at nothing. Absent (never `false`)
   * for the cards that wear their own printing.
   */
  hasCustomArt?: boolean
}

export interface BakedDeckSection {
  name: string
  cards: BakedDeckCard[]
}

/** The deck a {@link DeckDetail} ships: {@link DeckData} with baked card lines. */
export interface BakedDeckData extends Omit<DeckData, 'sections'> {
  sections: BakedDeckSection[]
}

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
  deck: BakedDeckData
  /**
   * The deck's default card labels from its front matter, when declared. A
   * line's own `labels` override replaces it entirely — resolve the pair with
   * `effectiveLabels`, exactly as a collection's entries do.
   */
  labels?: CardLabel[]
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
  /** Baked buylist offers for this deck's printings; absent when nothing was quoted. */
  buylist?: BakedBuylist
}

export interface CollectionCardEntry {
  name: string
  set: string
  collectorNumber: string
  /**
   * Which finish this entry is *read* at, not necessarily the token its line
   * carries: the detail builder resolves a line with no `[finish]` through
   * `displayFinish`, so a foil-only printing reports `foil`. That is what the
   * price beside it was quoted at.
   *
   * Because of that, this value must not be fed to a serializer —
   * `formatCollectionLine` writes a `[finish]` token for anything but nonfoil,
   * so round-tripping it would stamp a token the source file never had. The
   * write path (`toCollectionCardEntries` in `editor/collection-changes.ts`)
   * deliberately keeps the line's own answer instead.
   */
  finish: Finish
  condition: Condition
  /**
   * The entry's language, resolved like `finish`: a bare line reads as `en`
   * (the write path's `toCollectionCardEntries` fills it in; baked site data
   * may leave it absent, which also means `en`). Unlike `finish`, feeding the
   * resolved value back to a serializer is safe — `formatCollectionLine`
   * omits the token for `en`, so bare lines round-trip as bare lines.
   */
  language?: CardLanguage
  /**
   * This card's label override, as written on its line. Effective labels are
   * this when present, else the list's `CollectionDetail.labels` default.
   */
  labels?: CardLabel[]
  /**
   * This entry's custom art, resolved like {@link BakedDeckCard.customArt}:
   * `art/<relpath>` for a local file, or the sidecar's URL verbatim.
   */
  customArt?: string
  /** Whether the sidecar gives this entry art, like {@link BakedDeckCard.hasCustomArt}. */
  hasCustomArt?: boolean
  /** Zero for a priceless entry — a proxy, or a copy wearing custom art. */
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
  /** Baked buylist offers for this collection's printings; absent when nothing was quoted. */
  buylist?: BakedBuylist
}

export type WantedListEntryState = 'name-only' | 'printing' | 'fully-specified'

export interface WantedListCardEntry {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** The line's language token, when present. Absent means `en`. */
  language?: CardLanguage
  /**
   * This entry's custom art, resolved like {@link BakedDeckCard.customArt}:
   * `art/<relpath>` for a local file, or the sidecar's URL verbatim.
   */
  customArt?: string
  /** Whether the sidecar gives this entry art, like {@link BakedDeckCard.hasCustomArt}. */
  hasCustomArt?: boolean
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
  /** Baked buylist offers for this wanted list's printings; absent when nothing was quoted. */
  buylist?: BakedBuylist
}

/** The JSON a list detail endpoint returns, across all three list kinds. */
export type ListDetail = DeckDetail | CollectionDetail | WantedListDetail

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
  /** The configured default card language, baked from config like {@link searchDebounceMs}. */
  defaultLanguage: CardLanguage
  /**
   * The UI locale this site was built for — the language its own chrome speaks,
   * never the card language ({@link SiteIndex.defaultLanguage}). Stamped into
   * `<html lang>` too, and the last tier of the browser's precedence chain: a
   * `?locale=` query, a stored choice, or `navigator.languages` all outrank it.
   */
  uiLocale: LocaleTag
  /**
   * Every locale this deployment publishes a dictionary for, English first. The
   * in-app language switcher appears only when there is more than one; each
   * non-English entry is fetchable at `locales/<tag>.json`.
   */
  availableLocales: LocaleTag[]
  /**
   * Base URL of a live read-only API backing this site. `''` = same origin
   * (injected by `ritual serve --api`, which serves index.json dynamically and
   * shadows any baked value); an absolute URL = split deployment (baked by
   * build-site from `site.apiBaseUrl`). Absent = fully static site.
   */
  apiBaseUrl?: string
  /**
   * Whether this site offers sell mode (buylist prices, filters, and the
   * sell-cart export), baked from `site.sellMode`. The quotes themselves ride
   * along in each list's detail as {@link BakedBuylist}, so this alone decides
   * whether the toggle appears — a static site offers sell mode too. Absent on
   * sites built before the feature existed, which reads as off.
   */
  sellMode?: boolean
  /**
   * The stores this site offers prices from, baked from the `priceSources`
   * config key. An empty array means the site displays no prices at all
   * (per-card prices, totals, price sort/filter/grouping, and the currency
   * selector are all hidden). Absent on sites built before the feature
   * existed, which reads as the default `['tcgplayer']`.
   */
  priceSources?: readonly PriceSource[]
}

export type TradeCardSource = 'collection' | 'deck' | 'wanted' | 'scryfall'

export interface TradeCardEntry {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** The source entry's language token, when present. Absent means `en`. */
  language?: CardLanguage
  /** Effective card labels of the source entry — collection and deck rows. */
  labels?: CardLabel[]
  /**
   * The source entry's baked custom art, when it has any. The row still shows
   * the real printing (it is the card being handed over); this only carries the
   * "no price" rule onto the board, where the row reads `CUSTOM` and counts as
   * nothing toward the column total.
   */
  customArt?: string
  /**
   * Whether the source entry has custom art at all, like
   * {@link BakedDeckCard.hasCustomArt} — the fact the board's price rule reads,
   * since a reference with no deployed file carries no display URL.
   */
  hasCustomArt?: boolean
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
