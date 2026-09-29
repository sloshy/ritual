/**
 * The adapter that lets a site build quote against a loaded Card Kingdom feed.
 *
 * `build-site` and the live server both bake buylist offers into per-list detail
 * payloads, and both get their quoting seam from here — so a printing can never
 * be quoted one way by a static build and another by `serve --api`. The seam
 * itself (`DetailBuylistContext`) is declared in `src/site-build/types.ts`;
 * this module is the only producer of one.
 */

import { DEFAULT_BUYER, type BuyerId } from '../buylist'
import type { DetailBuylistContext } from '../site-build/types'
import type { LoadedCardKingdomFeed } from './memo'
import type { CardKingdomReportPricing } from '../pricing/price-report'
import { quoteForPrinting } from './quote'

/** What varies between one detail-quoting context and another. */
export type DetailBuylistOptions = {
  /** Which buyer is being quoted. */
  buyer?: BuyerId
  /**
   * Whether to also quote the *alternate* printings a list carries — see
   * `DetailBuylistContext.quotePrintings`. Off by default: a sell-mode-only
   * deployment gets no use from them and should not pay their bytes.
   */
  quotePrintings?: boolean
}

/**
 * A quoting context over an already-loaded feed. Purely in-memory: the feed and
 * its index are the caller's (from `ensureCardKingdomFeed` or the process memo),
 * so nothing here reads the disk or the network per printing.
 */
export function detailBuylistContext(
  loaded: LoadedCardKingdomFeed,
  options: DetailBuylistOptions = {},
): DetailBuylistContext {
  return {
    buyer: options.buyer ?? DEFAULT_BUYER,
    quotePrintings: options.quotePrintings ?? false,
    // Paused products are quoted like any other: presence in the baked map is
    // catalog membership, which is a different question from `CardData.onBuylist`
    // ("will they take a copy today"). See `BakedBuylistQuotes.quotes`.
    quote: (printing) => quoteForPrinting(loaded.index, loaded.file.feed, printing),
    feedCreatedAt: loaded.file.feed.createdAt,
    feedRetrievedAt: loaded.file.retrievedAt,
  }
}

/**
 * A price report priced at Card Kingdom retail off a loaded feed — the one way
 * the CLI and the admin price API build it, through the same single-printing
 * seam the site bake quotes with.
 */
export function cardKingdomReportPricing(feed: LoadedCardKingdomFeed): CardKingdomReportPricing {
  return { source: 'cardkingdom', cardKingdom: { quote: detailBuylistContext(feed).quote } }
}

/**
 * The context a site (built or live-served) bakes list quotes with: null when
 * there is no feed. When the site offers the `cardkingdom` store (the config's
 * stores, narrowed by `build-site --price-sources`) the alternate printings
 * are quoted too, and `quotePrintings` is then also the signal that CK gets to
 * pick the printings a name-only line displays — one gate for both, so the
 * site never picks a CK printing it does not quote, or vice versa.
 */
export function siteBuylistContext(
  feed: LoadedCardKingdomFeed | null | undefined,
  offersCardKingdom: boolean,
): DetailBuylistContext | null {
  return feed ? detailBuylistContext(feed, { quotePrintings: offersCardKingdom }) : null
}
