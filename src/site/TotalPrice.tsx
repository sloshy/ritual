import type { Component } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'
import type { MessageSegment } from '../i18n/types'
import {
  describeTotalPrice,
  formatPriceWithMissing,
  type PriceCurrency,
} from '../pricing/price-currency'

type TotalPriceProps = {
  amount: number
  currency: PriceCurrency
  /** Whether the total is an estimate (prefixed "~"). */
  estimated: boolean
  /** Copies with no price (suffixed "+ (N unpriced)"); omit where a total never reports them. */
  missing?: number
}

/** Both renderings of one total; `spoken` only when the short form uses symbols. */
type TotalPriceText = { short: string; spoken: string | undefined }

/**
 * A list total in its short form ("~$12.34+ (3 unpriced)"). A qualified total
 * hides its "~" and "+" from screen readers, which would read them as symbols,
 * and gives them the spelled-out form instead, which is also its hover title.
 */
export const TotalPrice: Component<TotalPriceProps> = (props) => {
  // One memo, so each input (some callers pass an O(n) sum) is read once per
  // update. The formatters read the locale signal themselves.
  const text = createMemo((): TotalPriceText => {
    const missing = props.missing ?? 0
    return {
      short: formatPriceWithMissing(props.amount, props.currency, missing, props.estimated),
      spoken: describeTotalPrice(props.amount, props.currency, missing, props.estimated),
    }
  })
  return (
    <Show when={text().spoken} fallback={text().short}>
      {(spoken) => (
        <span title={spoken()}>
          <span aria-hidden="true">{text().short}</span>
          <span class="visually-hidden">{spoken()}</span>
        </span>
      )}
    </Show>
  )
}

type TotalPriceMessageProps = TotalPriceProps & {
  /** The message around the total; its `{amount}` parameter renders as a {@link TotalPrice}. */
  segments: MessageSegment[]
}

/** A message such as "Total: {amount}" whose amount is a {@link TotalPrice}. */
export const TotalPriceMessage: Component<TotalPriceMessageProps> = (props) => (
  <For each={props.segments}>
    {(segment) =>
      segment.kind === 'param' && segment.name === 'amount' ? (
        <TotalPrice
          amount={props.amount}
          currency={props.currency}
          estimated={props.estimated}
          missing={props.missing}
        />
      ) : (
        segment.value
      )
    }
  </For>
)
