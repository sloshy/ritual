/**
 * The wire and display vocabulary for buylist quotes, shared by the matching
 * engine, the HTTP handlers, and both site bundles.
 *
 * Browser-safe: types plus pure string helpers, no Node built-ins. The matching
 * engine itself (`src/cardkingdom/quote.ts`) and the report engine
 * (`src/sell-report.ts`) are server-only; anything the browser needs to *name*
 * lives here so the site bundle never reaches for them.
 */

import type { CardLanguage } from '../card-language'
import type { Finish } from '../types'
import { printingKey } from '../printing-key'
import type { BuyerId } from './buyers'

/** Which join key located the buyer's product for a card. */
export const SELL_MATCH_VIAS = ['scryfall-id', 'sku', 'name'] as const
export type SellMatchVia = (typeof SELL_MATCH_VIAS)[number]

/**
 * One printing to quote. `scryfallId` is the primary join key when the client
 * has a resolved card; `set`/`collectorNumber` are always sent — they form the
 * response key and drive the sku fallback for the ~0.5% of buyer products that
 * carry no Scryfall id.
 */
export type BuylistQuoteRequest = {
  /** Lowercase set code, per the project-wide set-code rule. */
  set: string
  collectorNumber: string
  finish: Finish
  /** The Scryfall id of this exact printing, when the client has resolved it. */
  scryfallId?: string
  /**
   * The entry's language; absent means English. Buyer feeds are English-only,
   * so a non-English request is never matched — the matcher returns no quote
   * rather than quoting the English price for a foreign copy.
   */
  language?: CardLanguage
}

/**
 * A buyer's offer for one printing. Absent from a response entirely when the
 * buyer has no product for it — "not on the buylist" is the absence of a quote,
 * never a quote with a zero price.
 */
export type BuylistQuote = {
  /** The buyer's cash offer per copy (USD, Near Mint). */
  priceBuy: number
  /** Copies the buyer is currently taking; 0 means paused despite a price. */
  qtyBuying: number
  /** Whether the buyer is actively buying (`qtyBuying > 0` and a nonzero price). */
  buying: boolean
  /** The quoted product's finish, which can differ from the request's on a name match. */
  finish: Finish
  matchVia: SellMatchVia
  /** Several products matched; this quote is the best-paying one. */
  ambiguous?: boolean
  /** The buyer's product id, used to pool per-product buy budgets across a selection. */
  productId: number
  /** The buyer's own card title — what their cart importer expects. */
  name: string
  /** The buyer's own edition name — likewise. */
  edition: string
  /** The buyer's own variant note (`Borderless`, `298 - Borderless Ichor`), when they publish one. */
  variation?: string
  /** The buyer's product page, when their feed carries one. */
  url?: string
}

/**
 * Which buyer feed an offer came from. Declared once and composed into every
 * shape that carries it — the response stamp, the baked payload, the detail
 * builders' context — because the three have to line up field-for-field: the
 * client turns a baked payload straight into a feed stamp, and a drift there
 * would misreport how fresh the prices on screen are.
 */
export type BuylistFeedProvenance = {
  /** The buyer's own feed generation stamp, verbatim. */
  feedCreatedAt: string
  /** When Ritual downloaded that feed (epoch ms). */
  feedRetrievedAt: number
}

/** How fresh the quotes in a response are. */
export type BuylistFeedStamp = BuylistFeedProvenance & {
  /** Whether the cached feed is past its refresh cadence. */
  stale: boolean
  /** Products in the cached feed. */
  productCount: number
}

/**
 * POST /api/buylist/quotes response. `quotes` is sparse and keyed by
 * {@link quoteKey}: only printings the buyer has a product for appear.
 */
export type BuylistQuotesResponse = BuylistFeedStamp & {
  success: true
  buyer: BuyerId
  quotes: Record<string, BuylistQuote>
}

/** GET /api/buylist/status response — feed freshness without quoting anything. */
export type BuylistStatusResponse = BuylistFeedStamp & {
  success: true
  buyer: BuyerId
  /** Buyers this server can quote against. */
  buyers: BuyerId[]
}

/**
 * The key a quote is filed under, computable on both sides without a round trip:
 * the canonical {@link printingKey} plus a finish.
 *
 * Derived rather than restated so the printing half can never drift from the
 * rest of the codebase — this is the one key where a near-miss yields a wrong
 * *price* rather than a blank cell. Both halves are case-folded, which is what
 * lets a lookup keyed off a markdown line's `(DSK:2A)` spelling find a quote
 * registered under the resolved printing's `2a`.
 *
 * The buyer-sku index (`cardkingdom/feed.ts`) deliberately cannot derive from
 * this: it also strips leading zeros to match the vendor's own numbering.
 */
export function quoteKey(set: string, collectorNumber: string, finish: Finish): string {
  return `${printingKey(set, collectorNumber)}:${finish}`
}
