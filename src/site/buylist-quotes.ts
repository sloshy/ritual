/**
 * The client's buylist quote store: one module-level map of printing key →
 * quote, filled on demand from the live quote API and read reactively by the
 * card tiles, filters, grouping, sorting, and totals.
 *
 * Module-level (like `api-base`) rather than per-page: the same printing is
 * quoted the same everywhere, a combined view spans several lists, and quotes
 * survive in-SPA navigation so switching lists does not refetch.
 *
 * Quotes are never baked into the site — a buyer feed is fresh for about a day —
 * so this is the only source, and it is inert without a live backend.
 */

import { batch, createSignal, type Accessor } from 'solid-js'
import {
  DEFAULT_BUYER,
  quoteKey,
  type BuyerId,
  type BuylistQuote,
  type BuylistQuoteRequest,
  type BuylistQuotesResponse,
  type BuylistFeedStamp,
  BUYLIST_CURRENCY,
  roundCents,
} from '../buylist'
import { apiUrl } from './api-base'
import { displayFinish } from '../finish-condition'
import { scryfallCardLanguage } from '../card-language'
import { getCardPriceForFinish } from '../price-currency'
import { sellModeActive } from './sell-mode'
import type { Finish, ScryfallCard } from '../types'

/**
 * Whether a displayed card object is a non-English printing. The buyer's feed
 * is English-only and keyed by `set:cn`, which an alternate-language object
 * *shares* with its English twin — so quoting it would silently price a
 * Japanese card at the English offer. Non-English cards are therefore never
 * requested or priced; they surface as "non-English — not quotable".
 */
export function isNonEnglishCard(card: ScryfallCard | null): boolean {
  return card !== null && scryfallCardLanguage(card) !== 'en'
}

/** Printings per request; the server caps a batch at 500. */
const QUOTE_BATCH_SIZE = 400

/** How a quote request is issued — swapped for the admin site's credentialed fetch. */
export type BuylistFetcher = (
  buyer: BuyerId,
  printings: BuylistQuoteRequest[],
) => Promise<BuylistQuotesResponse>

/** What a {@link createBuylistFetcher} transport varies. */
export type BuylistFetcherOptions = {
  /** Absolute or app-relative quote endpoint. */
  url: string
  /** Set to `'same-origin'` where the endpoint requires the session cookie (admin). */
  credentials?: RequestCredentials
}

/**
 * A quote transport. One factory so the public and admin sites differ only in
 * the URL and credentials, rather than in two copies of the same request.
 */
export function createBuylistFetcher(options: BuylistFetcherOptions): BuylistFetcher {
  return async (buyer, printings) => {
    const response = await fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer, printings }),
      ...(options.credentials ? { credentials: options.credentials } : {}),
    })
    if (!response.ok) throw new Error(`Buylist quotes failed: HTTP ${response.status}`)
    return (await response.json()) as BuylistQuotesResponse
  }
}

// Resolved per call, since `apiUrl` depends on the API base discovered at boot.
let fetcher: BuylistFetcher = (buyer, printings) =>
  createBuylistFetcher({ url: apiUrl('api/buylist/quotes') })(buyer, printings)

/**
 * Install the transport used for quote requests. The admin site calls this at
 * boot with a same-origin credentialed fetch; the public site keeps the
 * default. Mirrors `setApiBase`'s one-time install.
 */
export function setBuylistFetcher(next: BuylistFetcher): void {
  fetcher = next
}

/** How fresh the loaded quotes are; null before any successful response. */
export type BuylistFeedInfo = Omit<BuylistFeedStamp, 'productCount'>

const [quotes, setQuotes] = createSignal<ReadonlyMap<string, BuylistQuote>>(new Map())
const [feedInfo, setFeedInfo] = createSignal<BuylistFeedInfo | null>(null)
const [loading, setLoading] = createSignal(false)
const [error, setError] = createSignal<string | null>(null)

/** Outstanding requests. A bare boolean would be cleared by whichever of two
 * overlapping calls finished first, while the other was still running. */
let outstanding = 0

/** Keys already answered for, whether or not the buyer had a product for them. */
let resolved = new Set<string>()
/** Keys with a request in flight, so overlapping pages don't re-ask. */
const inFlight = new Set<string>()
/** Which buyer the current store contents came from. */
let loadedBuyer: BuyerId = DEFAULT_BUYER

/** How fresh the loaded quotes are; null until the first successful response. */
export const buylistFeedInfo: Accessor<BuylistFeedInfo | null> = feedInfo

/** True while at least one quote request is outstanding. */
export const buylistLoading: Accessor<boolean> = loading

/**
 * The last quote-request failure, or null. Sticky until the next successful
 * request so a UI can explain an empty sell mode (usually: no feed downloaded).
 */
export const buylistError: Accessor<string | null> = error

/**
 * The buyer's offer for a printing, or undefined when the buyer has no product
 * for it (or it has not been requested yet). Reactive — reading this inside a
 * memo re-runs it when quotes arrive.
 */
export function quoteFor(
  set: string,
  collectorNumber: string,
  finish: Finish,
): BuylistQuote | undefined {
  return quotes().get(quoteKey(set, collectorNumber, finish))
}

/** The buylist half of a `CardData`, derived from the store. */
export type BuylistCardFields = {
  /**
   * The active per-copy offer, or 0 when there is none. 0 is the "no price"
   * sentinel the site's filters, grouping and sorting already use for missing
   * card prices, so buylist prices slot into that machinery unchanged. A paused
   * offer (the buyer publishes a price but is not currently buying) reads as 0
   * too: it is not money you can get today.
   */
  buylistPrice: number
  buylistSpread: number
  onBuylist: boolean
}

