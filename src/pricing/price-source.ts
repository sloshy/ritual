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
 * The USD stores, in canonical order — the only currency with more than one
 * store; EUR is always Cardmarket and tix always Cardhoarder.
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
 * The Scryfall-backed store for each currency: the one store for EUR and tix,
 * and TCGplayer for USD (Card Kingdom being USD's second store).
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
 * the sites narrow it further to what they offer ({@link resolveSiteStores}).
 */
export function resolveDefaultPriceSource(
  configured: PriceSource | undefined,
  enabled: readonly PriceSource[],
): PriceSource {
  return configured ?? enabled[0] ?? DEFAULT_PRICE_SOURCE
}

/** The Scryfall-backed store that quotes in a currency. */
export function scryfallSourceFor(currency: PriceCurrency): PriceSource {
  return SCRYFALL_SOURCES[currency]
}

/**
 * A store list with `source` switched on or off, kept in canonical order
 * rather than toggle order so the persisted array is stable however it was
 * edited (the admin Settings checkboxes, `init-site --price-source`).
 */
export function withPriceSource(
  sources: readonly PriceSource[],
  source: PriceSource,
  enabled: boolean,
): PriceSource[] {
  return VALID_PRICE_SOURCES.filter((candidate) =>
    candidate === source ? enabled : sources.includes(candidate),
  )
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

/** The stores a site built or served under a config offers, and the one it opens on. */
export type SiteStores = {
  /**
   * The offered stores in the header's order: grouped by currency (USD, EUR,
   * tix), so the two USD stores sit together.
   */
  stores: PriceSource[]
  /**
   * The offered stores' currencies, in canonical order — derived from the
   * stores, never chosen, and the set the build bakes prices in. With no store
   * at all the site shows no prices, but still bakes the default store's
   * currency so its data stays well-formed.
   */
  currencies: PriceCurrencies
  /**
   * The configured default store when the site offers it, else the first
   * offered store (else the configured default, when nothing is offered).
   */
  defaultSource: PriceSource
}

/** A `--price-sources` list naming no store `priceSources` enables. */
export type SiteStoresError = {
  error: 'stores-not-enabled'
  requested: PriceSource[]
}

/**
 * Resolve a site's stores: the enabled `priceSources`, narrowed by an explicit
 * `--price-sources` list for one build. The list only narrows — it never adds
 * a store the config does not enable (that store's feed would not have been
 * loaded) — and one that keeps nothing is an error. `configuredSource` is the
 * raw `defaultPriceSource` (absent reads as {@link resolveDefaultPriceSource}
 * does).
 */
export function resolveSiteStores(
  enabled: readonly PriceSource[],
  configuredSource: PriceSource | undefined,
): SiteStores
export function resolveSiteStores(
  enabled: readonly PriceSource[],
  configuredSource: PriceSource | undefined,
  explicit: readonly PriceSource[] | undefined,
): SiteStores | SiteStoresError
export function resolveSiteStores(
  enabled: readonly PriceSource[],
  configuredSource: PriceSource | undefined,
  explicit?: readonly PriceSource[],
): SiteStores | SiteStoresError {
  const kept = explicit ? enabled.filter((source) => explicit.includes(source)) : enabled
  if (explicit && kept.length === 0) {
    return { error: 'stores-not-enabled', requested: [...explicit] }
  }
  return siteStoresOf(kept, resolveDefaultPriceSource(configuredSource, enabled))
}

/**
 * Stores in the header picker's order: grouped by currency (USD, EUR, tix) so
 * the two USD stores sit together. The one ordering both the build and the
 * client apply.
 */
export function orderedPriceSources(sources: readonly PriceSource[]): PriceSource[] {
  return VALID_CURRENCIES.flatMap((currency) => sourcesForCurrency(currency, sources))
}

/** The currencies a set of stores prices in, in canonical order — derived, never chosen. */
export function storeCurrencies(sources: readonly PriceSource[]): PriceCurrency[] {
  return VALID_CURRENCIES.filter((currency) =>
    sources.some((source) => sourceCurrency(source) === currency),
  )
}

/** {@link SiteStores} for a final store list and the store the site should open on. */
function siteStoresOf(kept: readonly PriceSource[], configured: PriceSource): SiteStores {
  const stores = orderedPriceSources(kept)
  const defaultSource = stores.includes(configured) ? configured : (stores[0] ?? configured)
  const [first, ...rest] = storeCurrencies(stores)
  return {
    stores,
    currencies: first === undefined ? [sourceCurrency(defaultSource)] : [first, ...rest],
    defaultSource,
  }
}

/**
 * Drop Card Kingdom from a site's stores when there is no feed to price it
 * from: offered anyway, it would read N/A on every card, and a site whose only
 * store it is would show no money with no picker to escape by. The Scryfall
 * stores never need this — their prices ride in the card cache.
 */
export function withCardKingdomFeed(siteStores: SiteStores, hasFeed: boolean): SiteStores {
  if (hasFeed || !siteStores.stores.includes('cardkingdom')) return siteStores
  return siteStoresOf(
    siteStores.stores.filter((source) => source !== 'cardkingdom'),
    siteStores.defaultSource,
  )
}

export function isSiteStoresError(value: SiteStores | SiteStoresError): value is SiteStoresError {
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
