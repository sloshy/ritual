import { type JSX, createMemo, type Accessor } from 'solid-js'
import type { CardData } from './card-sorting'
import { usePriceRefresh, type PriceRefresh, type PriceCardRef } from './usePriceRefresh'
import { useT } from '../ui/i18n'

type PublicPriceControlsInput = {
  /** The page's resolved cards, reactive — usually the page's `allCards` memo. */
  cards: Accessor<CardData[]>
  /** Build-time price date (ISO), used to anchor the staleness calculation. */
  pricesDate?: string
}

/**
 * Shared wiring for the "Update Prices" + price-staleness controls. Derives the
 * price-card refs from the page's resolved cards. Whether the controls actually
 * render is decided by the page's `enablePriceRefresh` prop (true on the public
 * site, read-only or editing; false for the admin editor / Move Cards reuse).
 */
export function usePublicPriceControls(input: PublicPriceControlsInput): PriceRefresh {
  const priceCardRefs = createMemo<PriceCardRef[]>(() =>
    input
      .cards()
      .filter((c) => c.card)
      .map((c) => ({ id: c.card!.id, name: c.name })),
  )
  return usePriceRefresh({ cards: priceCardRefs, pricesDate: () => input.pricesDate })
}

type UpdatePricesButtonProps = {
  prices: PriceRefresh
}

/** The header "Update Prices" button shared by the public list pages. */
export function UpdatePricesButton(props: UpdatePricesButtonProps): JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      onClick={props.prices.refresh}
      disabled={props.prices.refreshing()}
      class="btn btn-primary btn-update-prices"
      aria-label={t('site.prices.update')}
      title={t('site.prices.update')}
    >
      {props.prices.refreshing() ? t('site.prices.updating') : t('site.prices.update')}
    </button>
  )
}
