/**
 * A printing's price under the active source: the figure for the finish it is
 * read at, with its other finishes listed underneath.
 *
 * Shared by the card modal's other-printings grid, the trade/edit printing
 * picker and the add-card dialog's printing step, so a printing shows the same
 * money in all three. The per-finish breakdown is what makes a foil-only or
 * etched printing legible: the primary line is what the copy would cost, and an
 * alternate line names its finish beside its price.
 *
 * It owns its own visibility gate as well as its formatting: a deployment with
 * `priceSources: []` shows no money anywhere, and leaving that check at the call
 * sites is how one of three of them came to forget it.
 *
 * Reactive by construction — {@link printingFinishPrices} is read inside a memo
 * here, so a source switch or an arriving Card Kingdom quote re-prices every
 * mounted tile without the host component doing anything.
 */

import { Index, Show, createMemo, type Component } from 'solid-js'
import type { PriceCurrency } from '../price-currency'
import { useT } from '../ui/i18n'
import { pricesEnabled } from './price-view'
import { finishChipName } from './printing-display'
import { printingFinishPrices, printingPriceText } from './printing-prices'
import type { ScryfallCard } from '../types'

export type PrintingPricesProps = {
  printing: ScryfallCard
  currency: PriceCurrency
  /** Extra class on the wrapper, for a host with its own price-line styling. */
  class?: string
}

export const PrintingPrices: Component<PrintingPricesProps> = (props) => {
  const t = useT()
  const prices = createMemo(() => printingFinishPrices(props.printing, props.currency))
  // The leading entry is the finish the printing is read at; the rest are its
  // alternates. Split here so the main line is static markup rather than a
  // per-row `i() > 0` branch.
  const main = createMemo(() => prices()[0]?.price ?? 0)
  const alternates = createMemo(() => prices().slice(1))
  const amount = (price: number): string => printingPriceText(t, price, props.currency)

  return (
    <Show when={pricesEnabled()}>
      <span class={props.class ? `printing-prices ${props.class}` : 'printing-prices'}>
        <span class="printing-price-main">{amount(main())}</span>
        {/* `Index`, not `For`: the finish rows are positional and fixed by the
            printing, while the memo hands back freshly built objects on every
            source switch and every arriving quote — reference keying would tear
            down and rebuild every row for a text change. */}
        <Index each={alternates()}>
          {(entry) => (
            <span class="printing-price-alt">
              {t('site.printingPrice.alternate', {
                price: amount(entry().price),
                finish: finishChipName(t, entry().finish),
              })}
            </span>
          )}
        </Index>
      </span>
    </Show>
  )
}
