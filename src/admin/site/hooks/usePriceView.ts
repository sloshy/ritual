import { batch, createSignal, untrack, type Accessor } from 'solid-js'
import {
  DEFAULT_CURRENCY,
  VALID_CURRENCIES,
  type PriceCurrency,
} from '../../../pricing/price-currency'
import {
  resolveSiteCurrencies,
  sourceCurrency,
  type PriceSource,
} from '../../../pricing/price-source'
import {
  activePriceSource,
  offeredPriceSources,
  setDefaultPriceSource,
  setEnabledPriceSources,
} from '../../../list-view/price-view'
import { pickPriceStore } from '../../../list-view/PriceStoreSelect'
import { fetchRitualConfig } from '../config-api'

// Module-level so every admin page shares one view and a fetch kicked off by
// one page updates the others. Starts at USD until the config arrives.
const [currency, setCurrency] = createSignal<PriceCurrency>(DEFAULT_CURRENCY)
const [available, setAvailable] = createSignal<readonly PriceCurrency[]>(VALID_CURRENCIES)

/**
 * Whether the user picked a store from the header this session. The config's
 * default applies until then, and never overrides a pick afterwards — the
 * per-page config re-fetch would otherwise throw the user back to the default
 * on every navigation.
 */
let pickedFromHeader = false

/** The admin's price view: the currency in force and the currencies it offers. */
export type AdminPriceView = {
  currency: Accessor<PriceCurrency>
  available: Accessor<readonly PriceCurrency[]>
}

/**
 * Seed the price view from the config's `defaultPriceSource` and
 * `priceSources` — the admin counterpart of the public site reading them off
 * `index.json`, resolved by the same rule (`resolveSiteCurrencies`), so the
 * admin opens on the store the sites open on. Settings calls it after a save.
 */
export function applyPriceConfig(
  defaultPriceSource: PriceSource | undefined,
  priceSources: readonly PriceSource[],
): void {
  const resolved = resolveSiteCurrencies(priceSources, defaultPriceSource)
  batch(() => {
    setEnabledPriceSources(priceSources)
    setAvailable(resolved.available)
    setDefaultPriceSource(resolved.defaultSource)
    // A header pick stands across re-seeds — unless a Settings save just took
    // its store away, which would strand the picker on a store it no longer
    // lists (the public site settles the same way in `app.tsx`).
    const offered = offeredPriceSources(resolved.available)
    if (!pickedFromHeader || !offered.includes(activePriceSource(untrack(currency)))) {
      setCurrency(sourceCurrency(resolved.defaultSource))
    }
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
  return { currency, available }
}
