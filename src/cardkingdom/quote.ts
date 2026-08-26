/**
 * Single-printing buylist lookup against a cached Card Kingdom feed.
 *
 * This is the one matcher: `src/sell-report.ts` calls it for pinned entries and
 * the `/api/buylist/quotes` handler calls it per requested printing, so
 * `ritual sell` and the site's sell mode can never quote different prices for
 * the same card.
 */

import type { BuylistQuote, BuylistQuoteBase, BuylistQuoteRequest } from '../buylist'
import { displayLanguage } from '../card/card-language'
import {
  lookupSkuPrinting,
  productUrl,
  type CardKingdomFeed,
  type CardKingdomIndex,
  type CardKingdomProduct,
} from './feed'

/** Whether CK is actually buying a product — they publish token prices on paused ones. */
export function productIsBuying(product: CardKingdomProduct): boolean {
  return product.qtyBuying > 0 && product.priceBuy > 0
}

/**
 * The best-paying candidate, preferring products CK is actually buying: a
 * $0.02 active offer beats a $5.00 inactive one, because only the former can be
 * sold today. Ties and inactive-only sets fall back to the highest price.
 */
export function chooseProduct(candidates: CardKingdomProduct[]): CardKingdomProduct | undefined {
  let best: CardKingdomProduct | undefined
  for (const candidate of candidates) {
    if (!best) {
      best = candidate
      continue
    }
    const bestBuying = productIsBuying(best)
    const candidateBuying = productIsBuying(candidate)
    if (candidateBuying !== bestBuying) {
      if (candidateBuying) best = candidate
      continue
    }
    if (candidate.priceBuy > best.priceBuy) best = candidate
  }
  return best
}

/** A chosen product plus how it was found and whether the choice was forced. */
export type ProductMatch = {
  product: CardKingdomProduct
  ambiguous: boolean
}

/** Choose among candidates, reporting whether more than one was in play. */
export function chooseMatch(candidates: CardKingdomProduct[]): ProductMatch | null {
  const product = chooseProduct(candidates)
  if (!product) return null
  return { product, ambiguous: candidates.length > 1 }
}

/**
 * A printing to quote. Aliased to the wire request rather than restated, so a
 * new join key added to the request reaches the matcher automatically.
 */
export type QuotePrinting = BuylistQuoteRequest

/**
 * Render a matched product as a wire-shaped {@link BuylistQuote}.
 * `feed` supplies only the base URL for the product page.
 */
export function toBuylistQuote(
  match: ProductMatch,
  matchVia: BuylistQuote['matchVia'],
  feed: Pick<CardKingdomFeed, 'baseUrl'>,
): BuylistQuote {
  const { product } = match
  const base: BuylistQuoteBase = {
    priceBuy: product.priceBuy,
    qtyBuying: product.qtyBuying,
    priceRetail: product.priceRetail,
    qtyRetail: product.qtyRetail,
    finish: product.finish,
    matchVia,
    ambiguous: match.ambiguous ? true : undefined,
    productId: product.id,
    name: product.name,
    edition: product.edition,
    variation: product.variation === '' ? undefined : product.variation,
    url: productUrl(feed, product),
  }
  // Branching rather than `buying: productIsBuying(product)`: the discriminant
  // has to be a literal for the union to narrow, and this is the one place the
  // feed's rule becomes the wire's.
  return productIsBuying(product) ? { ...base, buying: true } : { ...base, buying: false }
}

/** A chosen product together with the join key that located it. */
export type PrintingMatch = {
  match: ProductMatch
  matchVia: BuylistQuote['matchVia']
}

/**
 * Find the CK product for one printing: the Scryfall-id index filtered to the
 * requested finish first (99.5% product coverage), then the sku-derived
 * printing index for the remainder. Returns null when CK's catalog has nothing
 * for the printing — the caller renders that as "not on the buylist".
 *
 * A non-English request short-circuits to null before any index is consulted:
 * CK's feed is English-only, and quoting the English product's price for a
 * foreign copy would be a wrong price, not a helpful approximation.
 */
export function matchPrinting(
  index: CardKingdomIndex,
  printing: QuotePrinting,
): PrintingMatch | null {
  if (displayLanguage(printing.language) !== 'en') return null
  if (printing.scryfallId !== undefined && printing.scryfallId !== '') {
    const byId = (index.byScryfallId.get(printing.scryfallId) ?? []).filter(
      (product) => product.finish === printing.finish,
    )
    const hit = chooseMatch(byId)
    if (hit) return { match: hit, matchVia: 'scryfall-id' }
  }

  const bySku = chooseMatch(
    lookupSkuPrinting(index, printing.set, printing.collectorNumber, printing.finish),
  )
  if (bySku) return { match: bySku, matchVia: 'sku' }

  return null
}

/**
 * A cache-backed single-printing quote lookup: null when the buyer has no
 * product for it. The one function type behind both quoting seams —
 * `DetailBuylistContext.quote` (the site bake) and `CardKingdomPricing.quote`
 * (the price report) — so the two can never drift.
 */
export type PrintingQuoteFn = (printing: QuotePrinting) => BuylistQuote | null

/** {@link matchPrinting} rendered straight to a wire quote; null when unmatched. */
export function quoteForPrinting(
  index: CardKingdomIndex,
  feed: Pick<CardKingdomFeed, 'baseUrl'>,
  printing: QuotePrinting,
): BuylistQuote | null {
  const hit = matchPrinting(index, printing)
  return hit ? toBuylistQuote(hit.match, hit.matchVia, feed) : null
}
