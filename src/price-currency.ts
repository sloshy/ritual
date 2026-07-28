import type { ScryfallCard, ErrorCode, Finish } from './types'
import { getErrorMessage, type ExitCodeValue } from './errors'
import { defaultPrintingFinish } from './finish-condition'

export type PriceCurrency = 'usd' | 'eur' | 'tix'

export const DEFAULT_CURRENCY: PriceCurrency = 'usd'

export function parsePriceCurrencyFlag(
  input: string | undefined,
  fallback: PriceCurrency = DEFAULT_CURRENCY,
): PriceCurrency {
  if (!input) return fallback
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

/** Abstraction point for mapping PriceCurrency to a Scryfall price field key.
 *  Currently an identity mapping since PriceCurrency values match Scryfall keys. */
export function getPriceField(currency: PriceCurrency): PriceCurrency {
  return currency
}

export function formatPrice(amount: number, currency: PriceCurrency): string {
  const symbol = getCurrencySymbol(currency)
  const suffix = getCurrencySuffix(currency)
  return `${symbol}${amount.toFixed(2)}${suffix}`
}

/** Like formatPrice, but returns 'N/A' when amount is 0 (i.e. no price data available). */
export function formatPriceOrNA(amount: number, currency: PriceCurrency): string {
  if (amount <= 0) return 'N/A'
  return formatPrice(amount, currency)
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

/**
 * Whether a finish has no price in a currency *by construction* — as opposed to a
 * printing that simply has no data. Scryfall publishes `usd`, `usd_foil`,
 * `usd_etched`, `eur`, `eur_foil` and `tix`, with no etched counterpart in EUR, so
 * an etched card can never be priced in euros. Reading `eur` there would quote the
 * nonfoil price under an etched label — off by a lot on exactly the cards (etched
 * showcases) where the finish is the reason for the price.
 */
export function isFinishPricelessInCurrency(finish: string, currency: PriceCurrency): boolean {
  return currency === 'eur' && finish === 'etched'
}

export function getCardPriceForFinish(
  card: ScryfallCard,
  finish: string,
  currency: PriceCurrency,
): number {
  if (isFinishPricelessInCurrency(finish, currency)) return 0
  let raw: string | null
  if (currency === 'usd') {
    if (finish === 'foil') raw = card.prices.usd_foil
    else if (finish === 'etched') raw = card.prices.usd_etched
    else raw = card.prices.usd
  } else if (currency === 'eur') {
    raw = finish === 'foil' ? card.prices.eur_foil : card.prices.eur
  } else {
    raw = card.prices.tix
  }
  if (raw !== null) {
    const parsed = parseFloat(raw)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/**
 * The price column cell for one finish of a printing. `null` when the printing is
 * unknown (an entry whose pinned printing isn't cached), so a picker can still
 * offer the finish without inventing a price for it.
 */
export function formatFinishPriceCell(
  printing: ScryfallCard | undefined,
  finish: Finish,
  currency: PriceCurrency,
): string | null {
  if (!printing) return null
  return formatPriceOrNA(getCardPriceForFinish(printing, finish, currency), currency)
}

/**
 * The price column cell for a printing shown before any finish is chosen: its
 * {@link defaultPrintingFinish} price, tagged with that finish when it isn't
 * nonfoil so a foil-only or etched-only printing doesn't read as a nonfoil quote.
 * The tag is kept even when there is no price (`N/A etched`) — which finish the
 * cell speaks for is what makes the missing price legible.
 */
export function formatPrintingPriceCell(printing: ScryfallCard, currency: PriceCurrency): string {
  const finish = defaultPrintingFinish(printing)
  const cell = formatFinishPriceCell(printing, finish, currency) ?? ''
  return finish === 'nonfoil' ? cell : `${cell} ${finish}`
}

/** A picker choice: its label, the price cell shown to its right (`null` for none), and its value. */
export type PriceColumnRow<T> = {
  label: string
  price: string | null
  value: T
}

/** A laid-out picker choice, ready to hand to `prompts`. */
export type PriceColumnCell<T> = {
  title: string
  value: T
}

/** Widest label the price column aligns to; a longer label pushes its own price right. */
export const MAX_PRICE_COLUMN_LABEL = 60

/**
 * Lay out interactive-picker choices as a label plus a right-hand price column,
 * padding the labels to a common width so the prices line up. The width is capped
 * so one unusually long label can't push the column off a narrow terminal, and a
 * row with no price keeps its label unpadded. Each row's value is carried through
 * to the laid-out choice, so callers never re-index the source array.
 */
export function formatPriceColumn<T>(rows: readonly PriceColumnRow<T>[]): PriceColumnCell<T>[] {
  const width = Math.min(
    MAX_PRICE_COLUMN_LABEL,
    rows.reduce((max, row) => (row.price ? Math.max(max, row.label.length) : max), 0),
  )
  return rows.map((row) => ({
    title: row.price ? `${row.label.padEnd(width)}  ${row.price}` : row.label,
    value: row.value,
  }))
}

export const VALID_CURRENCIES = ['usd', 'eur', 'tix'] as const satisfies readonly PriceCurrency[]

export function isPriceCurrency(value: string): value is PriceCurrency {
  return (VALID_CURRENCIES as readonly string[]).includes(value)
}

/** Check if a currency is available for a card based on its game formats. */
export function isCurrencyAvailableForCard(games: string[], currency: PriceCurrency): boolean {
  if (games.length === 0) return true // No games info → assume available
  if (currency === 'tix') return games.includes('mtgo')
  // USD and EUR require paper
  return games.includes('paper')
}

/**
 * Parse the --prices flag with standardized error handling for CLI commands.
 * An absent flag resolves to `fallback` (the configured default currency).
 * Returns the parsed currency on success, or null if validation failed (after emitting error).
 */
export function parseCurrencyFlagOrError<T>(
  input: string | undefined,
  emitError: (code: ErrorCode, message: string, options: T) => void,
  scriptingOptions: T,
  exitCode: ExitCodeValue,
  fallback: PriceCurrency = DEFAULT_CURRENCY,
): PriceCurrency | null {
  try {
    return parsePriceCurrencyFlag(input, fallback)
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

export type CheapestPrintingResult = {
  price: number
  card: ScryfallCard
  finish: string
}

/**
 * Find the cheapest printing+finish combination from a list of card printings,
 * in the given currency (USD by default).
 */
export function findCheapestPrinting(
  printings: ScryfallCard[],
  currency: PriceCurrency = 'usd',
): CheapestPrintingResult | null {
  let best: CheapestPrintingResult | null = null
  for (const card of printings) {
    for (const finish of card.finishes) {
      const price = getCardPriceForFinish(card, finish, currency)
      if (price > 0 && (best === null || price < best.price)) {
        best = { price, card, finish }
      }
    }
  }
  return best
}

/**
 * Format a price line for display after adding a card with a specific printing.
 * Shows "Price: $X.XX" or "Price: unavailable".
 */
export function formatSpecificPrintingPrice(
  card: ScryfallCard,
  finish: string | undefined,
  currency: PriceCurrency = DEFAULT_CURRENCY,
): string {
  const resolvedFinish = finish ?? defaultPrintingFinish(card)
  const price = getCardPriceForFinish(card, resolvedFinish, currency)
  if (price <= 0) return 'Price: unavailable'
  return `Price: ${formatPrice(price, currency)}`
}

/**
 * Format a price line for display after adding a wanted card with no specific printing.
 * Shows "Cheapest printing: $X.XX (SET:NUM) [finish]" or "Cheapest printing: unavailable".
 */
export function formatCheapestPrintingDisplay(
  result: CheapestPrintingResult | null,
  currency: PriceCurrency = DEFAULT_CURRENCY,
): string {
  if (!result) return 'Cheapest printing: unavailable'
  const setNum = `${result.card.set.toUpperCase()}:${result.card.collector_number}`
  return `Cheapest printing: ${formatPrice(result.price, currency)} (${setNum}) [${result.finish}]`
}
