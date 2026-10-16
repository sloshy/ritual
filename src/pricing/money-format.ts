/**
 * Prices for a human to read, in a given locale: the formatter behind
 * `formatPrice` and behind a message's price param (`SyncPriceParam` in
 * `src/sync/message.ts`).
 *
 * A leaf, so the message renderer can format a price without importing the
 * pricing engine (`price-currency.ts`), which reaches back into the card-line
 * modules that themselves build messages.
 */

import { numberFormat } from '../i18n/format'
import { tIn } from '../i18n/t'
import type { LocaleTag } from '../i18n/types'

export type PriceCurrency = 'usd' | 'eur' | 'tix'

export const VALID_CURRENCIES = ['usd', 'eur', 'tix'] as const satisfies readonly PriceCurrency[]

export function isPriceCurrency(value: string): value is PriceCurrency {
  return (VALID_CURRENCIES as readonly string[]).includes(value)
}

/**
 * The ISO 4217 code each currency formats as. `tix` has none — Magic Online
 * event tickets are not a currency ICU knows — which is exactly why it is
 * absent here and rendered through a message instead.
 */
const ISO_CURRENCY_CODES = {
  usd: 'USD',
  eur: 'EUR',
} as const satisfies Partial<Record<PriceCurrency, string>>

/** Two decimals, the figure a `tix` price wraps in its message. */
const TIX_FIGURE: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 }

/**
 * A price in `locale`: `Intl.NumberFormat`'s currency style, so a German
 * reader gets `1.234,50 €` rather than `€1234.50`, and `domain.currency.tix`
 * for tickets.
 */
export function formatPriceIn(locale: LocaleTag, amount: number, currency: PriceCurrency): string {
  if (currency === 'tix') {
    return tIn(locale, 'domain.currency.tix', {
      amount: numberFormat(locale, TIX_FIGURE).format(amount),
    })
  }
  return numberFormat(locale, { style: 'currency', currency: ISO_CURRENCY_CODES[currency] }).format(
    amount,
  )
}
