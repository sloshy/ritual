/**
 * The pure price formatters every priced CLI view shares — `price`, its
 * interactive browser and `lists --summary` — kept apart from the browser so
 * a printed report never loads the interactive prompts.
 */

import { t } from '../i18n/t'
import { formatDateTime } from '../ui/format'
import { formatPrice, formatTotalPrice, type PriceCurrency } from '../pricing/price-currency'
import type { PriceTotals } from '../pricing/price-report'
import { PRICE_SOURCE_LABELS, sourceCurrency, type PriceSource } from '../pricing/price-source'
import { formatDuration } from '../util/duration'

/**
 * "Total $12.34 · Lowest $10.00 · 2 unpriced" (lowest/unpriced only when they
 * add information), the total prefixed "~" when it is an estimate.
 */
export function formatTotalsSegment(totals: PriceTotals, currency: PriceCurrency): string {
  const parts: string[] = [
    t('cli.price.totalsTotal', {
      price: formatTotalPrice(totals.total, currency, isEstimatedTotal(totals)),
    }),
  ]
  if (showsLowestTotal(totals)) {
    parts.push(t('cli.price.totalsLowest', { price: formatPrice(totals.lowestTotal, currency) }))
  }
  if (totals.unpricedCount > 0) {
    parts.push(t('cli.price.totalsUnpriced', { count: totals.unpricedCount }))
  }
  return parts.join(' · ')
}

/** Whether a total reads `~` ({@link formatTotalsSegment}). */
export function isEstimatedTotal(totals: PriceTotals): boolean {
  return totals.estimatedCount > 0
}

/** Whether a totals segment shows its "Lowest possible" figure ({@link formatTotalsSegment}). */
export function showsLowestTotal(totals: PriceTotals): boolean {
  return totals.lowestTotal !== totals.total
}

/**
 * "Total $12.34 · …" for a priced total, or "not priced" for one the summary
 * could not price (the store has no prices for the run, or the list failed).
 */
export function formatValueSegment(
  value: PriceTotals | undefined,
  currency: PriceCurrency,
): string {
  return value === undefined ? t('cli.price.notPriced') : formatTotalsSegment(value, currency)
}

/** The store line every priced view leads with: cache age, store and its currency. */
export function formatStoreLine(
  source: PriceSource,
  lastRefreshedAt: number | null,
  now: number,
): string {
  const updated =
    lastRefreshedAt === null
      ? t('cli.price.updatedUnknown')
      : t('cli.price.updatedAt', {
          timestamp: formatDateTime(lastRefreshedAt),
          age: formatDuration(now - lastRefreshedAt),
        })
  return t('cli.price.headerUpdated', {
    updated,
    store: t(PRICE_SOURCE_LABELS[source]),
    currency: sourceCurrency(source).toUpperCase(),
  })
}
