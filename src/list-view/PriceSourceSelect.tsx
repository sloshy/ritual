/**
 * The in-dialog price-source selector: which store the USD prices in view come
 * from, offered inside the card modal's other-printings grid and the printing
 * pickers (the header's `PriceStoreSelect` is the page-level control).
 *
 * One component rather than one control per dialog, because the choice is one
 * module-level signal (`price-view`'s `usdSource`): switching it in a dialog
 * switches the header and the page too — which is exactly the "the picker
 * follows the page" behaviour a second, local copy of the state would break.
 *
 * Renders nothing unless there is a real choice to make ({@link
 * offersUsdSourceChoice}: the USD view with more than one USD store enabled),
 * so a deployment with a single store never shows a one-option dropdown.
 *
 * Switching bumps the currency epoch exactly as a currency switch does: every
 * price on the page just changed, so price filters pinned to the old figures
 * must be cleared whether the change came from the header or from a dialog.
 */

import { For, Show, type Component } from 'solid-js'
import { useT } from '../ui/i18n'
import type { PriceCurrency } from '../pricing/price-currency'
import { notifyCurrencyChanged } from './currency-epoch'
import {
  PRICE_SOURCE_LABELS,
  activeUsdSource,
  offersUsdSourceChoice,
  selectUsdSource,
  usdSourceChoices,
} from './price-view'

/**
 * The mounted instances, enumerated so a duplicate id is a compile error rather
 * than two controls sharing a `<label for>`.
 */
export type PriceSourceSelectId =
  'card-modal-price-source' | 'trade-picker-price-source' | 'add-card-price-source'

export type PriceSourceSelectProps = {
  /** The currency in view; the control hides itself outside USD. */
  currency: PriceCurrency
  /** DOM id for the select, so the label points at it. */
  id: PriceSourceSelectId
  /** Extra class on the wrapper, for a host that has its own group styling. */
  groupClass?: string
  /** Extra class on the label, for a host that has its own label styling. */
  labelClass?: string
  /** Extra class on the select, for a host that has its own control styling. */
  selectClass?: string
}

export const PriceSourceSelect: Component<PriceSourceSelectProps> = (props) => {
  const t = useT()
  const cls = (base: string, extra: string | undefined): string =>
    extra ? `${base} ${extra}` : base

  return (
    <Show when={offersUsdSourceChoice(props.currency)}>
      <div class={cls('price-source-control', props.groupClass)}>
        <label class={cls('price-source-label', props.labelClass)} for={props.id}>
          {t('site.priceSource.label')}
        </label>
        <select
          id={props.id}
          class={cls('price-source-select', props.selectClass)}
          value={activeUsdSource()}
          onChange={(e) => {
            const raw = e.currentTarget.value
            const choice = usdSourceChoices().find((source) => source === raw)
            if (!choice || choice === activeUsdSource()) return
            selectUsdSource(choice)
            notifyCurrencyChanged()
          }}
        >
          <For each={usdSourceChoices()}>
            {(source) => (
              <option value={source} selected={source === activeUsdSource()}>
                {t(PRICE_SOURCE_LABELS[source])}
              </option>
            )}
          </For>
        </select>
      </div>
    </Show>
  )
}
