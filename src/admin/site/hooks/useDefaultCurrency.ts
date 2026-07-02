import { createSignal, type Accessor } from 'solid-js'
import { DEFAULT_CURRENCY, type PriceCurrency } from '../../../price-currency'
import { fetchRitualConfig } from '../config-api'

// Module-level so every admin page shares one value and a fetch kicked off by
// one page updates the others. Starts at USD until the config arrives.
const [defaultCurrency, setDefaultCurrency] = createSignal<PriceCurrency>(DEFAULT_CURRENCY)

/**
 * The configured default price currency, as a reactive accessor. Each call
 * (each page mount) re-fetches `/api/config`, so a change made on the Settings
 * page is picked up when navigating to a price-displaying page. Falls back to
 * USD while loading or when the fetch fails.
 */
export function useDefaultCurrency(): Accessor<PriceCurrency> {
  void fetchRitualConfig().then((config) => {
    if (config) setDefaultCurrency(config.defaultCurrency)
  })
  return defaultCurrency
}
