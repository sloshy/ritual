/**
 * What one printing costs, per finish, under the price source the user is
 * currently looking at.
 *
 * The printing pickers and the card modal's other-printings grid all answer the
 * same two questions — "what does this printing cost?" and "what do its other
 * finishes cost?" — and used to answer them three different ways (a raw
 * `prices.usd` read with a foil/etched fallback, a `getCardPriceForFinish` of
 * the default finish, an inline per-finish list). This module is the one
 * answer, so a printing is priced identically wherever it is offered.
 *
 * Source-aware by construction: every figure goes through
 * {@link sitePriceForFinish}, so the Card Kingdom view reads CK retail off the
 * quote store and the TCGplayer/Cardmarket views read Scryfall. Callers must
 * evaluate this inside a memo — it reads the source signal and (on the CK path)
 * the quote store, which is what re-prices an open picker when the source is
 * switched or quotes arrive.
 */

import { defaultPrintingFinish, printingFinishes } from '../finish-condition'
import type { TranslateFn } from '../i18n/t'
import { formatPrice, type PriceCurrency } from '../price-currency'
import { sitePriceForFinish } from './price-view'
import type { Finish, ScryfallCard } from '../types'

/**
 * How a printing's price is written wherever one is shown: the formatted amount,
 * or the "no price" stand-in when the selected store publishes none.
 *
 * A named function rather than an inline ternary per surface, and deliberately
 * *not* `price-currency`'s `formatPriceOrNA`, whose miss branch is a hardcoded
 * English `'N/A'` — that function is shared with the CLI and holds no locale.
 * `t` is passed in (the `printing-display` convention) so a locale switch
 * re-renders the stand-in rather than freezing it at module load.
 */
export function printingPriceText(t: TranslateFn, price: number, currency: PriceCurrency): string {
  return price > 0 ? formatPrice(price, currency) : t('site.printingPrice.na')
}

/** One finish of a printing and what it costs; 0 means the source has no price. */
export type PrintingFinishPrice = {
  finish: Finish
  price: number
}

/**
 * A printing's finishes and prices, the finish it is read at first.
 *
 * "Read at" is {@link defaultPrintingFinish} — nonfoil where the printing is
 * offered in it, else its first finish — so the leading figure is the one a
 * tile that displays this printing would charge, and the rest are the
 * alternates a picker offers instead. Every finish the printing publishes gets
 * an entry even when the source has no price for it: a foil-only quote under a
 * nonfoil card is information, and hiding the row would make the finish look
 * unavailable rather than unpriced.
 */
export function printingFinishPrices(
  printing: ScryfallCard,
  currency: PriceCurrency,
): PrintingFinishPrice[] {
  const primary = defaultPrintingFinish(printing)
  const ordered: Finish[] = [primary, ...printingFinishes(printing).filter((f) => f !== primary)]
  return ordered.map((finish) => ({
    finish,
    price: sitePriceForFinish(printing, finish, currency),
  }))
}

/**
 * The single figure a printing sorts and compares by: its price at the finish
 * it is read at. Used by the other-printings grid's price sort and the add-card
 * flow's cheapest-printing preselection, so both follow the chosen source
 * rather than ranking by a store the user is not looking at.
 */
export function printingSortPrice(printing: ScryfallCard, currency: PriceCurrency): number {
  return sitePriceForFinish(printing, defaultPrintingFinish(printing), currency)
}
