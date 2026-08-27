import { cardCache } from '../cache'
import type { PrintingQuoteFn } from '../cardkingdom/quote'
import {
  emptySiteCardData,
  pickDisplayPrintings,
  recordDisplayPrintings,
} from '../site-build/card-fetch'
import type { SiteCardData } from '../site-build/types'
import type { ScryfallCard } from '../scryfall/types'
import type { PriceCurrency } from '../pricing/price-currency'

export type CacheCardSourceOptions = {
  currencies: PriceCurrency[]
  bannedPrintings: ReadonlySet<string>
  /**
   * Card Kingdom's single-printing lookup, when this pass offers CK prices.
   * Present means the source also picks CK's own representative and cheapest
   * printings, exactly as `build-site` bakes them; absent leaves the CK maps off
   * the payload entirely.
   */
  cardKingdomQuote?: PrintingQuoteFn
}

/**
 * Cache-only card data for the live site server. Unlike the build-site fetch
 * loop there is no Scryfall fallback — a name missing from the cache yields a
 * `null` card entry (which the site already renders), keeping request latency
 * bounded. `/api/card-printings` and `/api/card-prices` remain the on-demand
 * fresh paths.
 */
export type CacheCardSource = {
  /** Prefetched data for the names passed to {@link createCacheCardSource}. */
  cardData: SiteCardData
  /** Cache-only printings lookup; unknown names yield an empty array. */
  getPrintings: (name: string) => Promise<ScryfallCard[]>
  resolveCardName: (name: string) => Promise<string | null>
}

export async function createCacheCardSource(
  names: readonly string[],
  options: CacheCardSourceOptions,
): Promise<CacheCardSource> {
  const { currencies, bannedPrintings, cardKingdomQuote } = options
  const printingsMemo = new Map<string, ScryfallCard[]>()

  // One round trip against an HTTP cache backend instead of one call per card.
  const unique = [...new Set(names)]
  const fetched = await cardCache.streamGetMany(unique, () => {})
  const cardData = emptySiteCardData(currencies)
  for (const name of unique) {
    const printings = fetched[name] ?? []
    printingsMemo.set(name, printings)
    // The same picks `build-site` bakes, so a live-served page and a built one
    // show the same printing for the same name-only line.
    const picks = pickDisplayPrintings({
      printings,
      card: printings[0] ?? null,
      currencies,
      bannedPrintings,
      ckQuote: cardKingdomQuote,
    })
    recordDisplayPrintings(cardData, name, printings, picks)
  }

  return {
    cardData,
    getPrintings: async (name) => {
      const memoized = printingsMemo.get(name)
      if (memoized) return memoized
      const printings = (await cardCache.get(name)) ?? []
      printingsMemo.set(name, printings)
      return printings
    },
    resolveCardName: (name) => cardCache.resolveCardName(name),
  }
}
