export type PriceCurrency = 'usd' | 'eur' | 'tix'

import type { ScryfallCard } from './types'
import { getErrorMessage } from './errors'

export function parsePriceCurrencyFlag(input: string | undefined): PriceCurrency {
  if (!input) return 'usd'
  const lower = input.toLowerCase().trim()
  if (lower === 'eur') return 'eur'
  if (lower === 'tix') return 'tix'
  if (lower === 'usd') return 'usd'
  throw new Error(`Invalid price currency '${input}'. Must be one of: usd, eur, tix`)
}

export function getCurrencySymbol(currency: PriceCurrency): string {
  switch (currency) {
    case 'usd':
      return '$'
    case 'eur':
      return '€'
    case 'tix':
      return ''
  }
}

export function getCurrencySuffix(currency: PriceCurrency): string {
  return currency === 'tix' ? ' tix' : ''
}

/** Map a PriceCurrency to the corresponding Scryfall price field key. */
export function getPriceField(currency: PriceCurrency): PriceCurrency {
  return currency
}

export function formatPrice(amount: number, currency: PriceCurrency): string {
  const symbol = getCurrencySymbol(currency)
  const suffix = getCurrencySuffix(currency)
  return `${symbol}${amount.toFixed(2)}${suffix}`
}

export function formatPriceWithMissing(
  amount: number,
  currency: PriceCurrency,
  missingCount: number,
): string {
  const base = formatPrice(amount, currency)
  if (missingCount > 0) {
    const cardWord = missingCount === 1 ? 'card' : 'cards'
    return `At least ${base} (missing ${missingCount} ${cardWord})`
  }
  return base
}

export function getCardPrice(card: ScryfallCard, currency: PriceCurrency): number {
  let raw: string | null = null
  switch (currency) {
    case 'usd':
      raw = card.prices.usd
      break
    case 'eur':
      raw = card.prices.eur
      break
    case 'tix':
      raw = card.prices.tix
      break
  }
  if (raw !== null) {
    const parsed = parseFloat(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function getCardPriceForFinish(
  card: ScryfallCard,
  finish: string,
  currency: PriceCurrency,
): number {
  let raw: string | null = null
  if (currency === 'usd') {
    if (finish === 'foil') raw = card.prices.usd_foil
    else if (finish === 'etched') raw = card.prices.usd_etched
    else raw = card.prices.usd
  } else if (currency === 'eur') {
    if (finish === 'foil') raw = card.prices.eur_foil
    else raw = card.prices.eur
  } else {
    raw = card.prices.tix
  }
  if (raw !== null) {
    const parsed = parseFloat(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export const VALID_CURRENCIES = ['usd', 'eur', 'tix'] as const satisfies readonly PriceCurrency[]

/** Check if a currency is available for a card based on its game formats. */
export function isCurrencyAvailableForCard(games: string[], currency: PriceCurrency): boolean {
  if (games.length === 0) return true // No games info → assume available
  if (currency === 'tix') return games.includes('mtgo')
  // USD and EUR require paper
  return games.includes('paper')
}

/**
 * Parse the --prices flag with standardized error handling for CLI commands.
 * Returns the parsed currency on success, or null if validation failed (after emitting error).
 */
export function parseCurrencyFlagOrError<T>(
  input: string | undefined,
  emitError: (type: string, message: string, options: T) => void,
  scriptingOptions: T,
  exitCode: number,
): PriceCurrency | null {
  try {
    return parsePriceCurrencyFlag(input)
  } catch (e) {
    const message = getErrorMessage(e)
    emitError('usage_error', message, scriptingOptions)
    process.exitCode = exitCode
    return null
  }
}

/** Parse a comma-separated currencies string (e.g., "usd,eur") into PriceCurrency[]. */
export function parseCurrenciesFlag(input: string | undefined): PriceCurrency[] {
  if (!input) return [...VALID_CURRENCIES]
  const parts = input
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  const result: PriceCurrency[] = []
  for (const part of parts) {
    if (part === 'usd' || part === 'eur' || part === 'tix') {
      if (!result.includes(part)) result.push(part)
    } else {
      throw new Error(
        `Invalid currency '${part}' in currencies list. Must be comma-separated values of: usd, eur, tix`,
      )
    }
  }
  if (result.length === 0) {
    throw new Error('At least one currency must be specified.')
  }
  return result
}
