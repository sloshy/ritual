/**
 * The pricing a CLI run prices a store with — shared by `price` and
 * `lists --summary`, so both load Card Kingdom's feed the same way.
 */

import type { RefreshPolicy } from '../cache/refresh'
import { cardKingdomReportPricing, ensureCardKingdomFeed, loadEnsuredFeed } from '../cardkingdom'
import type { CardKingdomReportPricing, ReportPricing } from '../pricing/price-report'
import type { PriceSource } from '../pricing/price-source'
import { isSyncMessage, type SyncMessage } from '../sync/message'

/** A store's pricing, or why it cannot be had (Card Kingdom with no feed to read). */
export type CliPricingFor = (store: PriceSource) => Promise<ReportPricing | SyncMessage>

/** A run's store → pricing lookup, and the way to refresh Card Kingdom's. */
export interface CliPricingResolver {
  pricingFor: CliPricingFor
  /**
   * Download Card Kingdom's feed again (forced, under the run's policy) and
   * price from it from now on — what a price refresh mid-session must do for
   * Card Kingdom, whose prices are its feed's rather than the card cache's.
   * `undefined` when it worked, else why not; a failure keeps the feed the run
   * already had.
   */
  refreshCardKingdom: () => Promise<SyncMessage | undefined>
}

/**
 * A run's store → pricing lookup. Card Kingdom retail prices come from the
 * buylist pricelist feed, under the run's `--refresh` policy exactly like the
 * card cache. No feed is the refusal message — never a silent fallback to
 * Scryfall, which would answer with a different store's prices. The feed is
 * loaded once, on first use, so a run that switches store mid-session (the
 * price browser) reuses it until it is
 * {@link CliPricingResolver.refreshCardKingdom | refreshed}.
 */
export function cliPricingResolver(policy: RefreshPolicy): CliPricingResolver {
  let cardKingdom: CardKingdomReportPricing | undefined
  const loadCardKingdom = async (
    force: boolean,
  ): Promise<CardKingdomReportPricing | SyncMessage> => {
    const feed = await ensureCardKingdomFeed(policy, { force })
    if (isSyncMessage(feed)) return feed
    cardKingdom = cardKingdomReportPricing(await loadEnsuredFeed(feed))
    return cardKingdom
  }
  return {
    pricingFor: async (store) => {
      if (store !== 'cardkingdom') return { source: store }
      return cardKingdom ?? loadCardKingdom(false)
    },
    refreshCardKingdom: async () => {
      const refreshed = await loadCardKingdom(true)
      return isSyncMessage(refreshed) ? refreshed : undefined
    },
  }
}
