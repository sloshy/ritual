/**
 * The client's buylist quote store: one module-level map of printing key →
 * quote, read reactively by the card tiles, filters, grouping, sorting, and
 * totals.
 *
 * Module-level (like `api-base`) rather than per-page: the same printing is
 * quoted the same everywhere, a combined view spans several lists, and quotes
 * survive in-SPA navigation so switching lists does not reload them.
 *
 * Two sources fill it, and a given app uses exactly one:
 * - {@link seedBuylistQuotes} — the public site, whose list details carry the
 *   quotes baked in by `build-site` (or by the live server per request), so
 *   sell mode works on a static host with no quote round trip at all.
 * - {@link requestBuylistQuotes} — the admin site, which quotes on demand
 *   against its own credentialed API and therefore never needs a rebuild to
 *   see a fresher feed.
 */

import { batch, createSignal, untrack, type Accessor } from 'solid-js'
import {
  DEFAULT_BUYER,
  buylistFeedIsStale,
  buylistRequestFor as buildBuylistRequest,
  isActiveOffer,
  isQuotableCard,
  quoteKey,
  type BuyerId,
  type BuylistQuote,
  type BuylistQuoteRequest,
  type BuylistQuotesResponse,
  type BuylistFeedStamp,
  BUYLIST_CURRENCY,
  roundCents,
} from '../buylist'
import type { BakedBuylist } from './data-types'
import { apiUrl } from './api-base'
import { displayFinish } from '../finish-condition'
import { isPricelessCard, type PricelessCard } from './priceless'
import { scryfallCardLanguage, type CardLanguage } from '../card-language'
import { sitePriceForFinish } from './price-view'
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
const defaultFetcher: BuylistFetcher = (buyer, printings) =>
  createBuylistFetcher({ url: apiUrl('api/buylist/quotes') })(buyer, printings)

let fetcher: BuylistFetcher = defaultFetcher

/**
 * Install the transport used for quote requests. The admin site calls this at
 * boot with a same-origin credentialed fetch; the public site keeps the
 * default. Mirrors `setApiBase`'s one-time install.
 */
export function setBuylistFetcher(next: BuylistFetcher): void {
  fetcher = next
}

/**
 * Put the built-in transport back — the counterpart to
 * {@link setBuylistFetcher}, for tests. The install is module-global and
 * `bun test` shares the module registry across files, so a suite that stubs the
 * transport and never restores it silently answers every later file's requests.
 */
