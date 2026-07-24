import type { ScryfallCard } from '../../types'
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
  /** Build-time side effects for a card shipped in a detail (symbol + image downloads). */
  onCardShipped?: (card: ScryfallCard) => Promise<void>
  /** Sink for data-quality warnings (e.g. a printing that can't be found). */
  warn?: (message: string) => void
}
