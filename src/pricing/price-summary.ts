import type { PriceCurrency } from './price-currency'

/** Pick a numeric value from an object based on the active currency. */
export function getCurrencyValue(
  usd: number | undefined,
  eur: number | undefined,
  tix: number | undefined,
  currency: PriceCurrency,
): number {
  if (currency === 'eur') return eur ?? 0
  if (currency === 'tix') return tix ?? 0
  return usd ?? 0
}

/** A summary's per-currency figures for one base metric (`totalPrice`, `lowestPrice`, …). */
export type CurrencyFields<Base extends string> = {
  [K in Base | `${Base}Eur` | `${Base}Tix`]?: number
}

export function getSummaryTotalPrice(
  item: CurrencyFields<'totalPrice'>,
  currency: PriceCurrency,
): number {
  return getCurrencyValue(item.totalPrice, item.totalPriceEur, item.totalPriceTix, currency)
}

export function getSummaryLowestPrice(
  item: CurrencyFields<'lowestPrice'>,
  currency: PriceCurrency,
): number {
  return getCurrencyValue(item.lowestPrice, item.lowestPriceEur, item.lowestPriceTix, currency)
}

export function getSummaryMissingPriceCount(
  item: CurrencyFields<'missingPriceCount'>,
  currency: PriceCurrency,
): number {
  return getCurrencyValue(
    item.missingPriceCount,
    item.missingPriceCountEur,
    item.missingPriceCountTix,
    currency,
  )
}
