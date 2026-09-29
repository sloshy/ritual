import type { Accessor } from 'solid-js'
import type { PriceCurrency } from '../../../pricing/price-currency'
import { resolveSiteStores, type PriceSource } from '../../../pricing/price-source'
import { activeCurrency, seedPriceView } from '../../../list-view/price-view'
import { fetchRitualConfig } from '../config-api'

/** The admin's price view: the currency of the store in force. */
export type AdminPriceView = {
  currency: Accessor<PriceCurrency>
}

/**
 * Seed the shared price view from the config's `defaultPriceSource` and
 * `priceSources` — the admin counterpart of the public site reading them off
 * `index.json`, resolved by the same rule (`resolveSiteStores`), so the admin
 * opens on the store the sites open on. A store picked in the header outlives
 * every re-seed. Settings calls it after a save.
 */
export function applyPriceConfig(
  defaultPriceSource: PriceSource | undefined,
  priceSources: readonly PriceSource[],
): void {
  const resolved = resolveSiteStores(priceSources, defaultPriceSource)
  seedPriceView({ stores: resolved.stores, defaultSource: resolved.defaultSource })
}

/**
 * The admin's price view. Each call (each page mount) re-fetches
 * `/api/config`, so a change made on the Settings page is picked up when
 * navigating to a price-displaying page. The view follows the store in force
 * (USD until the config arrives), and the currency is always that store's.
 */
export function usePriceView(): AdminPriceView {
  void fetchRitualConfig().then((config) => {
    if (config) applyPriceConfig(config.defaultPriceSource, config.priceSources)
  })
  return { currency: activeCurrency }
}
