import { batch, createSignal, untrack, type Accessor } from 'solid-js'
import { DEFAULT_CURRENCY, type PriceCurrency } from '../../../pricing/price-currency'
import {
  resolveSiteStores,
  settleCurrency,
  sourceCurrency,
  type PriceSource,
} from '../../../pricing/price-source'
import { setDefaultPriceSource, setEnabledPriceSources } from '../../../list-view/price-view'
import { pickPriceStore } from '../../../list-view/PriceStoreSelect'
import { fetchRitualConfig } from '../config-api'

// Module-level so every admin page shares one view and a fetch kicked off by
// one page updates the others. Starts at USD until the config arrives.
const [currency, setCurrency] = createSignal<PriceCurrency>(DEFAULT_CURRENCY)

/**
 * Whether the user picked a store from the header this session. The config's
 * default applies until then, and never overrides a pick afterwards — the
 * per-page config re-fetch would otherwise throw the user back to the default
 * on every navigation.
 */
let pickedFromHeader = false

/** The admin's price view: the currency of the store in force. */
export type AdminPriceView = {
  currency: Accessor<PriceCurrency>
}

/**
 * Seed the price view from the config's `defaultPriceSource` and
 * `priceSources` — the admin counterpart of the public site reading them off
 * `index.json`, resolved by the same rule (`resolveSiteStores`), so the
 * admin opens on the store the sites open on. Settings calls it after a save.
 */
export function applyPriceConfig(
  defaultPriceSource: PriceSource | undefined,
  priceSources: readonly PriceSource[],
): void {
  const resolved = resolveSiteStores(priceSources, defaultPriceSource)
  batch(() => {
    setEnabledPriceSources(priceSources)
    setDefaultPriceSource(resolved.defaultSource)
    // Until the header is used, the default store's currency applies. A
    // header pick stands across re-seeds unless a Settings save took its
    // currency away; then it settles exactly as the public site does.
    setCurrency(
      pickedFromHeader
        ? settleCurrency(untrack(currency), resolved.stores, resolved.defaultSource)
        : sourceCurrency(resolved.defaultSource),
    )
  })
}

/** The header store picker's switch: the store's currency and, for USD, its source. */
export function pickAdminPriceStore(source: PriceSource): void {
  pickedFromHeader = true
  pickPriceStore(source, setCurrency)
}

/**
 * The admin's price view, as reactive accessors. Each call (each page mount)
 * re-fetches `/api/config`, so a change made on the Settings page is picked up
 * when navigating to a price-displaying page. Falls back to USD while loading
 * or when the fetch fails.
 */
export function usePriceView(): AdminPriceView {
  void fetchRitualConfig().then((config) => {
    if (config) applyPriceConfig(config.defaultPriceSource, config.priceSources)
  })
  return { currency }
}
