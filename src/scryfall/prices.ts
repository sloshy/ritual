/**
 * Representative/cheapest printing selection over cached Scryfall price
 * fields — the free half of the client's pricing backend.
 */
import type { ScryfallCard } from './types'
import { getCardPrice, type PriceCurrency } from '../pricing/price-currency'
import {
  NO_BANNED_PRINTINGS,
  selectCheapestPrinting,
  selectRepresentativePrinting,
  type PrintingPriceFn,
} from '../card/printing-select'

export type CurrencyPrint = {
  representative: ScryfallCard | null
  cheapest: ScryfallCard | null
}

export type RepresentativePrintsResult = Partial<Record<PriceCurrency, CurrencyPrint>>

export type MinMaxPrice = {
  min: number
  max: number
}

/**
 * Compute representative and cheapest prints from cached card data, per
 * currency, against Scryfall's own price fields.
 * @param recentPrintings - Printings sorted by release date descending, used to pick the representative.
 * @param allPrintings - All printings for the card, used to find the cheapest.
 * @param bannedPrintings - `set:collectorNumber` keys (set code lowercased) that must
 *   never be chosen as the representative; the selection slides to the next eligible
 *   printing. Banned printings still count toward `cheapest`.
 */
export function computeRepresentativePrints(
  recentPrintings: ScryfallCard[],
  allPrintings: ScryfallCard[],
  currencies: PriceCurrency[],
  bannedPrintings: ReadonlySet<string> = NO_BANNED_PRINTINGS,
): RepresentativePrintsResult {
  const result: RepresentativePrintsResult = {}

  for (const currency of currencies) {
    // The shared reader, so a malformed price string reads as "no price" (0)
    // rather than a NaN that would win or lose every comparison by accident.
    const priceOf: PrintingPriceFn = (card) => getCardPrice(card, currency)

    result[currency] = {
      representative: selectRepresentativePrinting(recentPrintings, priceOf, bannedPrintings),
      cheapest: selectCheapestPrinting(allPrintings, priceOf),
    }
  }

  return result
}
