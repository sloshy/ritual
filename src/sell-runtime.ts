import type { LoadedCardKingdomFeed } from './cardkingdom'
import type { ListType } from './list-type'
import { priceLookupFor } from './price-runtime'
import type { ListLocation } from './resolve-list'
import type { RefreshMode } from './refresh'
import { buildSellReport, loadSellListInputs, type SellReport } from './sell-report'

/** A sell report built from disk plus the list parsers' warnings. */
export type LoadedSellReport = {
  report: SellReport
  warnings: string[]
}

/** How a sell report resolves card names — same policy as the price report. */
export type SellReportOptions = {
  /** Under `never` the report uses a cache-only printings lookup. */
  refresh?: RefreshMode
}

/**
 * Load list inputs and build a sell report with the production bindings
 * (Scryfall printings lookup, the feed's prebuilt lookup index). The one wiring
 * shared by the CLI `sell` command and the admin sell endpoint, so both
 * surfaces always match the same way.
 */
export async function loadAndBuildSellReport(
  type: ListType | undefined,
  locations: ListLocation[] | undefined,
  feed: LoadedCardKingdomFeed,
  options?: SellReportOptions,
): Promise<LoadedSellReport> {
  const loaded = await loadSellListInputs(type, locations)
  const report = await buildSellReport(loaded.inputs, {
    lookup: priceLookupFor(options?.refresh),
    index: feed.index,
    feed: feed.file.feed,
    feedRetrievedAt: feed.file.retrievedAt,
  })
  return { report, warnings: loaded.warnings }
}
