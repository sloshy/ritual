import { cardCache } from '../cache'
import { computeRepresentativePrints } from '../scryfall'
import { sortPrintingsByRelease } from '../site/details/shared'
import type { SiteCardData } from '../site/details/types'
import type { ScryfallCard } from '../types'
import type { PriceCurrency } from '../price-currency'

export type CacheCardSourceOptions = {
  currencies: PriceCurrency[]
  bannedPrintings: ReadonlySet<string>
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
  const { currencies, bannedPrintings } = options
  const printingsMemo = new Map<string, ScryfallCard[]>()

  // One round trip against an HTTP cache backend instead of one call per card.
  const unique = [...new Set(names)]
  const fetched = await cardCache.streamGetMany(unique, () => {})
  for (const name of unique) {
    printingsMemo.set(name, fetched[name] ?? [])
  }

  const cardData: SiteCardData = { cards: {}, printings: {}, cheapest: {}, missing: {} }
  const missing: Partial<Record<PriceCurrency, string[]>> = {}
  for (const cur of currencies) {
    cardData.cheapest[cur] = {}
    missing[cur] = []
  }

  for (const name of unique) {
    const printings = printingsMemo.get(name) ?? []
    cardData.printings[name] = printings
    // Mirrors the build fetch loop: the shipped card is the USD representative
    // when priced, else the raw cached card (the cache's first printing).
    const base = printings[0] ?? null
    const sorted = sortPrintingsByRelease(printings)
    const repPrints = computeRepresentativePrints(sorted, sorted, currencies, bannedPrintings)
    const usdRep = repPrints.usd?.representative ?? null
    cardData.cards[name] = currencies.includes('usd') && usdRep ? usdRep : base
    for (const cur of currencies) {
      const rep = repPrints[cur]?.representative ?? null
      const cheap = repPrints[cur]?.cheapest ?? null
      if (!rep) missing[cur]!.push(name)
      cardData.cheapest[cur]![name] = cheap ?? rep ?? base
    }
  }
  cardData.missing = missing

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
