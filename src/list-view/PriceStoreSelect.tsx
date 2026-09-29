/**
 * The header's price-store picker: which store every price in view comes
 * from, anywhere in the app — the index tiles and Quick Switch included. A
 * store names its currency (TCGplayer and Card Kingdom are USD, Cardmarket is
 * EUR, Cardhoarder is MTGO tix), so this one control replaces a currency
 * switcher and a USD-source switcher. Both SPAs render it in their header.
 *
 * Renders nothing unless there is a real choice: a deployment offering one
 * store (or none — `priceSources: []`) shows no dropdown.
 */

import { For, Show, batch, createMemo, type Component } from 'solid-js'
import { useT } from '../ui/i18n'
import type { PriceCurrency } from '../pricing/price-currency'
import {
  PRICE_SOURCE_LABELS,
  isPriceSource,
  isUsdPriceSource,
  sourceCurrency,
  type PriceSource,
} from '../pricing/price-source'
import { notifyCurrencyChanged } from './currency-epoch'
import { activePriceSource, offeredPriceSources, selectUsdSource } from './price-view'

/**
 * Switch the whole app to a store: its currency, and for a USD store the USD
 * source (an explicit pick, which sell mode's courtesy default never
 * overrides). Batched with the currency epoch so price filters pinned to the
 * old figures clear in the same pass, exactly as a currency switch did.
 */
export function pickPriceStore(
  source: PriceSource,
  setCurrency: (currency: PriceCurrency) => void,
): void {
  batch(() => {
    if (isUsdPriceSource(source)) selectUsdSource(source)
    setCurrency(sourceCurrency(source))
    notifyCurrencyChanged()
  })
}

export type PriceStoreSelectProps = {
  /** The currency in view; with the active USD source it names the selected store. */
  currency: PriceCurrency
  onChange: (source: PriceSource) => void
}

export const PriceStoreSelect: Component<PriceStoreSelectProps> = (props) => {
  const t = useT()
  const offered = createMemo(() => offeredPriceSources())
  const selected = (): PriceSource => activePriceSource(props.currency)
  return (
    <Show when={offered().length > 1}>
      <div class="currency-selector price-store-selector">
        <label class="currency-label" for="price-store">
          {t('site.header.pricesLabel')}
        </label>
        <select
          id="price-store"
          class="currency-select"
          value={selected()}
          onChange={(e) => {
            // The options below are the only values this can produce, but go
            // through the guard rather than asserting the union onto a string.
            const next = e.currentTarget.value
            if (isPriceSource(next) && next !== selected()) props.onChange(next)
          }}
        >
          {/* `selected` markers, not just the select's `value` binding: the
              offered set changes when the async config seed lands, and a value
              bound before its option existed would strand the control on the
              browser's first-option fallback. */}
          <For each={offered()}>
            {(source) => (
              <option value={source} selected={source === selected()}>
                {/* The store name alone: its currency shows on every price, and
                    the header has no width to spare for a longer label. */}
                {t(PRICE_SOURCE_LABELS[source])}
              </option>
            )}
          </For>
        </select>
      </div>
    </Show>
  )
}
