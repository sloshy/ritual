/**
 * Money rules shared by every buylist surface. Browser-safe, so the CLI report
 * engine and the site compute the same figures — `ritual sell` and the site's
 * sell value are documented to agree, and that only holds if they round alike.
 */

import type { PriceCurrency } from '../pricing/price-currency'

/**
 * The currency every buylist figure is in: buyers quote cash in their own
 * currency (USD for Card Kingdom), never the page's selected display currency.
 * Pinned so a spread never subtracts a EUR price from a USD offer, and so
 * bucket labels are never mislabelled with the display currency's symbol.
 */
export const BUYLIST_CURRENCY = 'usd' satisfies PriceCurrency

/** Keep sums presentable: buylist math is cents, floats drift. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}