export function resetBuylistFetcher(): void {
  fetcher = defaultFetcher
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

/**
 * Bumped by every {@link resetBuylistQuotes}. A request captures it on entry and
 * only touches {@link outstanding} on the way out if it still matches: the reset
 * already zeroed the count, so a straggler decrementing it would drive it
 * negative and pin {@link buylistLoading} on for the rest of the session (the
 * next request would go -1 → 0 → -1 and never reach the `=== 0` that clears the
 * spinner). The count belongs to a generation, not to the module.
 */
let generation = 0

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
 * Why sell mode has no prices, or null. Sticky until the next successful load
 * so a UI can explain an empty sell mode — a failed request on the admin site,
 * or a list with no baked quotes on the public one (usually: no feed
 * downloaded).
 */
export const buylistError: Accessor<string | null> = error

/**
 * Record a reason sell mode has nothing to show that the store did not produce
 * itself — the baked path's "this list carries no quotes". Surfaces through
 * {@link buylistError} exactly like a failed request, and is cleared by the
 * next successful seed or request.
 *
 * The message is passed in already translated: this module is shared by both
 * SPAs and holds no locale of its own.
 */
export function reportBuylistUnavailable(message: string): void {
  setError(message)
}

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
 * `priceless` is required — build it with `pricelessFacts`. It carries the
 * entry's *effective* labels and its custom-art facts: a
 * proxy is not a real card and a custom-art copy is not the printing a quote
 * would be for, so no buyer is offering anything for either — the same rule the
 * price engine and the bakers apply. It is one object rather than loose
 * arguments so a caller cannot pass the display URL and forget the
 * `hasCustomArt` fact beside it (an undeployed file has only the latter).
 *
 * Reads the quote store, so calling this inside a memo makes that memo re-run
 * when quotes arrive.
 */
export function buylistFieldsFor(
  card: ScryfallCard | null,
  finish: Finish | undefined,
  language: CardLanguage | undefined,
  priceless: PricelessCard,
): Readonly<BuylistCardFields> {
  // Gated on the mode, not just on the store: quotes outlive a toggle-off (they
  // are only cleared by a buyer switch), so without this a card would keep its
  // buylist price — and its on-buylist grouping — after sell mode was turned off.
  if (!sellModeActive()) return NO_BUYLIST_FIELDS
  if (isPricelessCard(priceless)) return NO_BUYLIST_FIELDS
  // The entry's own language token as well as the resolved object's: under the
  // default `en` cache a `[ja]` line resolves to the English card, whose key an
  // English sibling in the same list may have baked. `isQuotableCard` is the one
  // rule the bake applies too.
  if (!isQuotableCard(card, language)) return NO_BUYLIST_FIELDS
  const resolvedFinish = displayFinish(card, finish)
  const quote = quoteFor(card.set, card.collector_number, resolvedFinish)
  // Retail read in the buyer's currency, not the page's: subtracting a EUR
  // price from a USD offer would produce a number that means nothing. Source-
  // aware: under the Card Kingdom price view the spread is CK-buy vs CK-retail
  // (apples to apples for selling to CK), and switching the view to TCGplayer
  // compares the offer against the market price instead.
  const retail = sitePriceForFinish(card, resolvedFinish, BUYLIST_CURRENCY)
  // Both sides fall back to 0 when missing, so the spread is always a number: a
  // card with no offer is simply the worst possible deal on its retail price,
  // and one with no USD retail is measured against the offer alone.
  const buylistPrice = isActiveOffer(quote) ? quote.priceBuy : 0
  return {
    buylistPrice,
    buylistSpread: roundCents(buylistPrice - retail),
    // "On the buylist" means the buyer will take the card *today*, not merely
    // that their catalog lists the printing. Card Kingdom's feed carries every
    // product they have ever sold — nearly half of it with `qtyBuying: 0` — so
    // keying this on the quote's mere existence made the filter and the grouping
    // pass almost every English printing, while the tile beside them showed no
    // offer at all.
    //
    // Derived from the price rather than re-read from `quote.buying`, so the
    // "true exactly when `buylistPrice > 0`" the tile badge, the buylist-price
    // filter and `CardData.onBuylist`'s doc all rely on is a property of this
    // line — not a claim about what a buyer's adapter happens to publish.
    onBuylist: buylistPrice > 0,
  }
}

/**
 * The quote request for a displayed printing, or null when it has no resolved
 * card or is not quotable.
 *
 * Delegates to the shared `src/buylist/request.ts` rule rather than restating
 * it: the server-side bake builds its keys through the same function, and the
 * two must agree exactly or a baked quote is never found.
 */
export function buylistRequestFor(
  card: ScryfallCard | null,
  finish: Finish | undefined,
  language?: CardLanguage,
): BuylistQuoteRequest | null {
  return buildBuylistRequest(card, finish, language)
}

/** Drop every loaded quote — on a buyer switch, and in tests. */
export function resetBuylistQuotes(): void {
  resolved = new Set()
  loadedBuyer = DEFAULT_BUYER
  inFlight.clear()
  // Clear the count rather than leaving the spinner pinned on by a request
  // nobody awaits. The generation bump is what stops an in-flight call's
  // `finally` from decrementing the zero we just wrote.
  generation++
  outstanding = 0
  setLoading(false)
  setQuotes(new Map())
  setFeedInfo(null)
  setError(null)
}

/**
 * Load a list's baked quotes into the store — the public site's only source.
 *
 * Idempotent by design: pages re-seed on every sell-mode engage, buyer change
 * and detail refetch, and a combined view seeds once per loaded list into the
 * same map. Writing the signals only when something actually differs is what
 * keeps those repeats from invalidating every card memo on the page.
 *
 * A `baked` payload with no entry for `buyer` (a buyer the build did not quote
 * against) seeds nothing and leaves the store exactly as it was — including
 * across a buyer switch, which is why the payload is looked up before anything
 * is cleared. The caller learns of it from the `false` return and explains it;
 * silently wiping the page's prices with nothing to replace them would leave
 * sell mode priceless with no reason given.
 *
 * @returns Whether the payload carried quotes for `buyer` at all.
 */
export function seedBuylistQuotes(baked: BakedBuylist, buyer: BuyerId = DEFAULT_BUYER): boolean {
  // Untracked throughout: this is a write, called from the pages' seeding
  // effect. Without it the effect would take the very signals it writes as
  // dependencies and re-run itself on every seed.
  return untrack(() => seed(baked, buyer))
}

function seed(baked: BakedBuylist, buyer: BuyerId): boolean {
  // Before the reset below, so a payload this buyer is not in cannot clear
  // quotes the page is still showing and put nothing in their place.
  const seeded = baked[buyer]
  if (!seeded) return false
  if (buyer !== loadedBuyer) {
    // Reset first: `resetBuylistQuotes` restores the default buyer, so
    // assigning before it would put the store back on the wrong one.
    resetBuylistQuotes()
    loadedBuyer = buyer
  }

  const current = quotes()
  // Identity comparison, not a deep one: these objects come straight out of the
  // detail's parsed JSON, so re-seeding the same detail compares equal and
  // re-fetching it (live mode) yields fresh objects that correctly compare new.
  const added = Object.entries(seeded.quotes).filter(([key, quote]) => current.get(key) !== quote)
  const stamp: BuylistFeedInfo = {
    feedCreatedAt: seeded.feedCreatedAt,
    feedRetrievedAt: seeded.feedRetrievedAt,
    // Derived here rather than baked: a built site is served for days, and a
    // `stale` flag frozen at build time would keep claiming freshness.
    stale: buylistFeedIsStale(seeded.feedRetrievedAt, Date.now()),
  }
  const previous = feedInfo()
  const stampChanged =
    previous === null ||
    previous.feedCreatedAt !== stamp.feedCreatedAt ||
    previous.feedRetrievedAt !== stamp.feedRetrievedAt ||
    previous.stale !== stamp.stale
  if (added.length === 0 && !stampChanged && error() === null) return true

  // Every baked key counts as answered for, including ones already present, so
  // the store never re-asks for a printing this list already settled.
  for (const key of Object.keys(seeded.quotes)) resolved.add(key)
  const next = new Map(current)
  for (const [key, quote] of added) next.set(key, quote)
  batch(() => {
    if (added.length > 0) setQuotes(next)
    if (stampChanged) setFeedInfo(stamp)
    setError(null)
  })
  return true
}

/**
 * Ensure quotes are loaded for these printings, fetching only the ones not
 * already answered for or in flight. Switching buyers clears the store first,
 * since keys are not buyer-qualified.
 *
 * The admin site's path — the public site seeds from baked data instead and
 * never reaches the quote API.
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

  const myGeneration = generation
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
      // A reset (or buyer switch, which resets) since this call started
      // invalidates this response entirely: writing it would resurrect quotes
      // the reset just cleared and re-mark their keys resolved, so the fresh
      // feed would never be asked about them. Checked per batch — every write
      // below runs synchronously after this guard.
      if (myGeneration !== generation) return
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
    // A straggler's failure must not stick a sticky error onto the store a
    // reset just gave a clean slate.
    if (myGeneration === generation) setError(e instanceof Error ? e.message : String(e))
  } finally {
    // Only un-mark keys this call still owns: a reset (including the one a
    // buyer switch performs) cleared `inFlight`, and a newer request may
    // already have re-added the same keys.
    if (myGeneration === generation) for (const key of keys) inFlight.delete(key)
    // A reset since this call started already zeroed the count and cleared the
    // spinner; decrementing here would underflow it. See {@link generation}.
    if (myGeneration === generation && --outstanding === 0) setLoading(false)
  }
}
