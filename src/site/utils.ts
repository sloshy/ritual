import type { PriceCurrency } from '../price-currency'

export { capitalize } from '../utils'

/**
 * Whether a caught error is a `fetch` cancelled through its `AbortSignal`.
 * Abort rejections are `DOMException`s, which extend `Error`, so one check
 * covers every runtime — the single authoritative predicate for the site.
 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

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

type TotalPriceFields = {
  totalPrice?: number
  totalPriceEur?: number
  totalPriceTix?: number
}

type LowestPriceFields = {
  lowestPrice?: number
  lowestPriceEur?: number
  lowestPriceTix?: number
}

type MissingPriceCountFields = {
  missingPriceCount?: number
  missingPriceCountEur?: number
  missingPriceCountTix?: number
}

export function getSummaryTotalPrice(item: TotalPriceFields, currency: PriceCurrency): number {
  return getCurrencyValue(item.totalPrice, item.totalPriceEur, item.totalPriceTix, currency)
}

export function getSummaryLowestPrice(item: LowestPriceFields, currency: PriceCurrency): number {
  return getCurrencyValue(item.lowestPrice, item.lowestPriceEur, item.lowestPriceTix, currency)
}

export function getSummaryMissingPriceCount(
  item: MissingPriceCountFields,
  currency: PriceCurrency,
): number {
  return getCurrencyValue(
    item.missingPriceCount,
    item.missingPriceCountEur,
    item.missingPriceCountTix,
    currency,
  )
}
