import { createMemo, createSignal, type Accessor } from 'solid-js'
import { batchFetchScryfall } from './scryfall-collection'
import { batchFetchApiPrices } from './api-prices'
import { apiActive } from './api-base'
import { getUpdatedAt, putFetchedCards, sessionCacheVersion } from './session-cache'

/** A card in a list, reduced to what price-refresh needs: its Scryfall id and display name. */
export type PriceCardRef = {
  id: string
  name: string
}

export type PriceRefresh = {
  /** Fetch fresh prices for the list's cards from Scryfall into the session cache. */
  refresh: () => void
  refreshing: Accessor<boolean>
  /** Names of cards whose prices are older than the freshest in the list (mixed dates). */
  outdatedNames: Accessor<string[]>
}

type PriceRefreshInput = {
  /** The list's currently displayed cards (Scryfall id + name), reactive. */
  cards: Accessor<PriceCardRef[]>
  /** Baked price date (ISO) shipped with the list, if any. */
  pricesDate?: Accessor<string | undefined>
}

/**
 * Pure staleness rule: a card is outdated when another card in the list carries a
 * newer price. A card with no in-session refresh (`updatedAt` null/undefined) is
 * treated as old as the build (`pricesDate`), so the list reads as uniform until a
 * partial refresh introduces a mix. Returns the distinct names, in list order.
 */
export function outdatedCardNames(
  refs: PriceCardRef[],
  updatedAtOf: (id: string) => number | null | undefined,
  pricesDate: string | undefined,
): string[] {
  const parsed = pricesDate ? Date.parse(pricesDate) : Number.NaN
  const bakedEpoch = Number.isNaN(parsed) ? 0 : parsed
  const effective = (id: string): number => {
    const updated = updatedAtOf(id)
    return updated == null ? bakedEpoch : updated
  }
  let newest = bakedEpoch
  for (const ref of refs) newest = Math.max(newest, effective(ref.id))
  const names: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (effective(ref.id) < newest && !seen.has(ref.name)) {
      seen.add(ref.name)
      names.push(ref.name)
    }
  }
  return names
}

/**
 * Drives the "Update Prices" button and the price-staleness disclaimer on a public
 * list page. Refreshing batch-fetches the list's cards from Scryfall into the shared
 * session cache (which bumps {@link sessionCacheVersion}, so overlaid prices re-render);
 * it is a no-op until the user presses the button. Cards left at the older build-time
 * price after a partial refresh are reported via {@link PriceRefresh.outdatedNames}.
 */
export function usePriceRefresh(input: PriceRefreshInput): PriceRefresh {
  const [refreshing, setRefreshing] = createSignal(false)

  const refresh = (): void => {
    if (refreshing()) return

    // Live backend: ask its batch price endpoint by name (the server's cache is
    // name-keyed and refreshes stale prices from Scryfall server-side). The
    // returned printings include the displayed ids, so overlays and the
    // staleness accounting work unchanged.
    if (apiActive()) {
      const names = [
        ...new Set(
          input
            .cards()
            .map((c) => c.name)
            .filter((name) => name !== ''),
        ),
      ]
      if (names.length === 0) return
      setRefreshing(true)
      void batchFetchApiPrices(names)
        .then((cards) => putFetchedCards(cards, Date.now()))
        .finally(() => setRefreshing(false))
      return
    }

    const ids = [
      ...new Set(
        input
          .cards()
          .map((c) => c.id)
          .filter((id) => id !== ''),
      ),
    ]
    if (ids.length === 0) return
    setRefreshing(true)
    void batchFetchScryfall(ids)
      .then((fetched) => putFetchedCards(fetched.values(), Date.now()))
      .finally(() => setRefreshing(false))
  }

  const outdatedNames = createMemo<string[]>(() => {
    sessionCacheVersion() // re-derive whenever a refresh lands
    return outdatedCardNames(input.cards(), getUpdatedAt, input.pricesDate?.())
  })

  return { refresh, refreshing, outdatedNames }
}
