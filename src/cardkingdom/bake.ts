/**
 * The adapter that lets a site build quote against a loaded Card Kingdom feed.
 *
 * `build-site` and the live server both bake buylist offers into per-list detail
 * payloads, and both get their quoting seam from here — so a printing can never
 * be quoted one way by a static build and another by `serve --api`. The seam
 * itself (`DetailBuylistContext`) is declared in `src/site/details/types.ts`;
 * this module is the only producer of one.
 */

import { DEFAULT_BUYER, type BuyerId } from '../buylist'
import type { DetailBuylistContext } from '../site/details/types'
import type { LoadedCardKingdomFeed } from './memo'
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
