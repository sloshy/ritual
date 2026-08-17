import type { ScryfallCard } from '../../types'
import type {
  BuyerId,
  BuylistFeedProvenance,
  BuylistQuote,
  BuylistQuoteRequest,
} from '../../buylist'
import type { PriceCurrency } from '../../price-currency'

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
  quote: (printing: BuylistQuoteRequest) => BuylistQuote | null
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
