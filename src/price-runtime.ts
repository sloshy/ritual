import type { ListType } from './list-type'
import type { PriceCurrency } from './price-currency'
import { buildPriceReport, loadPriceListInputs, type BuiltPriceReport } from './price-report'
import type { ListLocation } from './resolve-list'
import { getBannedPrintings } from './ritual-config'
import { getCardPrintings } from './scryfall'

/** A price report built from disk plus the list parsers' warnings. */
export type LoadedPriceReport = {
  built: BuiltPriceReport
  warnings: string[]
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
): Promise<LoadedPriceReport> {
  const loaded = await loadPriceListInputs(type, locations)
  const built = await buildPriceReport(loaded.inputs, {
    currency,
    lookup: getCardPrintings,
    bannedPrintings: getBannedPrintings(),
  })
  return { built, warnings: loaded.warnings }
}
