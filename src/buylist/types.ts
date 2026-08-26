/**
 * The wire and display vocabulary for buylist quotes, shared by the matching
 * engine, the HTTP handlers, and both site bundles.
 *
 * Browser-safe: types plus pure string helpers, no Node built-ins. The matching
 * engine itself (`src/cardkingdom/quote.ts`) and the report engine
 * (`src/sell-report.ts`) are server-only; anything the browser needs to *name*
 * lives here so the site bundle never reaches for them.
 */

import type { CardLanguage } from '../card/card-language'
import type { Finish } from '../card/finish-condition'
import { printingKey } from '../card/printing-key'
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
 * Everything a quote carries except whether the buyer will act on it. Split out
 * so {@link BuylistQuote}'s two arms cannot drift field-for-field, and so a
 * producer can build the common half once and pick an arm at the end.
 */
export type BuylistQuoteBase = {
  /** The buyer's cash offer per copy (USD, Near Mint). */
  priceBuy: number
  /** Copies the buyer is currently taking; 0 means paused despite a price. */
  qtyBuying: number
  /**
   * The buyer's own retail (sell-to-you) price per copy (USD, Near Mint); 0
   * when they publish none. This is what the `cardkingdom` price source
   * displays, and what the spread compares the offer against when that source
   * is active. Carried on every quote — retail is a fact about the product,
   * not about whether the buyer is buying.
   */
  priceRetail: number
  /**
   * Copies the buyer has in stock to sell; 0 means out of stock. A 0-qty
   * product keeps its listed `priceRetail` — the price stands, the shelf is
   * empty — so display surfaces show the price either way.
   */
  qtyRetail: number
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
 * An offer the buyer will honor today: `qtyBuying > 0` *and* a nonzero
 * `priceBuy`. Only this arm may be drawn against — `qtyBuying` is a real budget
 * here, and `priceBuy` is money.
 */
export type ActiveBuylistQuote = BuylistQuoteBase & { buying: true }

/**
 * A published price the buyer is not acting on. Roughly half of Card Kingdom's
 * feed at any time, so this is the common case, not an edge one.
 *
 * Deliberately does *not* narrow `qtyBuying` to 0: a product is paused when
 * `qtyBuying` is 0 **or** `priceBuy` is, so a nonzero quantity at a zero price
 * is a paused quote too.
 */
export type PausedBuylistQuote = BuylistQuoteBase & { buying: false }

/**
 * A buyer's offer for one printing, discriminated on whether they are actually
 * buying. Absent from a response entirely when the buyer has no product for the
 * printing at all — which is a different fact from a paused offer, and the
 * reason presence and {@link isActiveOffer} are two separate questions.
 *
 * Narrow with {@link isActiveOffer} rather than reading `.buying` directly, so
 * "will they take a copy" has one spelling across the site bundle and the
 * server. The server-side report draws the same line with `isBuyingEntry`.
 */
export type BuylistQuote = ActiveBuylistQuote | PausedBuylistQuote

/**
 * Whether a quote is an offer the buyer will act on. Takes the *absent* quote
 * too, because every caller asks the same compound question — "is there an
 * offer, and is it live" — and answering it in one place is what keeps a
 * missing product and a paused one behaving identically everywhere.
 */
export function isActiveOffer(quote: BuylistQuote | undefined | null): quote is ActiveBuylistQuote {
  return quote?.buying === true
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
