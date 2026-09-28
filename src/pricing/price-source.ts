import { VALID_CURRENCIES, type PriceCurrencies, type PriceCurrency } from './price-currency'
// Type-only, so the value-level import cycle (ritual-config parses this
// module's config key) never materializes at runtime.
import type { ConfigParseError } from '../config/ritual-config'
import type { MessageKey } from '../i18n/messages/en'

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

/**
 * The store display names, as catalog keys — one table for every store
 * picker (the sites' header, the admin Settings, `init-site`), so a renamed
 * key cannot strand one of them on a dead entry.
 */
export const PRICE_SOURCE_LABELS = {
  tcgplayer: 'site.priceSource.tcgplayer',
  cardmarket: 'site.priceSource.cardmarket',
  cardkingdom: 'site.priceSource.cardkingdom',
  cardhoarder: 'site.priceSource.cardhoarder',
} as const satisfies Record<PriceSource, MessageKey>

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

export function isUsdPriceSource(source: PriceSource): source is UsdPriceSource {
  return (USD_PRICE_SOURCES as readonly PriceSource[]).includes(source)
}

/** The store a deployment prices from when neither config nor a request names one. */
export const DEFAULT_PRICE_SOURCE = 'tcgplayer' satisfies PriceSource

/**
 * The Scryfall-backed store for each currency — what a request that names only
 * a currency reads, unless the configured default already quotes in it.
 */
const SCRYFALL_SOURCES = {
  usd: 'tcgplayer',
  eur: 'cardmarket',
  tix: 'cardhoarder',
} as const satisfies Record<PriceCurrency, PriceSource>

/**
 * The store a workspace prices from by default: the configured
 * `defaultPriceSource`, else the first enabled store, else TCGplayer. Used as
 * is by the CLI, the admin API, and MCP, which are not gated on `priceSources`;
 * the sites narrow it further to what they offer ({@link resolveSiteCurrencies}).
 */
export function resolveDefaultPriceSource(
  configured: PriceSource | undefined,
  enabled: readonly PriceSource[],
): PriceSource {
  return configured ?? enabled[0] ?? DEFAULT_PRICE_SOURCE
}

/** A price request resolved to the store it reads and the currency that store quotes in. */
export type PriceRequest = { source: PriceSource; currency: PriceCurrency }

/** An explicit source whose currency disagrees with an explicit currency. */
export type PriceRequestConflict = {
  error: 'source-currency-conflict'
  source: PriceSource
  implied: PriceCurrency
}

/**
 * Resolve a price request's store from an explicit source, an explicit
 * currency, and the configured default. A source implies its currency, and
 * only an *explicit* conflicting currency is a conflict. A currency alone reads
 * the default store when that store quotes in it (so `--prices usd` under a
 * Card Kingdom default stays Card Kingdom), else that currency's Scryfall
 * store. Neither reads the default. The rule lives here once so the CLI flags,
 * the admin query params, and the MCP input cannot drift; each surface words
 * its own error.
 */
export function resolvePriceRequest(
  explicitSource: PriceSource | undefined,
  explicitCurrency: PriceCurrency | undefined,
  defaultSource: PriceSource,
): PriceRequest | PriceRequestConflict {
  if (explicitSource !== undefined) {
    const implied = sourceCurrency(explicitSource)
    if (explicitCurrency !== undefined && explicitCurrency !== implied) {
      return { error: 'source-currency-conflict', source: explicitSource, implied }
    }
    return { source: explicitSource, currency: implied }
  }
  if (explicitCurrency === undefined || explicitCurrency === sourceCurrency(defaultSource)) {
    return { source: defaultSource, currency: sourceCurrency(defaultSource) }
  }
  return { source: SCRYFALL_SOURCES[explicitCurrency], currency: explicitCurrency }
}

export function isPriceRequestConflict(
  value: PriceRequest | PriceRequestConflict,
): value is PriceRequestConflict {
  return 'error' in value
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

/** The currencies a site built or served under a config offers, and the store it opens in. */
export type SiteCurrencies = {
  available: PriceCurrencies
  /**
   * The configured default store when it is enabled and its currency offered,
   * else the first enabled store quoting in the first offered currency.
   */
  defaultSource: PriceSource
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
 * currency (the explicit list's, else the default store's) so its data stays
 * well-formed.
 */
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceSource,
): SiteCurrencies
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceSource,
  explicit: PriceCurrencies | undefined,
): SiteCurrencies | SiteCurrenciesError
export function resolveSiteCurrencies(
  sources: readonly PriceSource[],
  configured: PriceSource,
  explicit?: PriceCurrencies,
): SiteCurrencies | SiteCurrenciesError {
  const configuredCurrency = sourceCurrency(configured)
  const backed = VALID_CURRENCIES.filter(
    (currency) => sourcesForCurrency(currency, sources).length > 0,
  )
  const candidates =
    backed.length === 0
      ? (explicit ?? [configuredCurrency])
      : explicit
        ? explicit.filter((currency) => backed.includes(currency))
        : backed
  const [first, ...rest] = candidates
  if (first === undefined) {
    // Only reachable with an explicit list: `backed` is non-empty here.
    return { error: 'no-store-for-currencies', requested: explicit ?? [configuredCurrency] }
  }
  const available: PriceCurrencies = [first, ...rest]
  const offersConfigured = available.includes(configuredCurrency)
  if (offersConfigured && (sources.includes(configured) || backed.length === 0)) {
    return { available, defaultSource: configured }
  }
  // The configured store is off (or its currency is not offered): open in the
  // first offered currency, at its first enabled store — or its Scryfall store
  // when no store is enabled at all.
  return {
    available,
    defaultSource: sourcesForCurrency(first, sources)[0] ?? SCRYFALL_SOURCES[first],
  }
}

export function isSiteCurrenciesError(
  value: SiteCurrencies | SiteCurrenciesError,
): value is SiteCurrenciesError {
  return 'error' in value
}

/**
 * Parse the `defaultPriceSource` config value. Absent stays absent (the first
 * enabled store is the default); the value is lowercased, and an unknown store
 * name is a parse error.
 */
export function parseDefaultPriceSource(
  value: unknown,
): PriceSource | undefined | ConfigParseError {
  if (value === undefined) return undefined
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (isPriceSource(lower)) return lower
  }
  return {
    error: `"defaultPriceSource" must be one of: ${VALID_PRICE_SOURCES.join(', ')}`,
  }
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
