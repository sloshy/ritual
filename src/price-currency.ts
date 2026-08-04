import type { ScryfallCard, ErrorCode, Finish } from './types'
import { getErrorMessage, type ExitCodeValue } from './errors'
import { defaultPrintingFinish, printingFinishes, VALID_FINISHES } from './finish-condition'

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
 * Whether a currency prices each finish separately. MTGO tix does not: Scryfall
 * publishes one `tix` price per printing, so splitting it across finish columns
 * would repeat a single number under three labels.
 */
export function pricesFinishesSeparately(currency: PriceCurrency): boolean {
  return currency !== 'tix'
}

/**
 * The finishes a currency has a price field for, in {@link VALID_FINISHES} order.
 * EUR has no etched counterpart (see {@link isFinishPricelessInCurrency}), so an
 * etched column there could only ever read `N/A` on every row.
 */
function pricedFinishes(currency: PriceCurrency): readonly Finish[] {
  switch (currency) {
    case 'usd':
      return VALID_FINISHES
    case 'eur':
      return ['nonfoil', 'foil']
    case 'tix':
      return ['nonfoil']
  }
}

/**
 * The finishes a printing picker gives a price column to: every finish both the
 * currency prices and at least one of the listed printings is offered in. A list
 * with no foil or etched printings therefore keeps its single price column, as
 * does a currency that prices every finish alike.
 */
export function printingFinishColumns(
  printings: readonly ScryfallCard[],
  currency: PriceCurrency,
): Finish[] {
  const priced = pricedFinishes(currency)
  if (!pricesFinishesSeparately(currency)) return [...priced]
  const offered = new Set(printings.flatMap((p) => printingFinishes(p)))
  return priced.filter((finish) => offered.has(finish))
}

/**
 * One price column cell for a printing shown before any finish is chosen: that
 * finish's price, tagged with the finish when it isn't nonfoil so a foil or
 * etched quote never reads as a nonfoil one — the columns carry no header, so the
 * tag is what names them. The tag is kept even when there is no price
 * (`N/A etched`) — which finish the cell speaks for is what makes the missing
 * price legible. `null` when the printing isn't offered in the finish at all,
 * leaving its cell in that column blank. Under a currency that prices every
 * finish alike the single column is untagged and quotes every printing, so a
 * foil-only one is still priced.
 */
export function formatPrintingFinishCell(
  printing: ScryfallCard,
  finish: Finish,
  currency: PriceCurrency,
): string | null {
  const cell = formatPriceOrNA(getCardPriceForFinish(printing, finish, currency), currency)
  if (!pricesFinishesSeparately(currency)) return cell
  if (!printingFinishes(printing).includes(finish)) return null
  return finish === 'nonfoil' ? cell : `${cell} ${finish}`
}

/**
 * A picker choice: its label, the price cells shown to its right — one per
 * aligned column, `null` leaving that column blank — and its value.
 */
export type PriceColumnRow<T> = {
  label: string
  prices: readonly (string | null)[]
  value: T
}

/** A laid-out picker choice, ready to hand to `prompts`. */
export type PriceColumnChoice<T> = {
  title: string
  value: T
}

/** Widest label the price column aligns to; a longer label pushes its own price right. */
export const MAX_PRICE_COLUMN_LABEL = 60

/** Separator between the label and each price column, and between the columns. */
const PRICE_COLUMN_GAP = '  '

/**
 * Lay out interactive-picker choices as a label plus right-hand price columns,
 * padding the labels to a common width and each column to its own width so every
 * column lines up. The label width is capped so one unusually long label can't
 * push the columns off a narrow terminal, and a row with no price at all keeps
 * its label unpadded. Trailing blank cells are trimmed rather than padded. Each
 * row's value is carried through to the laid-out choice, so callers never
 * re-index the source array.
 */
export function formatPriceColumn<T>(rows: readonly PriceColumnRow<T>[]): PriceColumnChoice<T>[] {
  const isPriced = (row: PriceColumnRow<T>): boolean => row.prices.some((cell) => cell !== null)
  const labelWidth = Math.min(
    MAX_PRICE_COLUMN_LABEL,
    rows.reduce((max, row) => (isPriced(row) ? Math.max(max, row.label.length) : max), 0),
  )
  const columnCount = rows.reduce((max, row) => Math.max(max, row.prices.length), 0)
  const columnWidths = Array.from({ length: columnCount }, (_, index) =>
    rows.reduce((max, row) => Math.max(max, row.prices[index]?.length ?? 0), 0),
  )
  return rows.map((row) => {
    if (!isPriced(row)) return { title: row.label, value: row.value }
    const cells = columnWidths.map((width, index) => (row.prices[index] ?? '').padEnd(width))
    const title = `${row.label.padEnd(labelWidth)}${PRICE_COLUMN_GAP}${cells.join(PRICE_COLUMN_GAP)}`
    return { title: title.trimEnd(), value: row.value }
  })
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
