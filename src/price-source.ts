import type { PriceCurrency } from './price-currency'
// Type-only, so the value-level import cycle (ritual-config parses this
// module's config key) never materializes at runtime.
import type { ConfigParseError } from './ritual-config'

/**
 * The stores card prices can be read from. Each source quotes in exactly one
 * currency:
 *
 * - `tcgplayer` — Scryfall's `usd*` prices (TCGplayer market price). The default.
 * - `cardmarket` — Scryfall's `eur*` prices (Cardmarket trend price).
 * - `cardkingdom` — Card Kingdom's NM retail price, read from the same daily
 *   pricelist feed the buylist uses (USD).
 *
 * Source names are machine tokens (config values, URL params, flag values):
 * always lowercase, never localized. Human-facing labels go through the
 * message catalog.
 */
export type PriceSource = 'tcgplayer' | 'cardmarket' | 'cardkingdom'

export const VALID_PRICE_SOURCES = [
  'tcgplayer',
  'cardmarket',
  'cardkingdom',
] as const satisfies readonly PriceSource[]

/** What `priceSources` means when the config key is absent: Scryfall USD only. */
export const DEFAULT_PRICE_SOURCES = ['tcgplayer'] as const satisfies readonly PriceSource[]

export function isPriceSource(value: string): value is PriceSource {
  return (VALID_PRICE_SOURCES as readonly string[]).includes(value)
}

/**
 * The USD stores, in canonical (selector) order — the one axis a user can
 * switch between; EUR is always Cardmarket.
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
  | { ok: true; currency: PriceCurrency }
  | { ok: false; source: PriceSource; implied: PriceCurrency }

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

/**
 * The one currency a source quotes in. MTGO tix has no store behind it and is
 * deliberately not a source — it stays a Scryfall-only currency.
 */
export function sourceCurrency(source: PriceSource): PriceCurrency {
  switch (source) {
    case 'tcgplayer':
    case 'cardkingdom':
      return 'usd'
    case 'cardmarket':
      return 'eur'
  }
}

/**
 * The enabled sources that quote in a currency, in canonical order. `tix` has
 * no sources; an empty result for `usd`/`eur` means the currency has no store
 * to price from under the current config.
 */
export function sourcesForCurrency(
  currency: PriceCurrency,
  enabled: readonly PriceSource[],
): PriceSource[] {
  return VALID_PRICE_SOURCES.filter(
    (source) => sourceCurrency(source) === currency && enabled.includes(source),
  )
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
