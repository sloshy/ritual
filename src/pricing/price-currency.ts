import type { ScryfallCard } from '../scryfall/types'
import { type ErrorCode, getErrorMessage, type ExitCodeValue } from '../util/errors'
import {
  type Finish,
  displayFinish,
  printingFinishes,
  VALID_FINISHES,
} from '../card/finish-condition'
import { numberFormat } from '../i18n/format'
import { currentLocale } from '../i18n/runtime'
import { t } from '../i18n/t'
import { displayWidth, padEndDisplay } from '../i18n/width'
import { selectCheapestPrintingFinish, type CheapestPrintingResult } from '../card/printing-select'

// Re-exported from its leaf home so the many callers that reach for it beside
// `findCheapestPrinting` keep one import.
export type { CheapestPrintingResult }

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

/**
 * A currency's base (nonfoil) price field, which doubles as Scryfall's `order=`
 * key for it. Read from {@link PRICE_FIELDS} rather than by using the currency
 * name as a price key, which only works because the two happen to coincide.
 */
export function getPriceField(currency: PriceCurrency): BasePriceField {
  return PRICE_FIELDS[currency].nonfoil
}

/**
 * The **locale-invariant** money format: symbol, two decimals separated by a
 * literal `.`, then the currency suffix — `$12.30`, `€4.00`, `1.25 tix`.
 *
 * This is the machine-contract half of the split described in the localization
 * plan (§6.4). Every path whose output is *parsed* rather than read must use
 * it, and CSV is the sharp case: `Intl.NumberFormat('de-DE')` renders `12,30`,
 * and a comma decimal separator inside a comma-delimited file silently shifts
 * every following column. Making that unrepresentable is the whole point of
 * having a second function rather than a `locale` parameter someone can forget.
 *
 * Use it for: CSV and other delimited exports, values written to disk, and
 * anything a downstream importer re-parses. Use {@link formatPrice} for text a
 * human reads.
 *
 * **No production caller today** — `src/export/**`, `src/csv.ts` and
 * `src/buylist/cart-csv.ts` render no price columns yet. It exists ahead of the
 * need on purpose: the guard has to be in place *before* the first price column
 * lands, because the failure it prevents is silent. Wire it up when one does.
 */
export function formatPriceInvariant(amount: number, currency: PriceCurrency): string {
  const symbol = getCurrencySymbol(currency)
  const suffix = getCurrencySuffix(currency)
  return `${symbol}${amount.toFixed(2)}${suffix}`
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

/**
 * A price for a human to read: `Intl.NumberFormat` in the active UI locale,
 * so a German reader gets `1.234,50 €` rather than `€1234.50`.
 *
 * The counterpart of {@link formatPriceInvariant}, which never moves. Use that
 * one for anything a machine re-parses — the grouping separator this function
 * introduces (`$1,234.50`) would corrupt a CSV cell on its own, before any
 * non-English locale is involved.
 */
export function formatPrice(amount: number, currency: PriceCurrency): string {
  const locale = currentLocale()
  if (currency === 'tix') {
    const formatted = numberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
    return t('domain.currency.tix', { amount: formatted })
  }
  return numberFormat(locale, {
    style: 'currency',
    currency: ISO_CURRENCY_CODES[currency],
  }).format(amount)
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
    return t('domain.price.atLeastMissing', { price: base, count: missingCount })
  }
  return base
}

/** A printing's base price: its nonfoil quote, or the sole quote in a currency that has one. */
export function getCardPrice(card: ScryfallCard, currency: PriceCurrency): number {
  return getCardPriceForFinish(card, 'nonfoil', currency)
}

/** A field of {@link ScryfallCard.prices}, i.e. one published price. */
type PriceField = keyof ScryfallCard['prices']

/**
 * The price field each currency publishes for each finish, or `null` where it
 * publishes none. Scryfall has `usd`, `usd_foil`, `usd_etched`, `eur`,
 * `eur_foil`, `eur_etched` and `tix` — MTGO quotes one `tix` price for a
 * printing regardless of finish. `eur_etched` is absent on most cards (Scryfall
 * publishes it only for the etched printings Cardmarket actually quotes), which
 * simply reads as no data. A currency that genuinely published no field for a
 * finish would use `null` here, making a wrong-field read unrepresentable
 * rather than merely discouraged.
 */