/** No quote: what every card carries while sell mode is off. */
const NO_BUYLIST_FIELDS: Readonly<BuylistCardFields> = Object.freeze({
  buylistPrice: 0,
  buylistSpread: 0,
  onBuylist: false,
})

/**
 * The buylist fields for the printing a tile is actually displaying. Quoting the
 * displayed printing (rather than a list entry's own pin, which may be absent on
 * decks and wanted lists) is what keeps the buylist figure about the same copy
 * as the retail price shown beside it.
 *
 * Reads the quote store, so calling this inside a memo makes that memo re-run
 * when quotes arrive.
 */
export function buylistFieldsFor(
  card: ScryfallCard | null,
  finish: Finish | undefined,
): Readonly<BuylistCardFields> {
  // Gated on the mode, not just on the store: quotes outlive a toggle-off (they
  // are only cleared by a buyer switch), so without this a card would keep its
  // buylist price — and its on-buylist grouping — after sell mode was turned off.
  // Non-English cards are never quotable (see isNonEnglishCard).
  if (!card || !sellModeActive() || isNonEnglishCard(card)) return NO_BUYLIST_FIELDS
  const resolvedFinish = displayFinish(card, finish)
  const quote = quoteFor(card.set, card.collector_number, resolvedFinish)
  // Retail read in the buyer's currency, not the page's: subtracting a EUR
  // price from a USD offer would produce a number that means nothing.
  const retail = getCardPriceForFinish(card, resolvedFinish, BUYLIST_CURRENCY)
  // Both sides fall back to 0 when missing, so the spread is always a number: a
  // card with no offer is simply the worst possible deal on its retail price,
  // and one with no USD retail is measured against the offer alone.
  const buylistPrice = quote?.buying ? quote.priceBuy : 0
  return {
    buylistPrice,
    buylistSpread: roundCents(buylistPrice - retail),
    onBuylist: quote !== undefined,
  }
}

/**
 * The quote request for a displayed printing, or null when it has no resolved
 * card — or when the card is a non-English object, which is never quotable
 * (see {@link isNonEnglishCard}) and so never worth a request.
 */
export function buylistRequestFor(
  card: ScryfallCard | null,
  finish: Finish | undefined,
): BuylistQuoteRequest | null {
  if (!card || isNonEnglishCard(card)) return null
  return {
    set: card.set.toLowerCase(),
    collectorNumber: card.collector_number,
    finish: displayFinish(card, finish),
    scryfallId: card.id,
  }
}

/** Drop every loaded quote — on a buyer switch, and in tests. */
export function resetBuylistQuotes(): void {
  resolved = new Set()
  loadedBuyer = DEFAULT_BUYER
  inFlight.clear()
  // An in-flight call's `finally` will still decrement, so clear the count too
  // rather than leaving the spinner pinned on by a request nobody awaits.
  outstanding = 0
  setLoading(false)
  setQuotes(new Map())
  setFeedInfo(null)
  setError(null)
}

/**
 * Ensure quotes are loaded for these printings, fetching only the ones not
 * already answered for or in flight. Switching buyers clears the store first,
 * since keys are not buyer-qualified.
 *
 * Failures are recorded in {@link buylistError} rather than thrown: a card
 * without a quote renders as an ordinary card, so a failed request degrades the
 * page instead of breaking it.
 */
export async function requestBuylistQuotes(
  printings: BuylistQuoteRequest[],
  buyer: BuyerId = DEFAULT_BUYER,
): Promise<void> {
  if (buyer !== loadedBuyer) {
    // Reset first: `resetBuylistQuotes` restores the default buyer, so
    // assigning before it would put the store back on the wrong one.
    resetBuylistQuotes()
    loadedBuyer = buyer
  }

  const wanted = new Map<string, BuylistQuoteRequest>()
  for (const printing of printings) {
    const key = quoteKey(printing.set, printing.collectorNumber, printing.finish)
    if (resolved.has(key) || inFlight.has(key) || wanted.has(key)) continue
    wanted.set(key, printing)
  }
  if (wanted.size === 0) return

  const keys = [...wanted.keys()]
  for (const key of keys) inFlight.add(key)
  const pending = [...wanted.values()]

  outstanding++
  setLoading(true)
  try {
    // Accumulated across batches and written once: each `setQuotes` invalidates
    // every card memo on the page, so writing per batch re-renders a large list
    // once per 400 printings for no visible benefit.
    const next = new Map(quotes())
    let stamp: BuylistFeedInfo | null = null
    for (let i = 0; i < pending.length; i += QUOTE_BATCH_SIZE) {
      const slice = pending.slice(i, i + QUOTE_BATCH_SIZE)
      const data = await fetcher(buyer, slice)
      // A buyer switch (or reset) mid-flight invalidates this response.
      if (buyer !== loadedBuyer) return
      for (const [key, quote] of Object.entries(data.quotes)) next.set(key, quote)
      for (const printing of slice) {
        resolved.add(quoteKey(printing.set, printing.collectorNumber, printing.finish))
      }
      stamp = {
        feedCreatedAt: data.feedCreatedAt,
        feedRetrievedAt: data.feedRetrievedAt,
        stale: data.stale,
      }
    }
    batch(() => {
      setQuotes(next)
      if (stamp) setFeedInfo(stamp)
      setError(null)
    })
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e))
  } finally {
    // Only un-mark keys this call still owns: a buyer switch cleared `inFlight`
    // and the new buyer's request may already have re-added the same keys.
    if (buyer === loadedBuyer) for (const key of keys) inFlight.delete(key)
    if (--outstanding === 0) setLoading(false)
  }
}
