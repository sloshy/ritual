import type { CardPrintingsLookup } from '../card/card-printing'
import type { ListType } from '../list/list-type'
import type { PriceCurrency } from './price-currency'
import {
  buildPriceReport,
  loadPriceListInputs,
  type BuiltPriceReport,
  type CardKingdomPricing,
} from './price-report'
import type { ListLocation } from '../list/resolve-list'
import { getBannedPrintings } from '../config/ritual-config'
import { refreshStaleAllowed, type RefreshMode } from '../cache/refresh'
import { getCachedCardPrintings, getCardPrintings } from '../scryfall'

/** A price report built from disk plus the list parsers' warnings. */
export type LoadedPriceReport = {
  built: BuiltPriceReport
  warnings: string[]
}

/** How a price report resolves card names that the cache does not hold. */
export type PriceReportOptions = {
  /**
   * The run's card-cache refresh mode. Under `never` the report uses a
   * cache-only lookup: an uncached name prices as "no printings" instead of
   * firing a per-card Scryfall fetch (which, offline, blocks for the full
   * request timeout per name and still writes the cache).
   */
  refresh?: RefreshMode
  /** Price from Card Kingdom NM retail instead of Scryfall (`--source cardkingdom`). */
  cardKingdom?: CardKingdomPricing
}

/**
 * The printings lookup a price run uses. `never` promises the existing cache
 * as-is, so an uncached card prices as "no printings" instead of firing a
 * per-card Scryfall fetch — which, offline, blocks for the full request timeout
 * per name. Every other mode (including no mode, the admin/MCP callers' case)
 * keeps the network-backed lookup.
 */
export function priceLookupFor(refresh: RefreshMode | undefined): CardPrintingsLookup {
  return refreshStaleAllowed(refresh ?? 'ask') ? getCardPrintings : getCachedCardPrintings
}

/**
 * Load list inputs and build a price report with the production bindings
 * (Scryfall printings lookup, configured banned printings). The one wiring shared
 * by the CLI `price` command and the admin price endpoints, so both surfaces
 * always price the same way.
 */
export async function loadAndBuildPriceReport(
  type: ListType | undefined,
  locations: ListLocation[] | undefined,
  currency: PriceCurrency,
  options?: PriceReportOptions,
): Promise<LoadedPriceReport> {
  const loaded = await loadPriceListInputs(type, locations)
  const built = await buildPriceReport(loaded.inputs, {
    currency,
    lookup: priceLookupFor(options?.refresh),
    bannedPrintings: getBannedPrintings(),
    ...(options?.cardKingdom ? { cardKingdom: options.cardKingdom } : {}),
  })
  return { built, warnings: loaded.warnings }
}