const PRICE_FIELDS = {
  usd: { nonfoil: 'usd', foil: 'usd_foil', etched: 'usd_etched' },
  eur: { nonfoil: 'eur', foil: 'eur_foil', etched: 'eur_etched' },
  tix: { nonfoil: 'tix', foil: 'tix', etched: 'tix' },
} as const satisfies Record<PriceCurrency, Record<Finish, PriceField | null>>

/** A currency's base price field: `usd`, `eur` or `tix`. */
export type BasePriceField = (typeof PRICE_FIELDS)[PriceCurrency]['nonfoil']

/**
 * Whether a finish has no price in a currency *by construction* — as opposed to a
 * printing that simply has no data. See {@link PRICE_FIELDS}.
 */
export function isFinishPricelessInCurrency(finish: Finish, currency: PriceCurrency): boolean {
  return PRICE_FIELDS[currency][finish] === null
}

export function getCardPriceForFinish(
  card: ScryfallCard,
  finish: Finish,
  currency: PriceCurrency,
): number {
  const field = PRICE_FIELDS[currency][finish]
  if (field === null) return 0
  const raw = card.prices[field]
  // `!= null` also covers `eur_etched`, which is optional on the type and
  // absent from cards cached before it existed.
  if (raw != null) {
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
 * Whether a currency prices each finish separately, i.e. whether it has more than
 * one price field to read. MTGO tix does not: {@link PRICE_FIELDS} points every
 * finish at the same `tix` price, so splitting it across finish columns would
 * repeat one number under three labels.
 */
export function pricesFinishesSeparately(currency: PriceCurrency): boolean {
  return new Set(Object.values(PRICE_FIELDS[currency])).size > 1
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
  if (!pricesFinishesSeparately(currency)) return ['nonfoil']
  const offered = new Set(printings.flatMap((p) => printingFinishes(p)))
  return VALID_FINISHES.filter(
    (finish) => offered.has(finish) && !isFinishPricelessInCurrency(finish, currency),
  )
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
  // Widths are terminal columns, not code units: a Japanese card name occupies
  // two columns per character, so `String.length` would leave its row short and
  // knock every price out of alignment. `[ja]` card-language support already
  // puts such names in this column.
  const labelWidth = Math.min(
    MAX_PRICE_COLUMN_LABEL,
    rows.reduce((max, row) => (isPriced(row) ? Math.max(max, displayWidth(row.label)) : max), 0),
  )
  const columnCount = rows.reduce((max, row) => Math.max(max, row.prices.length), 0)
  const columnWidths = Array.from({ length: columnCount }, (_, index) =>
    rows.reduce((max, row) => Math.max(max, displayWidth(row.prices[index] ?? '')), 0),
  )
  return rows.map((row) => {
    if (!isPriced(row)) return { title: row.label, value: row.value }
    const cells = columnWidths.map((width, index) => padEndDisplay(row.prices[index] ?? '', width))
    const title = `${padEndDisplay(row.label, labelWidth)}${PRICE_COLUMN_GAP}${cells.join(PRICE_COLUMN_GAP)}`
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

/**
 * Find the cheapest printing+finish combination from a list of card printings,
 * in the given currency (USD by default). The scan itself lives in
 * `printing-select.ts` — Card Kingdom's retail counterpart runs the identical
 * loop over its own prices, and the two must not be able to disagree about
 * which finishes are candidates.
 */
export function findCheapestPrinting(
  printings: ScryfallCard[],
  currency: PriceCurrency = 'usd',
): CheapestPrintingResult | null {
  return selectCheapestPrintingFinish(printings, (card, finish) =>
    getCardPriceForFinish(card, finish, currency),
  )
}

/**
 * Format a price line for display after adding a card with a specific printing.
 * Shows "Price: $X.XX" or "Price: unavailable".
 */
export function formatSpecificPrintingPrice(
  card: ScryfallCard,
  finish: Finish | undefined,
  currency: PriceCurrency = DEFAULT_CURRENCY,
): string {
  const resolvedFinish = displayFinish(card, finish)
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
