import { VALID_CURRENCIES, type PriceCurrencies, type PriceCurrency } from './price-currency'
// Type-only, so the value-level import cycle (ritual-config parses this
// module's config key) never materializes at runtime.
import type { ConfigParseError } from '../config/ritual-config'

/**
 * The stores card prices can be read from. Each source quotes in exactly one
 * currency:
 *
 * - `tcgplayer` — Scryfall's `usd*` prices (TCGplayer market price). The default.
 * - `cardmarket` — Scryfall's `eur*` prices (Cardmarket trend price).
 * - `cardkingdom` — Card Kingdom's NM retail price, read from the same daily
 *   pricelist feed the buylist uses (USD).
 * - `cardhoarder` — Scryfall's `tix` price (Cardhoarder's MTGO price). Opt-in:
 *   a site offers MTGO tix only when this store is enabled.
 *
 * Source names are machine tokens (config values, URL params, flag values):
 * always lowercase, never localized. Human-facing labels go through the
 * message catalog.
 */
export type PriceSource = 'tcgplayer' | 'cardmarket' | 'cardkingdom' | 'cardhoarder'

export const VALID_PRICE_SOURCES = [
  'tcgplayer',
  'cardmarket',
  'cardkingdom',
  'cardhoarder',
] as const satisfies readonly PriceSource[]

/** What `priceSources` means when the config key is absent: Scryfall USD only. */
export const DEFAULT_PRICE_SOURCES = ['tcgplayer'] as const satisfies readonly PriceSource[]

export function isPriceSource(value: string): value is PriceSource {
  return (VALID_PRICE_SOURCES as readonly string[]).includes(value)
}

/**
 * The USD stores, in canonical (selector) order — the one axis a user can
 * switch between; EUR is always Cardmarket and tix always Cardhoarder.
 */
export const USD_PRICE_SOURCES = [
  'tcgplayer',
  'cardkingdom',
] as const satisfies readonly PriceSource[]

/** A store that quotes in USD. */
export type UsdPriceSource = (typeof USD_PRICE_SOURCES)[number]

/**
 * Resolve a `--source`-style choice against an explicitly supplied currency.
 * A source implies its currency; only an *explicit* conflicting currency is a
 * conflict — an omitted one silently follows the source. The rule lives here
 * once so the CLI flag, the admin query param, and the MCP input cannot drift
 * on the subtle half (explicit-only); each surface words its own error.
 */
export type SourceCurrencyResolution =
  { ok: true; currency: PriceCurrency } | { ok: false; source: PriceSource; implied: PriceCurrency }

export function resolveSourceCurrency(
  source: PriceSource,
  explicitCurrency: PriceCurrency | undefined,
): SourceCurrencyResolution {
  const implied = sourceCurrency(source)
  if (explicitCurrency !== undefined && explicitCurrency !== implied) {
    return { ok: false, source, implied }
  }
  return { ok: true, currency: implied }
}

/** The one currency a source quotes in. */
export function sourceCurrency(source: PriceSource): PriceCurrency {
  switch (source) {
    case 'tcgplayer':
    case 'cardkingdom':
      return 'usd'
    case 'cardmarket':
      return 'eur'
    case 'cardhoarder':
      return 'tix'
  }
}

/**
 * The enabled sources that quote in a currency, in canonical order. An empty
 * result means the currency has no store to price from under the current
 * config.
 */
export function sourcesForCurrency(
  currency: PriceCurrency,
  enabled: readonly PriceSource[],
): PriceSource[] {
  return VALID_PRICE_SOURCES.filter(
    (source) => sourceCurrency(source) === currency && enabled.includes(source),
  )
}

/** The currencies a site built or served under a config offers, and the one it opens in. */
export type SiteCurrencies = {
  available: PriceCurrencies
  /** The configured default when it is available, else the first available currency. */
  defaultCurrency: PriceCurrency
}

/** An explicit `--currencies` list naming no currency an enabled store quotes in. */
export type SiteCurrenciesError = {
  error: 'no-store-for-currencies'
  requested: PriceCurrencies
}

/**
 * Resolve a site's currencies: exactly the ones the enabled stores quote in,
 * in canonical currency order, so tix appears only when `cardhoarder` is
 * enabled. An explicit `--currencies` list narrows (and orders) that set but
 * never adds a currency with no store behind it; one that keeps nothing is an
 * error. With no stores at all the site shows no prices, but still bakes one
 * currency (the explicit list's, else the configured default) so its data
 * stays well-formed.
 */
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceCurrency,
): SiteCurrencies
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceCurrency,
  explicit: PriceCurrencies | undefined,
): SiteCurrencies | SiteCurrenciesError
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceCurrency,
  explicit?: PriceCurrencies,
): SiteCurrencies | SiteCurrenciesError {
  const backed = VALID_CURRENCIES.filter(
    (currency) => sourcesForCurrency(currency, sources).length > 0,
  )
  const candidates =
    backed.length === 0
      ? (explicit ?? [configured])
      : explicit
        ? explicit.filter((currency) => backed.includes(currency))
        : backed
  const [first, ...rest] = candidates
  if (first === undefined) {
    // Only reachable with an explicit list: `backed` is non-empty here.
    return { error: 'no-store-for-currencies', requested: explicit ?? [configured] }
  }
  const available: PriceCurrencies = [first, ...rest]
  return {
    available,
    defaultCurrency: available.includes(configured) ? configured : first,
  }
}

export function isSiteCurrenciesError(
  value: SiteCurrencies | SiteCurrenciesError,
): value is SiteCurrenciesError {
  return 'error' in value
}

/**
 * Parse the `priceSources` config value. Absent falls back to the default
 * (`['tcgplayer']`); an explicit empty array is preserved — it means "display
 * no prices at all" on the sites. Values are lowercased and deduped; an
 * unrecognized store name is a parse error.
 */
export function parsePriceSources(value: unknown): PriceSource[] | ConfigParseError {
  if (value === undefined) return [...DEFAULT_PRICE_SOURCES]
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    return { error: '"priceSources" must be an array of strings' }
  }
  const sources: PriceSource[] = []
  for (const raw of value) {
    const lower = raw.trim().toLowerCase()
    if (!isPriceSource(lower)) {
      return {
        error: `"priceSources" contains unknown store "${raw}". Must be any of: ${VALID_PRICE_SOURCES.join(', ')}`,
      }
    }
    if (!sources.includes(lower)) sources.push(lower)
  }
  return sources
}
