import type { LoadedCardKingdomFeed } from '../cardkingdom'
import type { ListType } from '../list/list-type'
import { priceLookupFor } from './price-runtime'
import type { ListLocation } from '../list/resolve-list'
import type { RefreshMode } from '../cache/refresh'
import type { CardTag } from '../card/card-tags'
import { loadPriceListInputs } from './price-report'
import {
  buildSellReport,
  countOwnedCopies,
  loadSellListInputs,
  type OwnedCopiesIndex,
  type SellReport,
} from './sell-report'

/** A sell report built from disk plus the list parsers' warnings. */
export type LoadedSellReport = {
  report: SellReport
  warnings: string[]
}

/** How a sell report resolves card names — same policy as the price report. */
export type SellReportOptions = {
  /** Under `never` the report uses a cache-only printings lookup. */
  refresh?: RefreshMode
  /** Match only lines carrying one of these tags (see `SellEntryFilters.tags`). */
  tags?: readonly CardTag[]
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
  const loaded = await loadSellListInputs(type, locations, options?.tags)
  const report = await buildSellReport(loaded.inputs, {
    lookup: priceLookupFor(options?.refresh),
    index: feed.index,
    feed: feed.file.feed,
    feedRetrievedAt: feed.file.retrievedAt,
    owned: await loadOwnedCopies(),
  })
  return { report, warnings: loaded.warnings }
}

/**
 * Owned copies over every collection and deck, whatever the report's scope —
 * "how many do I have" is a question about all your lists. The lists' parse
 * warnings are dropped here: the in-scope lists report theirs through the
 * report itself, and an out-of-scope list's unreadable line only undercounts.
 */
async function loadOwnedCopies(): Promise<OwnedCopiesIndex> {
  const { inputs } = await loadPriceListInputs()
  return countOwnedCopies(inputs)
}
