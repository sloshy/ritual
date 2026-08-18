/**
 * Card Kingdom quotes for printings no list displays — the other-printings grid
 * and the printing pickers.
 *
 * The quote store is normally filled with exactly the printings a page shows:
 * the public site's details carry them baked, the admin site requests them as
 * cards are added. A picker is the one surface that prices printings outside
 * that set, so under the Card Kingdom source it needs quotes nobody asked for
 * yet. Two paths cover it, and which one applies is a property of the
 * deployment rather than of the caller:
 *
 * - **Static public site** — the build quotes every printing in a list's
 *   `printings` map (see `bakeBuylistQuotes`), so the store already holds them
 *   and this hook requests nothing.
 * - **Admin, and a public site with `--api`** — printings arrive from
 *   `/api/card-printings` and can be any card at all, so they are quoted on
 *   demand against `/api/buylist/quotes`.
 *
 * Every finish is requested, not just the one a tile reads at: the pickers list
 * a printing's alternate finishes underneath its price, and an unrequested
 * finish would render N/A next to a foil the buyer is very much selling.
 */

import { createEffect, untrack, type Accessor } from 'solid-js'
import { buylistQuotesOnline, buylistRequestFor, requestBuylistQuotes } from './buylist-quotes'
import { printingFinishPairs } from '../card-printing'
import { activeUsdSource } from './price-view'
import type { BuylistQuoteRequest } from '../buylist'
import type { ScryfallCard } from '../types'

/**
 * The quote requests for every finish of every printing, skipping the ones no
 * buyer can quote (non-English objects — `buylistRequestFor` owns that rule).
 * Exported for the unit test; the hook is the production caller.
 */
export function printingQuoteRequests(printings: readonly ScryfallCard[]): BuylistQuoteRequest[] {
  return printingFinishPairs(printings)
    .map((pair) => buylistRequestFor(pair.card, pair.finish))
    .filter((request): request is BuylistQuoteRequest => request !== null)
}

/**
 * Keep the quote store supplied with offers for `printings` while the Card
 * Kingdom source is in view.
 *
 * Only under that source: TCGplayer and Cardmarket prices ride on the card
 * objects themselves, so quoting for them would be a round trip whose answer
 * nothing reads.
 *
 * Callers pass the *whole* printing list, never the visible page — the card
 * modal sorts its grid by price, which needs every figure, not the eight on
 * screen. Re-runs are cheap regardless: `requestBuylistQuotes` dedupes against
 * the keys it has already answered for.
 */
export function usePrintingQuotes(printings: Accessor<readonly ScryfallCard[]>): void {
  createEffect(() => {
    if (activeUsdSource() !== 'cardkingdom' || !buylistQuotesOnline()) return
    const requests = printingQuoteRequests(printings())
    if (requests.length === 0) return
    // Untracked: `requestBuylistQuotes` reads the quote map synchronously before
    // its first await, which would otherwise make this effect a subscriber of
    // every quote that arrives anywhere in the app. It converges either way (the
    // re-run bails at the dedupe before reading anything), but the dependency is
    // invisible from here and one early signal read in the callee would turn it
    // into a loop.
    untrack(() => void requestBuylistQuotes(requests))
  })
}
