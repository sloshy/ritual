import type { ScryfallCard } from '../../scryfall/types'
import type { BuyerId, BuylistFeedProvenance } from '../../buylist'
import type { PrintingQuoteFn } from '../../cardkingdom/quote'
import type { PriceCurrency } from '../../pricing/price-currency'
import type { CardKingdomCards } from '../../list/site-data'

/**
 * Prefetched per-name card data the detail builders read. Key presence mirrors
 * which names were fetched: a name absent from `cards`/`printings` was never
 * resolved (e.g. blocklisted), which the builders render as `null` entries.
 */
export type SiteCardData = {
  /** Effective card per name: the USD representative when priced, else the fetched card. */
  cards: Record<string, ScryfallCard | null>
  /** All printings per fetched name. */
  printings: Record<string, ScryfallCard[]>
  /** Cheapest-or-representative card per name; only currencies being built have a map. */
  cheapest: Partial<Record<PriceCurrency, Record<string, ScryfallCard | null>>>
  /** Names with no price per currency, in fetch order. */
  missing: Partial<Record<PriceCurrency, readonly string[]>>
  /**
   * The Card Kingdom counterparts of {@link cards} and {@link cheapest}`.usd`:
   * the printing a name-only line displays, and the cheapest printing, chosen
   * from CK's catalog at CK's prices.
   *
   * Present only when the build had a CK feed to select against, and *sparse*
   * within that — a name CK carries no printing of has no entry. Both are
   * override layers over the Scryfall maps, never replacements: a client reads
   * `cardKingdom[name] ?? cards[name]`, so a card CK does not stock keeps its
   * usual printing and simply prices at nothing under the CK source.
   */
  cardKingdom?: CardKingdomCardData
}

/** The Card Kingdom printing selections for a build's cards. */
export type CardKingdomCardData = {
  cards: CardKingdomCards
  cheapest: CardKingdomCards
}

/**
 * What a detail builder needs to bake buylist offers into a list: which buyer is
 * being quoted, a cache-backed single-printing lookup, and the feed's own
 * freshness stamps.
 *
 * A seam rather than a feed handle so `src/site/` never reaches into a buyer's
 * matching engine: `detailBuylistContext` in `src/cardkingdom/bake.ts` is the
 * only producer, and both `build-site` and the live server use it — so the two
 * can never quote the same printing differently.
 */
export type DetailBuylistContext = BuylistFeedProvenance & {
  buyer: BuyerId
  /** Cache-backed single-printing lookup; null = buyer has no product for it. */
  quote: PrintingQuoteFn
  /**
   * Whether to quote every printing in the list's `printings` map as well as
   * the ones its tiles display.
   *
   * The card modal's other-printings grid and the printing pickers price
   * printings no tile shows, and a static site cannot fetch a quote it was not
   * given — so under the Card Kingdom *price source* those printings are baked
   * too, which is what lets the pickers follow the chosen source. A
   * sell-mode-only deployment leaves this off: its pickers stay on Scryfall
   * prices, and the extra quotes would be bytes nothing reads.
   */
  quotePrintings: boolean
}

/**
 * Everything a detail builder needs beyond the parsed list itself. Shared by
 * `build-site` (prefetched global maps plus build-time side effects) and the
 * live site server (cache-backed data, no side effects).
 */
export type SiteDetailContext = {
  cardData: SiteCardData
  /** Canonical card name for a lowercased query, or null when unknown. */
  resolveCardName: (name: string) => Promise<string | null>
  /** On-demand printings lookup for names outside the prefetched set. */
  getPrintings: (name: string) => Promise<ScryfallCard[]>
  /**
   * `set:collectorNumber` keys barred from representative-printing selection.
   * Threaded explicitly (not read from the config singleton) so the live
   * server's per-request config reload reaches every selection site.
   */
  bannedPrintings: ReadonlySet<string>
  /** Live reference — build-time symbol refreshes may add entries mid-build. */
  symbolMap: Record<string, string>
  useScryfallImgUrls: boolean
  defaultCurrency: PriceCurrency
  availableCurrencies: PriceCurrency[]
  pricesDate: string
  /**
   * Buylist quoting for this build/request. Present only when sell mode is on
   * *and* a buyer feed is loaded; absent means the detail ships no `buylist`
   * field at all.
   */
  buylist?: DetailBuylistContext
  /**
   * Art-dir-relative paths a build referenced but could not deploy (from
   * `deployCardArt`). Entries pointing at one of these bake no `customArt`, so
   * the card keeps its real art. Absent means every reference is baked — the
   * live server serves the art directory itself and has nothing to deploy.
   */
  missingArtFiles?: ReadonlySet<string>
  /** Build-time side effects for a card shipped in a detail (symbol + image downloads). */
  onCardShipped?: (card: ScryfallCard) => Promise<void>
  /** Sink for data-quality warnings (e.g. a printing that can't be found). */
  warn?: (message: string) => void
}
